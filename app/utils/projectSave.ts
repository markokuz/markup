import type { Dispatch } from "react";
import type { AppAction, DocumentTab, Unit } from "@/app/types";
import {
  buildProjectBlob,
  getProjectFileName,
  persistProjectBlob,
} from "@/app/utils/projectFile";
import {
  SavePermissionError,
  supportsSaveFilePicker,
  writeBlobToHandle,
  writeBlobWithSaveFilePicker,
} from "@/app/utils/saveFilePicker";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { putSession } from "@/app/utils/sessionStore";
import { downloadBlob, getScreenUpDocDirection } from "@/app/utils/exportDocument";
import { buildPdfWithMarkups } from "@/app/utils/pdfSave";

/**
 * - "in-place" (Ctrl+S): a PDF tab saves its markups into the PDF itself (editable when
 *   reopened here); a tab linked to a .mkup, or an image, behaves like "linked".
 * - "linked": overwrite the tab's linked .mkup; without a link, behaves like "Save as"
 *   and links the chosen file.
 * - "choose-location": always ask where to save, then link that file.
 * - "download": save a copy to Downloads (no link).
 */
export type ProjectSaveMode = "in-place" | "linked" | "choose-location" | "download";

function isProjectHandle(handle: FileSystemFileHandle | null): handle is FileSystemFileHandle {
  return !!handle && handle.name.toLowerCase().endsWith(".mkup");
}

type SavableTab = Pick<
  DocumentTab,
  | "id"
  | "fileBytes"
  | "fileName"
  | "fileType"
  | "fileMimeType"
  | "scale"
  | "measurements"
  | "rectangles"
  | "notes"
  | "shapes"
  | "zoom"
  | "rotation"
  | "projectHandle"
  | "toolColors"
  | "documentViewport"
>;

/**
 * Save a tab as a .mkup project. Returns the written file's name, or null when the
 * user cancelled. Always refreshes the browser backup first, so declining Chrome's
 * file-permission prompt (SavePermissionError) still keeps the work.
 */
export async function saveTabProject(
  tab: SavableTab,
  displayUnit: Unit,
  mode: ProjectSaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<string | null> {
  if (!tab.fileBytes || !tab.fileName || !tab.fileType) return null;

  const blob = buildProjectBlob({
    fileName: tab.fileName,
    fileType: tab.fileType,
    mimeType: tab.fileMimeType ?? "",
    fileBytes: tab.fileBytes,
    scale: tab.scale,
    measurements: tab.measurements,
    rectangles: tab.rectangles,
    notes: tab.notes,
    shapes: tab.shapes,
    displayUnit,
    zoom: tab.zoom,
    rotation: tab.rotation,
    toolColors: tab.toolColors,
  });

  const backup = (handle: FileSystemFileHandle | null) =>
    putSession({
      id: tab.id,
      fileName: handle?.name ?? getProjectFileName(tab.fileName!),
      project: blob,
      handle,
      savedAt: Date.now(),
    });
  await backup(tab.projectHandle);

  if (mode === "in-place" && tab.fileType === "pdf" && !isProjectHandle(tab.projectHandle)) {
    return savePdfInPlace(tab, displayUnit, dispatch);
  }

  const projectHandle = isProjectHandle(tab.projectHandle) ? tab.projectHandle : null;
  if ((mode === "linked" || mode === "in-place") && projectHandle) {
    await writeBlobToHandle(projectHandle, blob);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return projectHandle.name;
  }

  const persistMode =
    mode === "download" || !supportsSaveFilePicker() ? "download" : "choose-location";
  const fileName = projectHandle?.name ?? getProjectFileName(tab.fileName);
  const result = await persistProjectBlob(blob, fileName, persistMode);
  if (!result.saved) return null;

  if (result.handle) {
    dispatch({ type: "SET_PROJECT_HANDLE", tabId: tab.id, handle: result.handle });
    await backup(result.handle);
  }
  dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
  return result.handle?.name ?? fileName;
}

/** Writes the markups into the tab's PDF: its linked file, or a picked/downloaded one. */
async function savePdfInPlace(
  tab: SavableTab,
  displayUnit: Unit,
  dispatch: Dispatch<AppAction>,
): Promise<string | null> {
  const blob = await buildPdfWithMarkups(
    tab.fileBytes!,
    {
      scale: tab.scale,
      measurements: tab.measurements,
      rectangles: tab.rectangles,
      notes: tab.notes,
      shapes: tab.shapes,
      displayUnit,
      zoom: tab.zoom,
      rotation: tab.rotation,
      toolColors: tab.toolColors,
    },
    getScreenUpDocDirection(tab.documentViewport, "pdf"),
  );

  if (tab.projectHandle) {
    await writeBlobToHandle(tab.projectHandle, blob);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return tab.projectHandle.name;
  }

  // Opened without a file handle (older browser or file input): save as the same name.
  const fileName = tab.fileName!;
  if (supportsSaveFilePicker()) {
    let handle: FileSystemFileHandle | null;
    try {
      handle = await writeBlobWithSaveFilePicker(blob, fileName);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
    if (handle) {
      dispatch({ type: "SET_PROJECT_HANDLE", tabId: tab.id, handle });
      dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
      return handle.name;
    }
  }
  downloadBlob(blob, fileName);
  dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
  return fileName;
}

/** saveTabProject plus the save toast: Saving… → Saved / cancelled / browser-only / error. */
export async function saveTabWithFeedback(
  tab: SavableTab,
  displayUnit: Unit,
  mode: ProjectSaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<boolean> {
  showSaveStatus("saving", "Saving…");
  try {
    const savedName = await saveTabProject(tab, displayUnit, mode, dispatch);
    if (!savedName) {
      showSaveStatus("info", "Save cancelled");
      return false;
    }
    showSaveStatus("success", "Saved");
    return true;
  } catch (error) {
    if (error instanceof SavePermissionError) {
      showSaveStatus(
        "warning",
        `Saved in this browser. Allow file access to also update ${error.fileName}.`,
      );
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      showSaveStatus("error", `Couldn't save: ${message}`);
    }
    return false;
  }
}
