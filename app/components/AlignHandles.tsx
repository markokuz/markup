"use client";

import { useState } from "react";
import {
  ALIGN_DOT_LABELS,
  alignAnchor,
  alignDotLayout,
  alignMoves,
  unionBox,
  type AlignDot,
  type AlignItem,
} from "@/app/utils/align";
import { SELECTION_ACCENT } from "@/app/utils/colors";

const DOTS = Object.keys(ALIGN_DOT_LABELS) as AlignDot[];

/** The box, dots and landing preview shown while lining up the selection. */
export function AlignHandles({
  items,
  anchorId,
  pageWidth,
  pageHeight,
  onAlign,
}: {
  items: AlignItem[];
  anchorId: string | null;
  pageWidth: number;
  pageHeight: number;
  onAlign: (dot: AlignDot) => void;
}) {
  const [hovered, setHovered] = useState<AlignDot | null>(null);
  if (items.length < 2) return null;

  const box = unionBox(items.map((item) => item.box));
  const anchor = alignAnchor(items, anchorId);
  const layout = alignDotLayout(box, pageWidth, pageHeight);
  const preview = hovered ? alignMoves(items, anchorId, hovered) : [];

  return (
    <g>
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill="none"
        stroke={SELECTION_ACCENT}
        strokeWidth={1}
        strokeDasharray="4 3"
        pointerEvents="none"
      />
      {anchor && (
        <rect
          x={anchor.box.x - 3}
          y={anchor.box.y - 3}
          width={anchor.box.width + 6}
          height={anchor.box.height + 6}
          rx={2}
          fill="rgba(34, 211, 238, 0.12)"
          stroke={SELECTION_ACCENT}
          strokeWidth={2}
          pointerEvents="none"
        />
      )}
      {preview.map(({ item, shift }) => (
        <rect
          key={item.id}
          x={item.box.x + shift.x}
          y={item.box.y + shift.y}
          width={item.box.width}
          height={item.box.height}
          fill="rgba(34, 211, 238, 0.12)"
          stroke={SELECTION_ACCENT}
          strokeWidth={1.5}
          strokeDasharray="5 3"
          pointerEvents="none"
        />
      ))}
      {DOTS.map((dot) => {
        const { x, y } = layout[dot];
        return (
          <g
            key={dot}
            data-align-dot={dot}
            role="button"
            tabIndex={0}
            aria-label={ALIGN_DOT_LABELS[dot]}
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onPointerEnter={() => setHovered(dot)}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => setHovered(dot)}
            onBlur={() => setHovered(null)}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // Not the page's: a press here mustn't start a marquee or take focus.
              event.stopPropagation();
              event.preventDefault();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            onClick={() => {
              setHovered(null);
              onAlign(dot);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              onAlign(dot);
            }}
          >
            <title>{ALIGN_DOT_LABELS[dot]}</title>
            <circle cx={x} cy={y} r={11} fill="transparent" />
            <circle
              cx={x}
              cy={y}
              r={6}
              fill={hovered === dot ? SELECTION_ACCENT : "#ffffff"}
              stroke={SELECTION_ACCENT}
              strokeWidth={2}
            />
          </g>
        );
      })}
    </g>
  );
}
