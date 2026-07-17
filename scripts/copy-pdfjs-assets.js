const fs = require("fs");
const path = require("path");

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      copyFile(src, dest);
    }
  }
}

const root = path.join(__dirname, "..");
const pdfjsRoot = path.join(root, "node_modules", "pdfjs-dist");

copyFile(
  path.join(pdfjsRoot, "build", "pdf.worker.min.mjs"),
  path.join(root, "public", "pdf.worker.min.mjs"),
);

copyDir(path.join(pdfjsRoot, "wasm"), path.join(root, "public", "pdfjs", "wasm"));

console.log("Copied pdf.js worker and wasm assets to public/");
