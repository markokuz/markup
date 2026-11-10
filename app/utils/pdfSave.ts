import {
  decodePDFRawStream,
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  type PDFObject,
  type PDFPage,
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
 * pages so any viewer shows them, and each page carries its own editable data. Every
 * object the drawing added is tagged, so reopening strips them back off and the
 * markups come back as editable objects instead of being drawn twice. The file keeps
 * every page, whichever ones the tab shows.
 */
/** Where files saved before v3 kept all the data. Read only: tools that rebuild PDFs drop it. */
const DATA_KEY = PDFName.of("MarkupAppData");
const OWNED_KEY = PDFName.of("MarkupAppOwned");
const PAGE_KEY = PDFName.of("MarkupAppPage");
/** v2: markups carry a `page`; scale and rotation are per page. v3: each page carries its own data. */
const DATA_VERSION = 3;
const RESOURCE_CATEGORIES = ["Font", "XObject", "ExtGState"].map((name) => PDFName.of(name));
const CONTENTS = PDFName.of("Contents");

export interface PdfMarkupData {
  version: number;
  /** Page 1's scale. `scales` has every page's, in PDFs saved since multi-page support. */
  scale: Scale | null;
  scales?: Record<number, Scale>;
  /** Page 1's rotation; `rotations` has every page's. */
  rotations?: Record<number, DocumentRotation>;
  /**
   * The page on screen and the pages shown, in files saved before v3. Neither is saved or
   * read now: opening a PDF always asks which pages to show.
   */
  page?: number;
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

/**
 * One page's data (v3), kept on a content stream of that page. Tools that edit PDFs
 * (iLovePDF) drop unknown catalog entries but keep these, and moving, removing or adding
 * pages takes each page's markups with it.
 */
interface PageRecord {
  version: number;
  /** The page's position when saved. */
  index: number;
  measurements: Measurement[];
  rectangles: RectMeasurement[];
  notes: NoteAnnotation[];
  shapes: ShapeAnnotation[];
  scale: Scale | null;
  rotation?: DocumentRotation;
  /** The same on every page. */
  doc: Pick<PdfMarkupData, "groups" | "displayUnit" | "zoom" | "toolColors">;
}

export interface PdfMarkupRead {
  /** The PDF with everything this app added removed. */
  pristine: Uint8Array;
  data: PdfMarkupData;
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

function contentItems(page: PDFPage): PDFObject[] {
  const contents = page.node.get(CONTENTS);
  if (contents instanceof PDFArray) return contents.asArray();
  return contents ? [contents] : [];
}

/**
 * Tags already in the bytes being saved are left from a save whose data couldn't be read
 * back (a read that worked strips them). Their drawings become part of the page for good,
 * or a later read would strip markups it has no data for.
 */
function untagLeftovers(pdfDoc: PDFDocument) {
  for (const [, object] of pdfDoc.context.enumerateIndirectObjects()) {
    const dict = dictOf(object);
    dict?.delete(OWNED_KEY);
    dict?.delete(PAGE_KEY);
  }
  for (const dict of resourceDicts(pdfDoc)) {
    for (const [, value] of dict.entries()) dictOf(value)?.delete(OWNED_KEY);
  }
  pdfDoc.catalog.delete(DATA_KEY);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The pristine PDF with the markups drawn on and their data embedded. */
export async function buildPdfWithMarkups(
  pristine: Uint8Array,
  data: Omit<PdfMarkupData, "version">,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.load(pristine, { updateMetadata: false });
  untagLeftovers(pdfDoc);
  const before = new Set(pdfDoc.context.enumerateIndirectObjects().map(([ref]) => ref.tag));
  const namesBefore = resourceNames(pdfDoc);

  const { scales, rotations } = withPages(data);
  const lists = [data.measurements, data.rectangles, data.notes, data.shapes];
  const pageCount = pdfDoc.getPageCount();
  // A page number past the end only comes from a damaged file; it mustn't stop the save.
  const inFile = (page: number) => page < pageCount;
  const onPage = (page: number) => {
    const here = <T extends { page?: number }>(list: T[]) => list.filter((m) => pageOf(m) === page);
    return {
      measurements: here(data.measurements),
      rectangles: here(data.rectangles),
      notes: here(data.notes),
      shapes: here(data.shapes),
    };
  };
  await drawMarkupsOnPdf(
    pdfDoc,
    [...pagesWithMarkups(lists)].filter(inFile).map((page) => ({
      page,
      ...onPage(page),
      scale: scales[page] ?? null,
      screenUpDoc: screenUpForRotation(rotations[page] ?? 0),
    })),
    data.displayUnit,
  );

  // Every page with something to restore carries it. Page 1 always does, so the
  // document-wide settings survive in a file without markups.
  const recordPages = new Set([
    0,
    ...pagesWithMarkups(lists),
    ...Object.keys(scales).map(Number),
    ...Object.keys(rotations).map(Number),
  ]);
  const doc = {
    groups: data.groups,
    displayUnit: data.displayUnit,
    zoom: data.zoom,
    toolColors: data.toolColors,
  };
  for (const page of [...recordPages].filter(inFile)) {
    const record: PageRecord = {
      version: DATA_VERSION,
      index: page,
      ...onPage(page),
      scale: scales[page] ?? null,
      rotation: rotations[page],
      doc,
    };
    // shortcut: uncompressed hex, 2 bytes per JSON byte on each page; compress it if big takeoffs bloat files.
    const stream = pdfDoc.context.stream("q\nQ\n");
    stream.dict.set(PAGE_KEY, PDFHexString.of(toHex(new TextEncoder().encode(JSON.stringify(record)))));
    pdfDoc.getPage(page).node.addContentStream(pdfDoc.context.register(stream));
  }
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

  // Plain (non-stream) objects keep the key names visible to the quick check on open.
  const output = await pdfDoc.save({ useObjectStreams: false });
  return new Blob([output.buffer as ArrayBuffer], { type: "application/pdf" });
}

function isRecord(value: unknown): value is PageRecord {
  const record = value as PageRecord;
  return (
    typeof record === "object" &&
    record !== null &&
    typeof record.version === "number" &&
    record.version <= DATA_VERSION &&
    Number.isInteger(record.index) &&
    typeof record.doc === "object" &&
    record.doc !== null
  );
}

/** The whole document's data from its pages' records, each markup on its page's current position. */
function fromRecords(records: Map<number, PageRecord>): PdfMarkupData {
  const all = [...records].sort(([a], [b]) => a - b);
  const { doc } = all[0][1];
  const onCurrentPages = <T extends { page?: number }>(list: (record: PageRecord) => T[]): T[] =>
    all.flatMap(([page, record]) => list(record).map((markup) => ({ ...markup, page })));
  const measurements = onCurrentPages((r) => r.measurements);
  const rectangles = onCurrentPages((r) => r.rectangles);
  const notes = onCurrentPages((r) => r.notes);
  const shapes = onCurrentPages((r) => r.shapes);
  const scales = Object.fromEntries(all.flatMap(([page, r]) => (r.scale ? [[page, r.scale]] : [])));
  const rotations = Object.fromEntries(
    all.flatMap(([page, r]) => (r.rotation === undefined ? [] : [[page, r.rotation]])),
  );
  return {
    version: DATA_VERSION,
    scale: scales[0] ?? null,
    scales,
    rotations,
    rotation: rotations[0] ?? 0,
    measurements,
    rectangles,
    notes,
    shapes,
    groups: doc.groups,
    displayUnit: doc.displayUnit,
    zoom: doc.zoom,
    toolColors: doc.toolColors,
  };
}

/**
 * Reads markups saved by buildPdfWithMarkups. Null for any other PDF, and for one whose
 * markup data can't be used: its markups then show as part of the page.
 */
export async function readPdfWithMarkups(bytes: Uint8Array): Promise<PdfMarkupRead | null> {
  // Skip parsing every other PDF: ours always has the key names in plain bytes.
  if (!containsAscii(bytes, "/MarkupApp")) return null;
  return readOwnPdf(bytes).catch(() => null);
}

async function readOwnPdf(bytes: Uint8Array): Promise<PdfMarkupRead | null> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { context } = pdfDoc;
  const pages = pdfDoc.getPages();

  // Current page → its record. A page copied twice elsewhere keeps only the first copy's
  // markups editable, or their ids would clash; the other copy stays a drawing.
  const records = new Map<number, PageRecord>();
  const savedIndices = new Set<number>();
  pages.forEach((page, current) => {
    for (const item of contentItems(page)) {
      const value = dictOf(item instanceof PDFRef ? context.lookup(item) : item)?.get(PAGE_KEY);
      if (!(value instanceof PDFHexString) || records.has(current)) continue;
      let record: unknown;
      try {
        record = JSON.parse(new TextDecoder().decode(value.asBytes()));
      } catch {
        continue;
      }
      if (!isRecord(record) || savedIndices.has(record.index)) continue;
      savedIndices.add(record.index);
      records.set(current, record);
    }
  });

  let data: PdfMarkupData;
  let covered: (page: number) => boolean;
  if (records.size > 0) {
    data = fromRecords(records);
    covered = (page) => records.has(page);
  } else {
    const dataStream = pdfDoc.catalog.lookup(DATA_KEY);
    if (!(dataStream instanceof PDFRawStream)) return null;
    data = JSON.parse(new TextDecoder().decode(decodePDFRawStream(dataStream).decode())) as PdfMarkupData;
    if (typeof data.version !== "number" || data.version > 2 || !isValidMarkupData(data)) return null;
    // Older files: drawings on a page the data has no markups for came from an earlier save.
    const pagesWithData = pagesWithMarkups([data.measurements, data.rectangles, data.notes, data.shapes ?? []]);
    covered = (page) => pagesWithData.has(page);
  }
  if (!isValidMarkupData(data)) return null;

  const owned = new Set<string>();
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (dictOf(object)?.get(OWNED_KEY) === PDFBool.True) owned.add(ref.tag);
  }
  const isOwned = (value: PDFObject | undefined) =>
    value instanceof PDFRef
      ? owned.has(value.tag)
      : dictOf(value)?.get(OWNED_KEY) === PDFBool.True;

  let keptDrawings = false;
  const removed: PDFRef[] = [];
  pages.forEach((page, index) => {
    const contents = page.node.get(CONTENTS);
    if (!(contents instanceof PDFArray)) return;
    for (let i = contents.size() - 1; i >= 0; i--) {
      const item = contents.get(i);
      if (!isOwned(item)) continue;
      if (!covered(index)) {
        keptDrawings = true;
        continue;
      }
      contents.remove(i);
      if (item instanceof PDFRef) removed.push(item);
    }
  });
  if (keptDrawings) {
    // The kept drawings use the tagged fonts and graphics states, so only the stripped
    // streams go, and only those no kept page still shows (copied pages can share them).
    const stillShown = new Set(pages.flatMap((page) => contentItems(page)).map(String));
    for (const ref of removed) if (!stillShown.has(String(ref))) context.delete(ref);
  } else {
    for (const dict of resourceDicts(pdfDoc)) {
      for (const [name, value] of dict.entries()) {
        if (isOwned(value)) dict.delete(name);
      }
    }
    for (const [ref] of context.enumerateIndirectObjects()) {
      if (owned.has(ref.tag)) context.delete(ref);
    }
  }
  pdfDoc.catalog.delete(DATA_KEY);

  // Older files' saved page and sheets are dropped too, so they ask which pages to show.
  return {
    pristine: await pdfDoc.save(),
    data: { ...data, page: undefined, sheets: undefined, zoom: clampZoom(data.zoom) },
  };
}
