import type { Dispatch } from "react";
import type { AppAction } from "@/app/types";
import { detectDocumentType } from "@/app/utils/fileTypes";
import { isProjectFile, readProjectFile } from "@/app/utils/projectFile";
import { putSession, type SessionEntry } from "@/app/utils/sessionStore";
import { readPdfWithMarkups } from "@/app/utils/pdfSave";

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

/**
 * Open a document or .mkup project in a new tab. `handle` links the .mkup or PDF so
 * Ctrl+S can save back to it.
 */
export async function openDocumentFile(
  file: File,
  dispatch: Dispatch<AppAction>,
  handle: FileSystemFileHandle | null = null,
): Promise<void> {
  try {
    if (isProjectFile(file)) {
      const project = await readProjectFile(file);
      const tabId = crypto.randomUUID();
      // Keep the file handle so Ctrl+S after a reload still targets this .mkup.
      void putSession({ id: tabId, fileName: file.name, project: file, handle, savedAt: Date.now() });
      dispatch({
        type: "LOAD_PROJECT",
        tabId,
        bytes: project.bytes,
        fileName: project.fileName,
        fileType: project.fileType,
        mimeType: project.mimeType,
        scale: project.scale,
        measurements: project.measurements,
        rectangles: project.rectangles,
        notes: project.notes,
        shapes: project.shapes,
        displayUnit: project.displayUnit,
        zoom: project.zoom,
        rotation: project.rotation,
        legacyRotatedImage: project.legacyRotatedImage,
      toolColors: project.toolColors,
        handle,
      });
      return;
    }

    const fileType = detectDocumentType(file);
    if (!fileType) return;

    const bytes = new Uint8Array(await file.arrayBuffer());
    // A PDF saved from here carries its markups: reopen them as editable markups.
    const saved = fileType === "pdf" ? await readPdfWithMarkups(bytes).catch(() => null) : null;
    if (saved) {
      dispatch({
        type: "LOAD_PROJECT",
        ...saved.data,
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

/**
 * Show the browser's open picker (which yields a file handle for Ctrl+S), or
 * fall back to the hidden `<input type="file">` where the API is unavailable.
 */
export async function pickAndOpenFile(
  dispatch: Dispatch<AppAction>,
  fallbackInput: HTMLInputElement | null,
): Promise<void> {
  const showOpenFilePicker = (window as WindowWithOpenFilePicker).showOpenFilePicker;
  if (typeof showOpenFilePicker !== "function") {
    fallbackInput?.click();
    return;
  }

  let handles: FileSystemFileHandle[];
  try {
    handles = await showOpenFilePicker({ types: OPEN_PICKER_TYPES });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    fallbackInput?.click();
    return;
  }

  const handle = handles[0];
  if (!handle) return;
  const file = await handle.getFile();
  await openDocumentFile(file, dispatch, keepsHandle(file) ? handle : null);
}

/** Open the first dropped file, keeping a handle for dropped .mkup projects and PDFs. */
export async function openDroppedFile(
  dataTransfer: DataTransfer,
  dispatch: Dispatch<AppAction>,
): Promise<void> {
  const file = dataTransfer.files[0];
  if (!file) return;

  // getAsFileSystemHandle must be called synchronously inside the drop event.
  const item = dataTransfer.items[0] as DataTransferItemWithHandle | undefined;
  const handlePromise =
    keepsHandle(file) && item?.kind === "file" && item.getAsFileSystemHandle
      ? item.getAsFileSystemHandle().catch(() => null)
      : null;

  const handle = handlePromise ? await handlePromise : null;
  await openDocumentFile(
    file,
    dispatch,
    handle && handle.kind === "file" ? (handle as FileSystemFileHandle) : null,
  );
}

/** Reopen a browser backup in its original tab id, with its linked file handle. */
export async function restoreSession(
  entry: SessionEntry,
  dispatch: Dispatch<AppAction>,
): Promise<void> {
  try {
    const project = await readProjectFile(new File([entry.project], entry.fileName));
    dispatch({
      type: "LOAD_PROJECT",
      tabId: entry.id,
      bytes: project.bytes,
      fileName: project.fileName,
      fileType: project.fileType,
      mimeType: project.mimeType,
      scale: project.scale,
      measurements: project.measurements,
      rectangles: project.rectangles,
      notes: project.notes,
      shapes: project.shapes,
      displayUnit: project.displayUnit,
      zoom: project.zoom,
      rotation: project.rotation,
      legacyRotatedImage: project.legacyRotatedImage,
      toolColors: project.toolColors,
      handle: entry.handle,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not restore this file.";
    window.alert(message);
  }
}
