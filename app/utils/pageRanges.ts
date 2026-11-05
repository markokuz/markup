// Kept free of runtime imports so its test can load it directly.

export type PageRangeResult = { pages: number[]; error?: undefined } | { pages?: undefined; error: string };

/**
 * Printer-style page list ("1-10", "1,2,3 5-8") as sorted, de-duplicated zero-based indexes.
 * Page numbers are positions in the file, counted from 1. Anything that can't be honoured is
 * an error rather than dropped, so a sheet can't go missing from a takeoff unnoticed.
 */
export function parsePageRanges(text: string, pageCount: number): PageRangeResult {
  const tooHigh = (n: number) =>
    `Page ${n} doesn't exist: this PDF has ${pageCount} page${pageCount === 1 ? "" : "s"}.`;
  // Spaces around a dash belong to the range; any other space or comma separates entries.
  const entries = text
    .replace(/\s*[-–—]\s*/g, "-")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (entries.length === 0) return { error: "Enter the pages to import, like 1-10 or 1,2,3 5-8." };

  const pages = new Set<number>();
  for (const entry of entries) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(entry);
    if (!match) return { error: `"${entry}" isn't a page or a range. Try 1-10 or 1,2,3 5-8.` };
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < 1) return { error: "Page numbers start at 1." };
    if (from > to) return { error: `"${entry}" runs backwards. Did you mean ${to}-${from}?` };
    if (to > pageCount) return { error: tooHigh(to) };
    for (let page = from; page <= to; page++) pages.add(page - 1);
  }
  return { pages: [...pages].sort((a, b) => a - b) };
}

/** Sorted zero-based indexes as the shortest printer-style list: [0,1,2,4] gives "1-3, 5". */
export function formatPageRanges(pages: number[]): string {
  const ranges: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i];
    while (pages[i + 1] === pages[i] + 1) i++;
    ranges.push(pages[i] === start ? String(start + 1) : `${start + 1}-${pages[i] + 1}`);
  }
  return ranges.join(", ");
}
