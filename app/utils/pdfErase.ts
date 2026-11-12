import { PDFArray, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import type { Point2D } from "@/app/types";

const CONTENTS = PDFName.of("Contents");
const num = (value: number) => String(Math.round(value * 1000) / 1000);

/** Even-odd clip of the page box with the polygon as a hole: nothing drawn after it shows inside the polygon. */
export function eraseClipOps(box: { x: number; y: number; width: number; height: number }, polygon: Point2D[]): string {
  const ring = polygon.map((p, i) => `${num(p.x)} ${num(p.y)} ${i ? "l" : "m"}`).join("\n");
  return `q\n${num(box.x)} ${num(box.y)} ${num(box.width)} ${num(box.height)} re\n${ring}\nh\nW* n\n`;
}

/**
 * Erases the polygon (PDF user-space points) from a page, like Bluebeam's Erase Content:
 * the page's existing content is wrapped in a clip that leaves the polygon empty.
 * The content is hidden, not deleted: text inside can still be extracted, so it is not a redaction.
 */
export async function erasePdfArea(bytes: Uint8Array, pageIndex: number, polygon: Point2D[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(bytes, { updateMetadata: false });
  const { context } = pdfDoc;
  const page = pdfDoc.getPage(pageIndex);
  const raw = page.node.get(CONTENTS);
  const resolved = raw instanceof PDFRef ? context.lookup(raw) : raw;
  const items = resolved instanceof PDFArray ? resolved.asArray() : raw ? [raw] : [];
  const before = context.register(context.stream(eraseClipOps(page.getMediaBox(), polygon)));
  const after = context.register(context.stream("\nQ\n"));
  page.node.set(CONTENTS, context.obj([before, ...items, after]));
  return pdfDoc.save();
}
