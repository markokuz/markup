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
import {
  buildMarkedUpImageBlob,
  downloadBlob,
  getScreenUpDocDirection,
} from "@/app/utils/exportDocument";
import { buildPdfWithMarkups } from "@/app/utils/pdfSave";

/**
 * - "save" (Ctrl+S): overwrite the file the tab is linked to: a .mkup, a PDF (markups
 *   drawn on plus their edit data, so it reopens editable here), or a PNG saved earlier.
 *   Unlinked tabs behave like "save-as".
 * - "save-as": pick where to save the PDF (or a flattened PNG for images), then edit that file.
 * - "save-project-as": pick where to save a .mkup, then edit that file.
 */
export type SaveMode = "save" | "save-as" | "save-project-as";

export function isProjectHandle(handle: FileSystemFileHandle | null): boolean {
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
  | "groups"
  | "zoom"
  | "rotation"
  | "projectHandle"
  | "toolColors"
  | "documentViewport"
>;

/** Suggested name for an image saved as a flattened PNG. */
function markedUpPngName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, "")}-markup.png`;
}

/**
 * Save a tab. Returns the written file's name, or null when the user cancelled. Always
 * refreshes the browser backup first, so declining Chrome's file-permission prompt
 * (SavePermissionError) still keeps the work.
 */
export async function saveTab(
  tab: SavableTab,
  displayUnit: Unit,
  mode: SaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<string | null> {
  if (!tab.fileBytes || !tab.fileName || !tab.fileType) return null;

  const project = buildProjectBlob({
    fileName: tab.fileName,
    fileType: tab.fileType,
    mimeType: tab.fileMimeType ?? "",
    fileBytes: tab.fileBytes,
    scale: tab.scale,
    measurements: tab.measurements,
    rectangles: tab.rectangles,
    notes: tab.notes,
    shapes: tab.shapes,
    groups: tab.groups,
    displayUnit,
    zoom: tab.zoom,
    rotation: tab.rotation,
    toolColors: tab.toolColors,
  });

  const backup = (handle: FileSystemFileHandle | null) =>
    putSession({
      id: tab.id,
      fileName: handle?.name ?? getProjectFileName(tab.fileName!),
      project,
      handle,
      savedAt: Date.now(),
    });
  await backup(tab.projectHandle);

  // The saved file becomes the one this tab edits: later Ctrl+S saves go to it.
  const adopt = async (handle: FileSystemFileHandle) => {
    dispatch({
      type: "SET_PROJECT_HANDLE",
      tabId: tab.id,
      handle,
      // An image keeps its own name: decoding TIFF/HEIC sources goes by it.
      ...(tab.fileType === "pdf" && !isProjectHandle(handle) ? { fileName: handle.name } : {}),
    });
    await backup(handle);
  };

  if (mode === "save-project-as") {
    const fileName =
      tab.projectHandle && isProjectHandle(tab.projectHandle)
        ? tab.projectHandle.name
        : getProjectFileName(tab.fileName);
    const result = await persistProjectBlob(
      project,
      fileName,
      supportsSaveFilePicker() ? "choose-location" : "download",
    );
    if (!result.saved) return null;
    if (result.handle) await adopt(result.handle);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return result.handle?.name ?? fileName;
  }

  if (mode === "save" && tab.projectHandle && isProjectHandle(tab.projectHandle)) {
    await writeBlobToHandle(tab.projectHandle, project);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return tab.projectHandle.name;
  }

  const output =
    tab.fileType === "pdf"
      ? await buildPdfWithMarkups(
          tab.fileBytes,
          {
            scale: tab.scale,
            measurements: tab.measurements,
            rectangles: tab.rectangles,
            notes: tab.notes,
            shapes: tab.shapes,
            groups: tab.groups,
            displayUnit,
            zoom: tab.zoom,
            rotation: tab.rotation,
            toolColors: tab.toolColors,
          },
          getScreenUpDocDirection(tab.documentViewport, "pdf"),
        )
      : await buildMarkedUpImageBlob(
          tab.fileBytes,
          tab.fileName,
          tab.fileMimeType ?? "",
          tab.measurements,
          tab.rectangles,
          tab.notes,
          tab.shapes,
          tab.scale,
          displayUnit,
          tab.zoom,
          getScreenUpDocDirection(tab.documentViewport, "image"),
        );
  if (!output) throw new Error("nothing was generated");

  if (mode === "save" && tab.projectHandle && !isProjectHandle(tab.projectHandle)) {
    await writeBlobToHandle(tab.projectHandle, output);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return tab.projectHandle.name;
  }

  const suggestedName = tab.fileType === "pdf" ? tab.fileName : markedUpPngName(tab.fileName);
  if (supportsSaveFilePicker()) {
    let handle: FileSystemFileHandle | null;
    try {
      handle = await writeBlobWithSaveFilePicker(output, suggestedName);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
      throw error;
    }
    if (handle) {
      await adopt(handle);
      dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
      return handle.name;
    }
  }
  downloadBlob(output, suggestedName);
  dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
  return suggestedName;
}

/** saveTab plus the save toast: Saving… → Saved / cancelled / browser-only / error. */
export async function saveTabWithFeedback(
  tab: SavableTab,
  displayUnit: Unit,
  mode: SaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<boolean> {
  showSaveStatus("saving", "Saving…");
  try {
    const savedName = await saveTab(tab, displayUnit, mode, dispatch);
    if (!savedName) {
      showSaveStatus("info", "Save cancelled");
      return false;
    }
    showSaveStatus("success", `Saved ${savedName}`);
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
