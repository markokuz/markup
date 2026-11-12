// Run: node app/utils/pdfErase.test.mjs
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";

const root = fileURLToPath(new URL("../../", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@/": root } });
const { erasePdfArea, eraseClipOps } = await jiti.import("./pdfErase.ts");

assert.equal(
  eraseClipOps({ x: 0, y: 0, width: 100, height: 50 }, [{ x: 10, y: 10 }, { x: 20.12345, y: 10 }, { x: 20, y: 30 }]),
  "q\n0 0 100 50 re\n10 10 m\n20.123 10 l\n20 30 l\nh\nW* n\n",
);

const source = await PDFDocument.create();
const font = await source.embedFont(StandardFonts.Helvetica);
for (const n of [1, 2]) source.addPage([792, 612]).drawText(`Sheet ${n}`, { x: 72, y: 540, size: 24, font });
const original = await source.save();

const square = [{ x: 50, y: 500 }, { x: 300, y: 500 }, { x: 300, y: 580 }, { x: 50, y: 580 }];
const text = (doc, ref) => {
  const stream = doc.context.lookup(ref);
  return new TextDecoder().decode(stream instanceof PDFRawStream ? decodePDFRawStream(stream).decode() : stream.getContents());
};
const contents = (doc, index) => {
  const value = doc.getPage(index).node.get(PDFName.of("Contents"));
  return value instanceof PDFArray ? value.asArray() : [value];
};

// Page 2's content ends up between the clip and its restore; page 1 is untouched.
const erased = await PDFDocument.load(await erasePdfArea(original, 1, square));
const items = contents(erased, 1);
assert.ok(items.length >= 3);
assert.match(text(erased, items[0]), /^q\n0 0 792 612 re\n50 500 m\n300 500 l\n300 580 l\n50 580 l\nh\nW\* n\n$/);
assert.equal(text(erased, items.at(-1)), "\nQ\n");
assert.ok(items.slice(1, -1).some((ref) => text(erased, ref).includes("Tj")));
assert.equal(contents(erased, 0).length, contents(await PDFDocument.load(original), 0).length);

// Erasing twice nests the clips; the file still opens.
const twice = await PDFDocument.load(await erasePdfArea(await erased.save(), 1, square));
assert.equal(contents(twice, 1).length, items.length + 2);

console.log("pdfErase tests passed");
