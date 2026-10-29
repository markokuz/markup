"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { Point2D, Scale, ShapeAnnotation as ShapeAnnotationType, Unit } from "@/app/types";
import { arrowPolygonPoints, toScreenPoint } from "@/app/utils/coordinates";
import { getAnnotationColor, SELECTION_ACCENT } from "@/app/utils/colors";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { cloudOutline, cloudPath, polygonCentroid } from "@/app/utils/geometry";
import {
  CALLOUT_LEADER_OFFSET,
  CLOSE_AREA_PX,
  countStartAt,
  getShapeLabel,
} from "@/app/utils/shapeMetrics";

const CLOUD_ARC_PX = 14;
const COUNT_RADIUS = 9;
const LABEL_PAD_X = 6;

interface ShapeAnnotationProps {
  shape: ShapeAnnotationType;
  viewport: DocumentViewport;
  scale: Scale | null;
  displayUnit: Unit;
  isSelected: boolean;
  /** Area still being drawn: shows an open outline plus a rubber band to the cursor. */
  isDrawing: boolean;
  cursorDoc: Point2D | null;
}

/** Pill label in screen space, sized to the rendered text. */
function ShapeLabel({ at, text, color }: { at: Point2D; text: string; color: string }) {
  const textRef = useRef<SVGTextElement>(null);
  // Rough guess for the first paint only; replaced by the measured width.
  const [textWidth, setTextWidth] = useState(text.length * 6);

  useLayoutEffect(() => {
    const measured = textRef.current?.getComputedTextLength();
    if (measured) setTextWidth(measured);
  }, [text]);

  const width = textWidth + LABEL_PAD_X * 2;
  return (
    <g pointerEvents="none">
      <rect
        x={at.x - width / 2}
        y={at.y - 11}
        width={width}
        height={22}
        rx={11}
        fill="rgba(255,255,255,0.95)"
        stroke={color}
        strokeWidth={1}
      />
      <text
        ref={textRef}
        x={at.x}
        y={at.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={12}
        fontWeight={600}
        fill="#0f172a"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {text}
      </text>
    </g>
  );
}

/**
 * Renders area, count, cloud and callout leader. Selection and dragging go through
 * AnnotationLayer's hit-testing, so nothing here takes pointer events; the callout's
 * text card is rendered separately via NoteAnnotation.
 */
export function ShapeAnnotation({
  shape,
  viewport,
  scale,
  displayUnit,
  isSelected,
  isDrawing,
  cursorDoc,
}: ShapeAnnotationProps) {
  const color = getAnnotationColor(shape);
  const toScreen = (p: Point2D) => toScreenPoint(viewport, p.x, p.y);
  const pts = shape.points.map(toScreen);
  const strokeWidth = isSelected ? 2.5 : 2;
  const label = getShapeLabel(shape, scale, displayUnit);

  if (shape.kind === "area") {
    const ptsAttr = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const cursor = isDrawing && cursorDoc ? toScreen(cursorDoc) : null;
    const first = pts[0];
    // Hovering the first vertex previews the closed shape and says a click finishes it.
    const willClose =
      !!cursor &&
      !!first &&
      pts.length >= 3 &&
      Math.hypot(cursor.x - first.x, cursor.y - first.y) <= CLOSE_AREA_PX;
    const bandEnd = willClose ? first : cursor;
    return (
      <g pointerEvents="none">
        {isSelected && pts.length >= 3 && (
          <polygon points={ptsAttr} fill="none" stroke={SELECTION_ACCENT} strokeWidth={8} opacity={0.3} />
        )}
        {isDrawing ? (
          <>
            {willClose ? (
              <polygon points={ptsAttr} fill={`${color}33`} stroke={color} strokeWidth={2} />
            ) : (
              <polyline points={ptsAttr} fill={`${color}22`} stroke={color} strokeWidth={2} />
            )}
            {bandEnd && pts.length > 0 && !willClose && (
              <line
                x1={pts[pts.length - 1].x}
                y1={pts[pts.length - 1].y}
                x2={bandEnd.x}
                y2={bandEnd.y}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="6 4"
              />
            )}
            {willClose && <circle cx={first.x} cy={first.y} r={15} fill={color} opacity={0.2} />}
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={i === 0 ? (willClose ? 9 : 6) : 3.5}
                fill={i === 0 && !willClose ? "#fff" : color}
                stroke={i === 0 && willClose ? "#fff" : color}
                strokeWidth={2}
              />
            ))}
            {willClose && (
              <g transform={`translate(${first.x + 16}, ${first.y - 26})`}>
                <rect width={88} height={20} rx={10} fill="#0f172a" opacity={0.85} />
                <text
                  x={44}
                  y={10}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={11}
                  fontWeight={600}
                  fill="#fff"
                  fontFamily="ui-sans-serif, system-ui, sans-serif"
                >
                  Click to close
                </text>
              </g>
            )}
          </>
        ) : (
          <polygon points={ptsAttr} fill={`${color}2e`} stroke={color} strokeWidth={strokeWidth} />
        )}
        {label && !isDrawing && <ShapeLabel at={toScreen(polygonCentroid(shape.points))} text={label} color={color} />}
      </g>
    );
  }

  if (shape.kind === "count") {
    const start = countStartAt(shape);
    return (
      <g pointerEvents="none">
        {pts.map((p, i) => (
          <g key={i}>
            {isSelected && (
              <circle cx={p.x} cy={p.y} r={COUNT_RADIUS + 5} fill={SELECTION_ACCENT} opacity={0.3} />
            )}
            <circle cx={p.x} cy={p.y} r={COUNT_RADIUS} fill={color} stroke="#fff" strokeWidth={1.5} />
            <text
              x={p.x}
              y={p.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={start + i >= 100 ? 8 : 10}
              fontWeight={700}
              fill="#fff"
              fontFamily="ui-sans-serif, system-ui, sans-serif"
            >
              {start + i}
            </text>
          </g>
        ))}
      </g>
    );
  }

  if (shape.kind === "cloud" && shape.points.length >= 2) {
    const d = cloudPath(cloudOutline(shape.points).map(toScreen), CLOUD_ARC_PX);
    return (
      <g pointerEvents="none">
        {isSelected && <path d={d} fill="none" stroke={SELECTION_ACCENT} strokeWidth={8} opacity={0.3} />}
        <path d={d} fill={`${color}1f`} stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" />
      </g>
    );
  }

  if (shape.kind === "image" && shape.image && pts.length === 4) {
    // Image at its real on-screen size, with a transform that only rotates (TL, TR, BR, BL
    // corners). A 1×1 image scaled up by the transform renders blank in some Chrome setups.
    const [tl, tr, , bl] = pts;
    const w = Math.hypot(tr.x - tl.x, tr.y - tl.y) || 1;
    const h = Math.hypot(bl.x - tl.x, bl.y - tl.y) || 1;
    const matrix = `matrix(${(tr.x - tl.x) / w} ${(tr.y - tl.y) / w} ${(bl.x - tl.x) / h} ${(bl.y - tl.y) / h} ${tl.x} ${tl.y})`;
    const filterId = `snapshot-tint-${shape.id}`;
    return (
      <g pointerEvents="none">
        {shape.color && (
          <filter id={filterId} colorInterpolationFilters="sRGB">
            <feFlood floodColor={shape.color} />
            <feComposite in2="SourceAlpha" operator="in" />
          </filter>
        )}
        <image
          href={shape.image}
          x={0}
          y={0}
          width={w}
          height={h}
          preserveAspectRatio="none"
          transform={matrix}
          filter={shape.color ? `url(#${filterId})` : undefined}
        />
        {isSelected && (
          <polygon
            points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={SELECTION_ACCENT}
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
      </g>
    );
  }

  if (shape.kind === "callout" && pts.length === 2) {
    const tip = pts[0];
    const end = {
      x: pts[1].x + CALLOUT_LEADER_OFFSET.x,
      y: pts[1].y + CALLOUT_LEADER_OFFSET.y,
    };
    const len = Math.hypot(end.x - tip.x, end.y - tip.y) || 1;
    const dir = { x: (tip.x - end.x) / len, y: (tip.y - end.y) / len };
    return (
      <g pointerEvents="none">
        {isSelected && (
          <line x1={tip.x} y1={tip.y} x2={end.x} y2={end.y} stroke={SELECTION_ACCENT} strokeWidth={8} opacity={0.3} />
        )}
        <line x1={tip.x} y1={tip.y} x2={end.x} y2={end.y} stroke={color} strokeWidth={strokeWidth} />
        <polygon points={arrowPolygonPoints({ tip, dir }, 10, 5)} fill={color} />
      </g>
    );
  }

  return null;
}
