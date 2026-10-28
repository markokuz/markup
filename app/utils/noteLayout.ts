import type { Point2D } from "@/app/types";

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
