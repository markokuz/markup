import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFObject,
} from "pdf-lib";
import type {
  DocumentRotation,
  Measurement,
  NoteAnnotation,
  Point2D,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
  Unit,
} from "@/app/types";
import { drawMarkupsOnPdf } from "@/app/utils/exportDocument";
import type { ColorTool } from "@/app/utils/settings";

/**
 * Markups saved straight into a PDF (Ctrl+S on a PDF tab). They are drawn onto page 1
 * so any viewer shows them, and the editable data rides along in the catalog. Every
 * object the drawing added is tagged, so reopening strips them back off and the
 * markups come back as editable objects instead of being drawn twice.
 */
const DATA_KEY = PDFName.of("MarkupAppData");
const OWNED_KEY = PDFName.of("MarkupAppOwned");
const DATA_VERSION = 1;
const RESOURCE_CATEGORIES = ["Font", "XObject", "ExtGState"].map((name) => PDFName.of(name));

export interface PdfMarkupData {
  version: number;
  scale: Scale | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  displayUnit: Unit;
  zoom: number;
  rotation: DocumentRotation;
  toolColors: Partial<Record<ColorTool, string>>;
}

function dictOf(object: PDFObject | undefined): PDFDict | null {
  if (object instanceof PDFDict) return object;
  if (object instanceof PDFStream) return object.dict;
  return null;
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const first = needle.charCodeAt(0);
  outer: for (let i = bytes.indexOf(first); i !== -1; i = bytes.indexOf(first, i + 1)) {
    for (let j = 1; j < needle.length; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

/** Page 1's resource sub-dictionaries (fonts, images, graphics states). */
function resourceDicts(pdfDoc: PDFDocument): PDFDict[] {
  const resources = pdfDoc.getPage(0).node.Resources();
  return RESOURCE_CATEGORIES.map((category) => resources?.lookup(category)).filter(
    (dict): dict is PDFDict => dict instanceof PDFDict,
  );
}

function resourceNames(pdfDoc: PDFDocument): Set<string> {
  return new Set(resourceDicts(pdfDoc).flatMap((dict) => dict.keys().map((key) => key.asString())));
}

/** The pristine PDF with the markups drawn on and their data embedded. */
export async function buildPdfWithMarkups(
  pristine: Uint8Array,
  data: Omit<PdfMarkupData, "version">,
  screenUpDoc: Point2D,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(pristine, { updateMetadata: false });
  const before = new Set(pdfDoc.context.enumerateIndirectObjects().map(([ref]) => ref.tag));
  const namesBefore = resourceNames(pdfDoc);

  await drawMarkupsOnPdf(
    pdfDoc,
    data.measurements,
    data.rectangles,
    data.notes,
    data.shapes,
    data.scale,
    data.displayUnit,
    data.zoom,
    screenUpDoc,
  );

  const json = JSON.stringify({ ...data, version: DATA_VERSION } satisfies PdfMarkupData);
  const dataRef = pdfDoc.context.register(pdfDoc.context.flateStream(json));
  pdfDoc.catalog.set(DATA_KEY, dataRef);
  // Fonts and images are only written into the document on flush; tag them too.
  await pdfDoc.flush();

  for (const [ref, object] of pdfDoc.context.enumerateIndirectObjects()) {
    if (!before.has(ref.tag)) dictOf(object)?.set(OWNED_KEY, PDFBool.True);
  }
  // Graphics states (opacity) are stored inline, not as objects: tag those entries too.
  for (const dict of resourceDicts(pdfDoc)) {
    for (const [name, value] of dict.entries()) {
      if (!namesBefore.has(name.asString())) dictOf(value)?.set(OWNED_KEY, PDFBool.True);
    }
  }

  // Plain (non-stream) objects keep the catalog key visible to the quick check on open.
  const output = await pdfDoc.save({ useObjectStreams: false });
  return new Blob([output.buffer as ArrayBuffer], { type: "application/pdf" });
}

/**
 * Reads markups saved by buildPdfWithMarkups. Returns null for any other PDF; otherwise
 * the markup data plus the PDF with everything this app added removed.
 */
export async function readPdfWithMarkups(
  bytes: Uint8Array,
): Promise<{ pristine: Uint8Array; data: PdfMarkupData } | null> {
  // Skip parsing every other PDF: ours always has the key name in plain bytes.
  if (!containsAscii(bytes, `/${DATA_KEY.decodeText()}`)) return null;
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const dataStream = pdfDoc.catalog.lookup(DATA_KEY);
  if (!(dataStream instanceof PDFRawStream)) return null;

  const data = JSON.parse(
    new TextDecoder().decode(decodePDFRawStream(dataStream).decode()),
  ) as PdfMarkupData;
  if (typeof data.version !== "number" || data.version > DATA_VERSION) return null;

  const { context } = pdfDoc;
  const owned = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (dictOf(object)?.get(OWNED_KEY) === PDFBool.True) owned.add(ref.tag);
  }
  const isOwned = (value: PDFObject | undefined) =>
    value instanceof PDFRef
      ? owned.has(value.tag)
      : dictOf(value)?.get(OWNED_KEY) === PDFBool.True;

  const page = pdfDoc.getPage(0).node;
  const contents = page.get(PDFName.of("Contents"));
  if (contents instanceof PDFArray) {
    for (let i = contents.size() - 1; i >= 0; i--) {
      if (isOwned(contents.get(i))) contents.remove(i);
    }
  }
  for (const dict of resourceDicts(pdfDoc)) {
    for (const [name, value] of dict.entries()) {
      if (isOwned(value)) dict.delete(name);
    }
  }
  for (const [ref] of context.enumerateIndirectObjects()) {
    if (owned.has(ref.tag)) context.delete(ref);
  }
  pdfDoc.catalog.delete(DATA_KEY);

  return { pristine: await pdfDoc.save(), data };
}
