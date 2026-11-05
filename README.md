# Markup

Markup is a browser-based tool for calibrating scale on PDF drawings and images, then measuring real-world dimensions directly on the document. Upload a floor plan, site photo, or scan, set the scale from a known dimension, and draw dimension lines and rectangles with labeled measurements.

Everything runs in the browser — no account, no server upload.

## Features

- **Scale calibration** — click two points on a known dimension (e.g. a labeled 10 ft wall) to set real-world units
- **Multi-page PDFs** — import all pages or a printer-style list like `1-10` or `1,2,3 5-8`, with a separate scale per sheet
- **Dimension lines** — measure distances between any two points
- **Runs** — measure a wall, pipe or conduit run with many clicks and one running total
- **Areas with cutouts** — subtract openings from an area's net square footage
- **Rectangles** — draw boxes with width and height labels
- **Editable dimensions** — click a label to type a new value; the annotation resizes to match
- **Multiple units** — feet, inches, meters, and millimeters (with live conversion in the display unit)
- **Export** — save annotated PDFs or PNGs with measurements burned in
- **Drag-and-drop** — drop a file onto the canvas to open it

## Supported files

| Type | Formats |
|------|---------|
| PDF | `.pdf` |
| Images | `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.tif`, `.tiff`, `.heic`, `.heif` |

## Getting started

Install dependencies and run the dev server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Run the tests with `npm test` (needs Node 22.18 or newer).

## How to use

### 1. Open a document

Click **Upload File** in the toolbar, or drag and drop a file onto the canvas.

A PDF with more than one page asks which pages to import: **All pages**, or a list like `1-10` or `1,2,3 5-8`. Page numbers are positions in the file, like a printer dialog. Every page stays in the file, so saving never removes the ones you left out; change your choice any time with **Pages…** in the status bar. Sheets with markups always stay included.

Move between sheets with the arrows in the status bar, by typing a page number in the box between them, or with **Page Up** / **Page Down**.

### 2. Calibrate the scale

Before measuring, tell Markup how document pixels map to real-world distance.

1. Select **Calibrate** in the top toolbar (this is the default tool).
2. Click two points on a dimension you already know — for example, both ends of a wall labeled "12 ft".
3. In the dialog, enter that real-world length and unit, then click **Apply scale**.

A green banner confirms the scale is set. The calibration line stays on the drawing as a dashed amber reference.

Each sheet of a PDF has its own scale and starts uncalibrated, since a plan and a detail are rarely drawn at the same scale. On a sheet with no scale, **Use scale from sheet N** in the status bar copies the scale from the closest calibrated sheet. If most of a set shares one, **Use scale on N other sheets** copies the current sheet's scale to every sheet that has none.

### 3. Measure

Use the tools in the left sidebar:

| Tool | What it does |
|------|--------------|
| **Line** | Click two points to draw a dimension line with a length label |
| **Area** | Click corners to measure area and perimeter. Select an area and press **Cut out** to subtract an opening |
| **Run** | Click along a wall, pipe or conduit run for its total length. Double-click or press Enter to finish |
| **Rect** | Click and drag to draw a rectangle with width and height labels |
| **Select** | Click annotations to select, drag to move, or drag a marquee to select multiple |
| **Pan** | Drag the canvas to scroll; you can also hold the middle mouse button in any tool |

Measurements appear in the display unit shown in the status bar. Change it anytime with the **Display unit** dropdown (ft, in, m, mm).

The Markups panel lists and totals every sheet, or just the current one. Clicking a markup on another sheet takes you there, and the CSV export has a **Sheet** column.

### 4. Edit annotations

With the **Select** tool active:

- **Click** an annotation to select it.
- **Shift+click** to add or remove from the selection.
- **Drag** a selected line or rectangle to move it.
- **Drag endpoint handles** to resize a line.
- **Drag corner handles** to resize a rectangle.
- **Click a dimension label** to type a new value — the shape updates to match.
- **Drag a label** to reposition it.
- Use the color palette in the status bar to change annotation color.
- Press **Delete** or click **Delete** in the status bar to remove selected annotations.

### 5. Save your work

Click **Save PDF** or **Save PNG** (depending on the file type) to download a copy of the document with all annotations rendered on top. At least one measurement or rectangle is required.

## Shortcuts and tips

| Action | Shortcut |
|--------|----------|
| Undo | `Ctrl+Z` / `Cmd+Z` (goes to the sheet the change was on) |
| Previous / next sheet | `Page Up` / `Page Down` |
| Run tool | `P` |
| Delete selected | `Delete` or `Backspace` |
| Deselect / cancel | `Escape` |
| Zoom | Scroll wheel, or use **+** / **−** in the toolbar |
| Pan | Middle mouse button (any tool), or the **Pan** tool |

- You must calibrate before using **Line** or **Rect** — the status bar will remind you if scale is not set.
- TIFF files (including scanned drawings) are supported alongside standard image formats.
- Calibration and measurements are stored in the current session only; export before closing the tab if you need to keep your work.

## Tech stack

- [Next.js](https://nextjs.org) (App Router)
- [PDF.js](https://mozilla.github.io/pdf.js/) for PDF rendering
- [pdf-lib](https://pdf-lib.js.org/) for PDF export
- [React](https://react.dev) + [Tailwind CSS](https://tailwindcss.com)
