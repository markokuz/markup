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
} from "@/app/utils/saveFilePicker";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { putSession } from "@/app/utils/sessionStore";

/**
 * - "linked": overwrite the tab's linked .mkup (Ctrl+S); without a link, behaves
 *   like "Save as" and links the chosen file.
 * - "choose-location": always ask where to save, then link that file.
 * - "download": save a copy to Downloads (no link).
 */
export type ProjectSaveMode = "linked" | "choose-location" | "download";

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

  if (mode === "linked" && tab.projectHandle) {
    await writeBlobToHandle(tab.projectHandle, blob);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id });
    return tab.projectHandle.name;
  }

  const persistMode =
    mode === "download" || !supportsSaveFilePicker() ? "download" : "choose-location";
  const fileName = tab.projectHandle?.name ?? getProjectFileName(tab.fileName);
  const result = await persistProjectBlob(blob, fileName, persistMode);
  if (!result.saved) return null;

  if (result.handle) {
    dispatch({ type: "SET_PROJECT_HANDLE", tabId: tab.id, handle: result.handle });
    await backup(result.handle);
  }
  dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id });
  return result.handle?.name ?? fileName;
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
