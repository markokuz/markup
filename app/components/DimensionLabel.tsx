"use client";

import { useEffect, useRef } from "react";
import type { Unit } from "@/app/types";
import { parseDimensionInput } from "@/app/utils/dimensions";
import { formatDistanceEditValue } from "@/app/utils/units";

interface DimensionLabelProps {
  x: number;
  y: number;
  label: string;
  valueInDisplayUnit: number;
  color: string;
  displayUnit: Unit;
  isSelected: boolean;
  showHandles: boolean;
  isEditing: boolean;
  inline?: boolean;
  clickable?: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
  onDragStart: (event: React.PointerEvent) => void;
}

export function DimensionLabel({
  x,
  y,
  label,
  valueInDisplayUnit,
  color,
  displayUnit,
  isSelected,
  showHandles,
  isEditing,
  onSelect,
  onStartEdit,
  onCommit,
  onCancel,
  onDragStart,
  inline = false,
  clickable = false,
}: DimensionLabelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const labelWidth = Math.max(label.length * 7 + 12, 48);
  const editValue = formatDistanceEditValue(valueInDisplayUnit, displayUnit);
  const unitSuffix =
    displayUnit === "ft" ? "'" : displayUnit === "in" ? '"' : displayUnit;
  const rectX = inline ? x - labelWidth / 2 : x - 4;
  const rectY = inline ? y - 10 : y - 14;
  const textX = inline ? x : x + 2;
  const textY = inline ? y : y;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleCommit = () => {
    const raw = inputRef.current?.value ?? "";
    const parsed = parseDimensionInput(raw, displayUnit);
    if (parsed !== null) {
      onCommit(parsed);
    } else {
      onCancel();
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    if (clickable && !showHandles) {
      event.stopPropagation();
      onSelect();
      return;
    }

    if (!showHandles) return;
    event.stopPropagation();
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragStartedRef.current = false;

    if (!isSelected) {
      onSelect();
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!showHandles || !isSelected || !pointerStartRef.current || dragStartedRef.current) {
      return;
    }

    if (inline) return;

    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (Math.hypot(dx, dy) > 4) {
      dragStartedRef.current = true;
      onDragStart(event);
    }
  };

  const handlePointerUp = () => {
    if (!showHandles || !isSelected) {
      pointerStartRef.current = null;
      return;
    }

    if (!dragStartedRef.current && pointerStartRef.current) {
      onStartEdit();
    }

    pointerStartRef.current = null;
    dragStartedRef.current = false;
  };

  if (isEditing) {
    return (
      <foreignObject
        x={rectX}
        y={rectY}
        width={Math.max(labelWidth, 72)}
        height={24}
      >
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            defaultValue={editValue}
            className="w-14 rounded border border-cyan-500 bg-slate-900 px-1 py-0.5 font-mono text-xs text-cyan-100 outline-none"
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                handleCommit();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancel();
              }
            }}
            onBlur={handleCommit}
          />
          <span className="font-mono text-xs text-slate-400">{unitSuffix}</span>
        </div>
      </foreignObject>
    );
  }

  return (
    <>
      <rect
        x={rectX}
        y={rectY}
        width={labelWidth}
        height={20}
        rx={4}
        fill="rgba(15, 23, 42, 0.85)"
        stroke={color}
        strokeWidth={1}
        style={{
          pointerEvents: showHandles || clickable ? "all" : "none",
          cursor: showHandles || clickable ? "pointer" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <text
        x={textX}
        y={textY}
        fill={color}
        fontSize={12}
        fontWeight={600}
        fontFamily="var(--font-geist-mono), monospace"
        textAnchor={inline ? "middle" : "start"}
        dominantBaseline={inline ? "middle" : "auto"}
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </>
  );
}
