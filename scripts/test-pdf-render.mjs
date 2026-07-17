import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createCanvas } from "@napi-rs/canvas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const pdfPath = path.join(__dirname, "..", "eds1975_TIF.pdf");
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const text = fs.readFileSync(pdfPath, "latin1");

  for (const key of [
    "/CCITTFaxDecode",
    "/DCTDecode",
    "/FlateDecode",
    "/JBIG2Decode",
    "/JPXDecode",
    "/Image",
    "/XObject",
  ]) {
    const count = text.split(key).length - 1;
    if (count) console.log(key, count);
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "../node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;

  const wasmDir = path.join(
    __dirname,
    "..",
    "node_modules",
    "pdfjs-dist",
    "wasm",
  );
  const wasmUrl = new URL("./", `file:///${wasmDir.replace(/\\/g, "/")}/`).href;

  const pdf = await pdfjs.getDocument({ data: bytes, wasmUrl }).promise;
  console.log("pages", pdf.numPages);

  const page = await pdf.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  console.log("viewport", vp.width, vp.height);

  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));

  await page.render({
    canvas,
    viewport: vp,
  }).promise;

  const out = path.join(__dirname, "..", "test-render-output.png");
  fs.writeFileSync(out, canvas.toBuffer("image/png"));

  const context = canvas.getContext("2d");
  const sample = context.getImageData(
    Math.floor(vp.width / 2),
    Math.floor(vp.height / 2),
    1,
    1,
  ).data;
  console.log("center pixel rgba", [...sample]);
  console.log("wrote", out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
