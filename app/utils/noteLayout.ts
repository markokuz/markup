import type { Point2D, ShapeAnnotation } from "@/app/types";
import { viewportZoom, type DocumentViewport } from "@/app/utils/documentViewport";

/** Note card metrics in screen px; exports divide by zoom so the card matches what was on screen. */
export const NOTE_CARD = {
  fontSize: 13,
  lineHeight: 18,
  padX: 10,
  padY: 6,
  accentWidth: 3,
  maxTextWidth: 260,
  minWidth: 48,
  textColor: "#0f172a",
} as const;

/** Splits on newlines and greedily word-wraps each paragraph to maxWidth. */
export function wrapNoteText(
  text: string,
  measure: (s: string) => number,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of (text || " ").split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Doc-space unit vectors for screen "right" and "down", so a card anchored at its
 * screen top-left exports in the same place and orientation at any view rotation.
 * PDF space is y-up, image space is y-down, which flips the perpendicular.
 */
export function getScreenAxes(
  screenUpDoc: Point2D,
  yUp: boolean,
): { right: Point2D; down: Point2D } {
  const up = screenUpDoc;
  const right = yUp ? { x: up.y, y: -up.x } : { x: -up.y, y: up.x };
  return { right, down: { x: -up.x, y: -up.y } };
}

/** Free text: default size in doc units and line spacing as a multiple of the size. */
export const TEXT_DEFAULT_SIZE = 14;
export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_FONT_FAMILY = "Helvetica, Arial, sans-serif";

export function textFont(sizePx: number, bold?: boolean, italic?: boolean): string {
  return `${italic ? "italic " : ""}${bold ? "bold " : ""}${sizePx}px ${TEXT_FONT_FAMILY}`;
}

export function textLines(text: string | undefined): string[] {
  return (text || " ").split(/\r?\n/);
}

let measureContext: CanvasRenderingContext2D | null = null;

/** Screen-space box of a free-text shape (top-left at its anchor, axis-aligned). */
export function textScreenBox(
  shape: Pick<ShapeAnnotation, "points" | "text" | "fontSize" | "bold" | "italic">,
  viewport: DocumentViewport,
): { x: number; y: number; width: number; height: number } {
  const anchor = viewport.convertToViewportPoint(shape.points[0].x, shape.points[0].y);
  const px = (shape.fontSize ?? TEXT_DEFAULT_SIZE) * viewportZoom(viewport);
  const lines = textLines(shape.text);
  measureContext ??= document.createElement("canvas").getContext("2d");
  let width = px * 2;
  if (measureContext) {
    measureContext.font = textFont(px, shape.bold, shape.italic);
    width = Math.max(px, ...lines.map((line) => measureContext!.measureText(line).width));
  }
  return { x: anchor.x, y: anchor.y, width, height: lines.length * px * TEXT_LINE_HEIGHT };
}

/** Space the card's padding, accent bar and 1px borders take from its width. */
export const NOTE_CARD_CHROME_X = NOTE_CARD.padX * 2 + NOTE_CARD.accentWidth + 1;

/** Text wrap width for a card `width` px wide (or the default maximum). */
export function noteTextWidth(width: number | undefined): number {
  return width ? Math.max(width - NOTE_CARD_CHROME_X, 8) : NOTE_CARD.maxTextWidth;
}

/** Screen size of a note card, matching the HTML card's layout. */
export function noteCardSize(text: string, cardWidth?: number): { width: number; height: number } {
  measureContext ??= document.createElement("canvas").getContext("2d");
  const ctx = measureContext;
  const measure = (line: string) => {
    if (!ctx) return line.length * 7;
    ctx.font = `${NOTE_CARD.fontSize}px ui-sans-serif, system-ui, sans-serif`;
    return ctx.measureText(line).width;
  };
  const lines = wrapNoteText(text || "Note", measure, noteTextWidth(cardWidth));
  // A card whose text wrapped fills its max width, like the HTML card does.
  const wrapped = lines.length > (text || "Note").split(/\r?\n/).length;
  const textWidth = wrapped ? NOTE_CARD.maxTextWidth : Math.max(...lines.map(measure));
  return {
    width: cardWidth ?? Math.max(textWidth + NOTE_CARD_CHROME_X, NOTE_CARD.minWidth),
    height: lines.length * NOTE_CARD.lineHeight + NOTE_CARD.padY * 2 + 2,
  };
}

/** Turns a doc-space "screen up" direction by `deg` clockwise on screen. */
export function rotateScreenUp(up: Point2D, deg: number, yUp: boolean): Point2D {
  if (!deg) return up;
  const { right } = getScreenAxes(up, yUp);
  const rad = (deg * Math.PI) / 180;
  return {
    x: up.x * Math.cos(rad) + right.x * Math.sin(rad),
    y: up.y * Math.cos(rad) + right.y * Math.sin(rad),
  };
}
