import type { Dispatch } from "react";
import type { AppAction, DocumentTab, Unit } from "@/app/types";
import { buildProjectBlob, getProjectFileName } from "@/app/utils/projectFile";
import {
  requestWritePermission,
  saveBlobAs,
  SavePermissionError,
  SaveWriteError,
  writeBlobToHandle,
} from "@/app/utils/saveFilePicker";
import { describeWriteFailure } from "@/app/utils/saveError";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { buildMarkedUpImageBlob, getScreenUpDocDirection } from "@/app/utils/exportDocument";
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
  | "scales"
  | "rotations"
  | "page"
  | "sheets"
  | "measurements"
  | "rectangles"
  | "notes"
  | "shapes"
  | "groups"
  | "zoom"
  | "projectHandle"
  | "toolColors"
  | "documentViewport"
>;

/** Suggested name for an image saved as a flattened PNG. */
function markedUpPngName(fileName: string): string {
  return `${fileName.replace(/\.[^.]+$/, "")}-markup.png`;
}

/** Save a tab to a file. Returns the written file's name, or null when the user cancelled. */
async function saveTab(
  tab: SavableTab,
  displayUnit: Unit,
  mode: SaveMode,
  dispatch: Dispatch<AppAction>,
): Promise<string | null> {
  const { fileBytes, fileName, fileType } = tab;
  if (!fileBytes || !fileName || !fileType) return null;

  const markups = {
    // Page 1's, which is all a file from before multi-page PDFs had.
    scale: tab.scales[0] ?? null,
    rotation: tab.rotations[0] ?? 0,
    scales: tab.scales,
    rotations: tab.rotations,
    page: tab.page,
    sheets: tab.sheets,
    measurements: tab.measurements,
    rectangles: tab.rectangles,
    notes: tab.notes,
    shapes: tab.shapes,
    groups: tab.groups,
    displayUnit,
    zoom: tab.zoom,
    toolColors: tab.toolColors,
  };
  const projectBlob = (bytes: Uint8Array) =>
    buildProjectBlob({
      ...markups,
      fileName,
      fileType,
      mimeType: tab.fileMimeType ?? "",
      fileBytes: bytes,
    });

  const linked = tab.projectHandle;
  // Ask before building the PDF: Chrome refuses the prompt once the key press is a few seconds old.
  const permission = mode === "save" && linked ? requestWritePermission(linked) : null;
  permission?.catch(() => {}); // awaited below; this only silences an early unhandled rejection

  // The saved file becomes the one this tab edits: later Ctrl+S saves go to it.
  const adopt = (handle: FileSystemFileHandle) =>
    dispatch({
      type: "SET_PROJECT_HANDLE",
      tabId: tab.id,
      handle,
      // An image keeps its own name: decoding TIFF/HEIC sources goes by it.
      ...(fileType === "pdf" && !isProjectHandle(handle) ? { fileName: handle.name } : {}),
    });

  const writeToLinkedFile = async (handle: FileSystemFileHandle, blob: Blob) => {
    if (permission && !(await permission)) throw new SavePermissionError(handle.name);
    await writeBlobToHandle(handle, blob);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return handle.name;
  };

  const saveAs = async (blob: Blob, suggestedName: string) => {
    const result = await saveBlobAs(blob, suggestedName);
    if (!result) return null;
    if (result.handle) adopt(result.handle);
    dispatch({ type: "MARK_TAB_SAVED", tabId: tab.id, saved: tab });
    return result.handle?.name ?? suggestedName;
  };

  if (mode === "save-project-as") {
    return saveAs(
      projectBlob(fileBytes),
      linked && isProjectHandle(linked) ? linked.name : getProjectFileName(fileName),
    );
  }
  if (mode === "save" && linked && isProjectHandle(linked)) {
    return writeToLinkedFile(linked, projectBlob(fileBytes));
  }

  const output =
    fileType === "pdf"
      ? await buildPdfWithMarkups(fileBytes, markups)
      : await buildMarkedUpImageBlob(
          fileBytes,
          fileName,
          tab.fileMimeType ?? "",
          tab.measurements,
          tab.rectangles,
          tab.notes,
          tab.shapes,
          tab.scales[0] ?? null,
          displayUnit,
          getScreenUpDocDirection(tab.documentViewport, "image"),
        );
  if (!output) throw new Error("nothing was generated");

  if (mode === "save" && linked) return writeToLinkedFile(linked, output);
  return saveAs(output, fileType === "pdf" ? fileName : markedUpPngName(fileName));
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
        "error",
        `${error.fileName} wasn't saved`,
        "Allow file access when the browser asks, or use Save As.",
      );
    } else if (error instanceof SaveWriteError) {
      // The toast drops the browser's wording, so keep it here for debugging.
      console.error(`Couldn't write ${error.fileName}:`, error.reason);
      const { text, hint } = describeWriteFailure(error.fileName, error.reason);
      showSaveStatus("error", text, hint);
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      showSaveStatus("error", `Couldn't save: ${message}`);
    }
    return false;
  }
}
