import type { Dispatch } from "react";
import type { AppAction, DocumentTab, Unit } from "@/app/types";
import {
  buildProjectBlob,
  getProjectFileName,
  persistProjectBlob,
} from "@/app/utils/projectFile";
import { supportsSaveFilePicker, writeBlobToHandle } from "@/app/utils/saveFilePicker";

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
  | "zoom"
  | "rotation"
  | "projectHandle"
>;

/** Save a tab as a .mkup project. Returns true when the file was written. */
export async function saveTabProject(
  tab: SavableTab,
  displayUnit: Unit,
  mode: ProjectSaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<boolean> {
  if (!tab.fileBytes || !tab.fileName || !tab.fileType) return false;

  const blob = buildProjectBlob({
    fileName: tab.fileName,
    fileType: tab.fileType,
    mimeType: tab.fileMimeType ?? "",
    fileBytes: tab.fileBytes,
    scale: tab.scale,
    measurements: tab.measurements,
    rectangles: tab.rectangles,
    notes: tab.notes,
    displayUnit,
    zoom: tab.zoom,
    rotation: tab.rotation,
  });

  if (mode === "linked" && tab.projectHandle) {
    await writeBlobToHandle(tab.projectHandle, blob);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id });
    return true;
  }

  const persistMode =
    mode === "download" || !supportsSaveFilePicker() ? "download" : "choose-location";
  const result = await persistProjectBlob(
    blob,
    tab.projectHandle?.name ?? getProjectFileName(tab.fileName),
    persistMode,
  );
  if (!result.saved) return false;

  if (result.handle) {
    dispatch({ type: "SET_PROJECT_HANDLE", tabId: tab.id, handle: result.handle });
  }
  dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id });
  return true;
}
