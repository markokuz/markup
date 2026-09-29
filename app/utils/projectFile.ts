import type {
  DocumentRotation,
  DocumentType,
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  Scale,
  Unit,
} from "@/app/types";
import { writeBlobWithSaveFilePicker } from "@/app/utils/saveFilePicker";

const PROJECT_FILE_EXTENSION = ".mkup";
const PROJECT_FILE_MAGIC = "markup-project";
const PROJECT_FILE_VERSION = 1;

export const PROJECT_ACCEPT = ".mkup,application/json";

export interface ProjectFilePayload {
  magic: typeof PROJECT_FILE_MAGIC;
  version: number;
  fileName: string;
  fileType: DocumentType;
  mimeType: string;
  /** Base64-encoded original document bytes. */
  fileBytesBase64: string;
  scale: Scale | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  displayUnit: Unit;
  zoom: number;
  rotation: DocumentRotation;
}

export interface LoadedProject {
  bytes: Uint8Array;
  fileName: string;
  fileType: DocumentType;
  mimeType: string;
  scale: Scale | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  displayUnit: Unit;
  zoom: number;
  rotation: DocumentRotation;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function buildProjectBlob(project: Omit<ProjectFilePayload, "magic" | "version" | "fileBytesBase64"> & { fileBytes: Uint8Array }): Blob {
  const { fileBytes, ...rest } = project;
  const payload: ProjectFilePayload = {
    magic: PROJECT_FILE_MAGIC,
    version: PROJECT_FILE_VERSION,
    fileBytesBase64: bytesToBase64(fileBytes),
    ...rest,
  };
  return new Blob([JSON.stringify(payload)], { type: "application/json" });
}

export function isProjectFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(PROJECT_FILE_EXTENSION);
}

export function getProjectFileName(originalFileName: string): string {
  const base = originalFileName.replace(/\.[^.]+$/, "");
  return `${base}${PROJECT_FILE_EXTENSION}`;
}

export async function readProjectFile(file: File): Promise<LoadedProject> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);

  if (
    !parsed ||
    typeof parsed !== "object" ||
    (parsed as { magic?: unknown }).magic !== PROJECT_FILE_MAGIC
  ) {
    throw new Error("Not a Markup project file.");
  }

  const payload = parsed as ProjectFilePayload;
  if (payload.version > PROJECT_FILE_VERSION) {
    throw new Error(
      `Project file version ${payload.version} is newer than this app supports (${PROJECT_FILE_VERSION}).`,
    );
  }

  return {
    bytes: base64ToBytes(payload.fileBytesBase64),
    fileName: payload.fileName,
    fileType: payload.fileType,
    mimeType: payload.mimeType,
    scale: payload.scale,
    measurements: payload.measurements,
    rectangles: payload.rectangles,
    notes: payload.notes,
    displayUnit: payload.displayUnit,
    zoom: payload.zoom,
    rotation: payload.rotation,
  };
}

export async function persistProjectBlob(
  blob: Blob,
  fileName: string,
  saveMode: "download" | "choose-location",
): Promise<void> {
  if (saveMode === "choose-location") {
    try {
      const saved = await writeBlobWithSaveFilePicker(blob, fileName);
      if (saved) return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
