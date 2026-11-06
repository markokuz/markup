import type { SnapKind } from "@/app/utils/snapPoints";

/** Stands out against both the drawing's black and the markups' default colours. */
const SNAP_COLOR = "#c026d3";
const SIZE = 6;
const LABELS: Record<SnapKind, string> = {
  end: "End point",
  intersection: "Intersection",
  midpoint: "Midpoint",
  line: "On line",
};
const LABEL_WIDTH_PX = 80;

const shape = (kind: SnapKind, x: number, y: number) => {
  switch (kind) {
    case "end":
      return <rect x={x - SIZE} y={y - SIZE} width={SIZE * 2} height={SIZE * 2} />;
    case "intersection":
      return <path d={`M${x - SIZE} ${y - SIZE}L${x + SIZE} ${y + SIZE}M${x + SIZE} ${y - SIZE}L${x - SIZE} ${y + SIZE}`} />;
    case "midpoint":
      return <path d={`M${x} ${y - SIZE}L${x + SIZE} ${y + SIZE}L${x - SIZE} ${y + SIZE}Z`} />;
    case "line":
      return <path d={`M${x} ${y - SIZE}L${x + SIZE} ${y}L${x} ${y + SIZE}L${x - SIZE} ${y}Z`} />;
  }
};

/** Shows what the next click lands on: its shape says the kind of point, and so does the label. */
export function SnapMarker({ kind, x, y, pageWidth }: { kind: SnapKind; x: number; y: number; pageWidth: number }) {
  const flip = x + LABEL_WIDTH_PX > pageWidth;
  return (
    <g pointerEvents="none" fill="none" strokeLinecap="round">
      <g stroke="#ffffff" strokeWidth={4}>{shape(kind, x, y)}</g>
      <g stroke={SNAP_COLOR} strokeWidth={2}>{shape(kind, x, y)}</g>
      <text
        x={x + (flip ? -SIZE - 5 : SIZE + 5)}
        // Under the point near the page's top, where above it would be cut off.
        y={y < 24 ? y + SIZE + 12 : y - SIZE - 3}
        textAnchor={flip ? "end" : "start"}
        fontSize={11}
        fontWeight={600}
        fill={SNAP_COLOR}
        stroke="#ffffff"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {LABELS[kind]}
      </text>
    </g>
  );
}
