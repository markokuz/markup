import type { Dispatch } from "react";
import type { AppAction, DocumentTab } from "@/app/types";
import { detectDocumentType } from "@/app/utils/fileTypes";
import { isProjectFile, readProjectFile } from "@/app/utils/projectFile";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { putSession, type SessionEntry } from "@/app/utils/sessionStore";
import { readPdfWithMarkups } from "@/app/utils/pdfSave";
import { withGroups } from "@/app/utils/groups";
import { withPages } from "@/app/utils/pages";

/** Files Ctrl+S writes back to: .mkup projects and PDFs (markups saved into the PDF). */
function keepsHandle(file: File): boolean {
  return isProjectFile(file) || detectDocumentType(file) === "pdf";
}

type WindowWithOpenFilePicker = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

type DataTransferItemWithHandle = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

const OPEN_PICKER_TYPES = [
  {
    description: "Drawings, photos & Markup projects",
    accept: {
      "application/pdf": [".pdf"],
      "image/*": [
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".bmp",
        ".tif",
        ".tiff",
        ".heic",
        ".heif",
      ],
      "application/json": [".mkup"],
    },
  },
];

type OpenTab = Pick<DocumentTab, "id" | "projectHandle">;

/** Two tabs linked to one file would overwrite each other's saves, so show the open one instead. */
async function switchIfAlreadyOpen(
  handle: FileSystemFileHandle | null,
  tabs: OpenTab[],
  dispatch: Dispatch<AppAction>,
): Promise<boolean> {
  if (!handle) return false;
  for (const tab of tabs) {
    if (tab.projectHandle && (await tab.projectHandle.isSameEntry(handle).catch(() => false))) {
      dispatch({ type: "SWITCH_TAB", tabId: tab.id });
      showSaveStatus("info", `${handle.name} is already open`);
      return true;
    }
  }
  return false;
}

/**
 * Open a document or .mkup project in a new tab. `handle` links the .mkup or PDF so
 * Ctrl+S can save back to it.
 */
export async function openDocumentFile(
  file: File,
  dispatch: Dispatch<AppAction>,
  handle: FileSystemFileHandle | null = null,
  tabs: OpenTab[] = [],
): Promise<void> {
  try {
    if (await switchIfAlreadyOpen(handle, tabs, dispatch)) return;

    if (isProjectFile(file)) {
      const project = await readProjectFile(file);
      const tabId = crypto.randomUUID();
      // Keep the file handle so Ctrl+S after a reload still targets this .mkup.
      void putSession({ id: tabId, fileName: file.name, project: file, handle, savedAt: Date.now() });
      dispatch({ type: "LOAD_PROJECT", ...project, tabId, handle });
      return;
    }

    const fileType = detectDocumentType(file);
    if (!fileType) {
      showSaveStatus("info", `${file.name} can't be opened`);
      return;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    // A PDF saved from here carries its markups: reopen them as editable markups.
    const saved = fileType === "pdf" ? await readPdfWithMarkups(bytes).catch(() => null) : null;
    if (saved) {
      dispatch({
        type: "LOAD_PROJECT",
        ...withGroups(saved.data),
        ...withPages(saved.data),
        bytes: saved.pristine,
        fileName: file.name,
        fileType,
        mimeType: file.type,
        handle,
      });
      return;
    }
    dispatch({
      type: "LOAD_FILE",
      bytes,
      fileName: file.name,
      fileType,
      mimeType: file.type,
      handle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open file.";
    window.alert(message);
  }
}

type OpenEntry = {
  file: File;
  handle: FileSystemFileHandle | null | Promise<FileSystemFileHandle | null>;
};

/**
 * Read every file, then open their tabs in one go and in order. Tabs opened one by one would
 * pull the user off the tab they moved to, and make every file load instead of just the last.
 */
async function openTogether(
  entries: OpenEntry[],
  dispatch: Dispatch<AppAction>,
  tabs: OpenTab[] = [],
): Promise<void> {
  const actions: AppAction[] = [];
  for (const { file, handle } of entries) {
    await openDocumentFile(file, (action) => actions.push(action), await handle, tabs);
  }
  for (const action of actions) dispatch(action);
}

/**
 * Show the browser's open picker (which yields a file handle for Ctrl+S), or
 * fall back to the hidden `<input type="file">` where the API is unavailable.
 */
export async function pickAndOpenFile(
  dispatch: Dispatch<AppAction>,
  fallbackInput: HTMLInputElement | null,
  tabs: OpenTab[] = [],
): Promise<void> {
  const showOpenFilePicker = (window as WindowWithOpenFilePicker).showOpenFilePicker;
  if (typeof showOpenFilePicker !== "function") {
    fallbackInput?.click();
    return;
  }

  let handles: FileSystemFileHandle[];
  try {
    handles = await showOpenFilePicker({ multiple: true, types: OPEN_PICKER_TYPES });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    fallbackInput?.click();
    return;
  }

  const entries: OpenEntry[] = [];
  for (const handle of handles) {
    // One unreadable file doesn't stop the rest.
    try {
      const file = await handle.getFile();
      entries.push({ file, handle: keepsHandle(file) ? handle : null });
    } catch {
      window.alert(`Could not open ${handle.name}.`);
    }
  }
  await openTogether(entries, dispatch, tabs);
}

/** Open everything picked through the fallback `<input type="file">`, one tab each. */
export async function openInputFiles(
  input: HTMLInputElement,
  dispatch: Dispatch<AppAction>,
): Promise<void> {
  // Copied first: clearing the input, so the same files can be picked again, empties its live list.
  const files = Array.from(input.files ?? []);
  input.value = "";
  await openTogether(files.map((file) => ({ file, handle: null })), dispatch);
}

/** Open each dropped file in its own tab, keeping a handle for dropped .mkup projects and PDFs. */
export async function openDroppedFiles(
  dataTransfer: DataTransfer,
  dispatch: Dispatch<AppAction>,
  tabs: OpenTab[],
): Promise<void> {
  // The drop's items are only readable synchronously inside the drop event, so collect them all first.
  const entries = Array.from(dataTransfer.items as ArrayLike<DataTransferItemWithHandle>)
    .filter((item) => item.kind === "file")
    .flatMap((item): OpenEntry[] => {
      const file = item.getAsFile();
      if (!file) return [];
      const handle =
        keepsHandle(file) && item.getAsFileSystemHandle
          ? item
              .getAsFileSystemHandle()
              .then((found) => (found?.kind === "file" ? (found as FileSystemFileHandle) : null))
              .catch(() => null)
          : null;
      return [{ file, handle }];
    });
  await openTogether(entries, dispatch, tabs);
}

/** Reopen a browser backup in its original tab id, with its linked file handle. */
export async function restoreSession(
  entry: SessionEntry,
  dispatch: Dispatch<AppAction>,
  tabs: OpenTab[],
): Promise<void> {
  try {
    if (await switchIfAlreadyOpen(entry.handle, tabs, dispatch)) return;

    const project = await readProjectFile(new File([entry.project], entry.fileName));
    dispatch({
      type: "LOAD_PROJECT",
      ...project,
      bytes: entry.bytes ? new Uint8Array(await entry.bytes.arrayBuffer()) : project.bytes,
      tabId: entry.id,
      handle: entry.handle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not restore this file.";
    window.alert(message);
  }
}
