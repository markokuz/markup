import type {
  DocumentRotation,
  DocumentType,
  Measurement,
  NoteAnnotation,
  MarkupGroup,
  RectMeasurement,
  ShapeAnnotation,
  Scale,
  Unit,
} from "@/app/types";
import { isValidMarkupData, withGroups } from "@/app/utils/groups";
import { withPages } from "@/app/utils/pages";
import type { ColorTool } from "@/app/utils/settings";
import { clampZoom } from "@/app/utils/zoomLevels";

const PROJECT_FILE_EXTENSION = ".mkup";
const PROJECT_FILE_MAGIC = "markup-project";
/**
 * v2: rotated (90°/270°) image coordinates use the corrected view mapping.
 * v1 files with a rotated image need `legacyRotatedImage` migration on load.
 * v3: multi-page PDFs; markups carry a `page`, and scale and rotation are per page.
 */
const PROJECT_FILE_VERSION = 3;

export const PROJECT_ACCEPT = ".mkup,application/json";

export interface ProjectFilePayload {
  magic: typeof PROJECT_FILE_MAGIC;
  version: number;
  fileName: string;
  fileType: DocumentType;
  mimeType: string;
  /** Base64-encoded original document bytes. */
  fileBytesBase64: string;
  /** Page 1's scale. `scales` has every page's, in files saved since multi-page PDFs. */
  scale: Scale | null;
  scales?: Record<number, Scale>;
  /** Page 1's rotation; `rotations` has every page's. */
  rotations?: Record<number, DocumentRotation>;
  /** The page on screen when saved. */
  page?: number;
  /** The pages the tab shows; the file itself keeps them all. */
  sheets?: number[] | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  /** Absent in projects saved before area/count/cloud/callout existed. */
  shapes?: ShapeAnnotation[];
  /** Absent in projects saved before Markups-panel groups. */
  groups?: MarkupGroup[];
  displayUnit: Unit;
  zoom: number;
  rotation: DocumentRotation;
  /** Absent in projects saved before per-document tool colours existed. */
  toolColors?: Partial<Record<ColorTool, string>>;
}

export interface LoadedProject {
  bytes: Uint8Array;
  fileName: string;
  fileType: DocumentType;
  mimeType: string;
  scales: Record<number, Scale>;
  rotations: Record<number, DocumentRotation>;
  page: number;
  sheets: number[] | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  groups: MarkupGroup[];
  displayUnit: Unit;
  zoom: number;
  /** Saved before v2 with an image rotated 90°/270°: coordinates need shifting. */
  legacyRotatedImage: boolean;
  toolColors: Partial<Record<ColorTool, string>>;
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

  if (
    !isValidMarkupData(payload) ||
    (payload.fileType !== "pdf" && payload.fileType !== "image") ||
    typeof payload.fileName !== "string" ||
    typeof payload.fileBytesBase64 !== "string"
  ) {
    throw new Error("This project file is damaged or incomplete.");
  }

  const markups = withGroups({
    measurements: payload.measurements,
    rectangles: payload.rectangles,
    notes: payload.notes,
    shapes: payload.shapes ?? [],
    groups: payload.groups,
  });
  return {
    bytes: base64ToBytes(payload.fileBytesBase64),
    fileName: payload.fileName,
    fileType: payload.fileType,
    mimeType: payload.mimeType,
    ...withPages(payload),
    ...markups,
    displayUnit: payload.displayUnit,
    zoom: clampZoom(payload.zoom),
    toolColors: payload.toolColors ?? {},
    legacyRotatedImage:
      payload.version < 2 &&
      payload.fileType === "image" &&
      (payload.rotation === 90 || payload.rotation === 270),
  };
}
