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
  MarkupGroup,
  Measurement,
  NoteAnnotation,
  RectMeasurement,
  Scale,
  ShapeAnnotation,
  Unit,
} from "@/app/types";
import { drawMarkupsOnPdf } from "@/app/utils/exportDocument";
import { isValidMarkupData } from "@/app/utils/groups";
import { pageOf, pagesWithMarkups, screenUpForRotation, withPages } from "@/app/utils/pages";
import type { ColorTool } from "@/app/utils/settings";
import { clampZoom } from "@/app/utils/zoomLevels";

/**
 * Markups saved straight into a PDF (Ctrl+S on a PDF tab). They are drawn onto their
 * pages so any viewer shows them, and the editable data rides along in the catalog.
 * Every object the drawing added is tagged, so reopening strips them back off and the
 * markups come back as editable objects instead of being drawn twice. The file keeps
 * every page, whichever ones the tab shows.
 */
const DATA_KEY = PDFName.of("MarkupAppData");
const OWNED_KEY = PDFName.of("MarkupAppOwned");
/** v2: markups carry a `page`; scale and rotation are per page. */
const DATA_VERSION = 2;
const RESOURCE_CATEGORIES = ["Font", "XObject", "ExtGState"].map((name) => PDFName.of(name));

export interface PdfMarkupData {
  version: number;
  /** Page 1's scale. `scales` has every page's, in PDFs saved since multi-page support. */
  scale: Scale | null;
  scales?: Record<number, Scale>;
  /** Page 1's rotation; `rotations` has every page's. */
  rotations?: Record<number, DocumentRotation>;
  /** The page on screen when saved. */
  page?: number;
  /** The pages the tab shows. */
  sheets?: number[] | null;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  /** Absent in PDFs saved before Markups-panel groups. */
  groups?: MarkupGroup[];
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

/** Every page's resource sub-dictionaries (fonts, images, graphics states), once each: pages can share them. */
function resourceDicts(pdfDoc: PDFDocument): PDFDict[] {
  const dicts = new Set<PDFDict>();
  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    for (const category of RESOURCE_CATEGORIES) {
      const dict = resources?.lookup(category);
      if (dict instanceof PDFDict) dicts.add(dict);
    }
  }
  return [...dicts];
}

function resourceNames(pdfDoc: PDFDocument): Set<string> {
  return new Set(resourceDicts(pdfDoc).flatMap((dict) => dict.keys().map((key) => key.asString())));
}

/** The pristine PDF with the markups drawn on and their data embedded. */
export async function buildPdfWithMarkups(
  pristine: Uint8Array,
  data: Omit<PdfMarkupData, "version">,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(pristine, { updateMetadata: false });
  const before = new Set(pdfDoc.context.enumerateIndirectObjects().map(([ref]) => ref.tag));
  const namesBefore = resourceNames(pdfDoc);

  const { scales, rotations } = withPages(data);
  const lists = [data.measurements, data.rectangles, data.notes, data.shapes];
  // A page number past the end only comes from a damaged file; it mustn't stop the save.
  const pages = [...pagesWithMarkups(lists)].filter((page) => page < pdfDoc.getPageCount());
  await drawMarkupsOnPdf(
    pdfDoc,
    pages.map((page) => {
      const here = <T extends { page?: number }>(list: T[]) => list.filter((m) => pageOf(m) === page);
      return {
        page,
        measurements: here(data.measurements),
        rectangles: here(data.rectangles),
        notes: here(data.notes),
        shapes: here(data.shapes),
        scale: scales[page] ?? null,
        screenUpDoc: screenUpForRotation(rotations[page] ?? 0),
      };
    }),
    data.displayUnit,
  );

  const json = JSON.stringify({ ...data, version: DATA_VERSION } satisfies PdfMarkupData);
  // Bytes, not the string: flateStream keeps one byte per character, mangling anything non-ASCII.
  const dataRef = pdfDoc.context.register(pdfDoc.context.flateStream(new TextEncoder().encode(json)));
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
  if (typeof data.version !== "number" || data.version > DATA_VERSION || !isValidMarkupData(data)) {
    return null;
  }

  const { context } = pdfDoc;
  const owned = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (dictOf(object)?.get(OWNED_KEY) === PDFBool.True) owned.add(ref.tag);
  }
  const isOwned = (value: PDFObject | undefined) =>
    value instanceof PDFRef
      ? owned.has(value.tag)
      : dictOf(value)?.get(OWNED_KEY) === PDFBool.True;

  for (const page of pdfDoc.getPages()) {
    const contents = page.node.get(PDFName.of("Contents"));
    if (contents instanceof PDFArray) {
      for (let i = contents.size() - 1; i >= 0; i--) {
        if (isOwned(contents.get(i))) contents.remove(i);
      }
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

  return { pristine: await pdfDoc.save(), data: { ...data, zoom: clampZoom(data.zoom) } };
}
