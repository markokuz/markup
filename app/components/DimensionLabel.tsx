"use client";

import { useEffect, useRef } from "react";
import type { Unit } from "@/app/types";
import { parseDimensionInput } from "@/app/utils/dimensions";
import { formatDistanceEditValue, splitFeetInches } from "@/app/utils/units";

/** Gap between the feet and inches parts — narrower than a full mono space. */
const FEET_INCHES_GAP = 3;

/** Label text with a tight gap between feet and inches (e.g. `10' 1"`). */
export function DimensionText({ label }: { label: string }) {
  const parts = splitFeetInches(label);
  if (!parts) return <>{label}</>;
  return (
    <>
      <tspan>{parts[0]}</tspan>
      <tspan dx={FEET_INCHES_GAP}>{parts[1]}</tspan>
    </>
  );
}

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
  clickable?: boolean;
  onSelect: (additive?: boolean) => void;
  onStartEdit: () => void;
  onCommit: (value: number) => void;
  onCancel: () => void;
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
  clickable = false,
}: DimensionLabelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pressedRef = useRef(false);
  const labelWidth = Math.max(label.length * 7 + 12, 24);
  const editValue = formatDistanceEditValue(valueInDisplayUnit, displayUnit);
  const unitSuffix =
    displayUnit === "ft" ? "'" : displayUnit === "in" ? '"' : displayUnit;
  const rectX = x - labelWidth / 2;
  const rectY = y - 10;

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleCommit = () => {
    const raw = inputRef.current?.value ?? "";
    // The box shows a rounded value; applying it unchanged would nudge the markup.
    if (raw === editValue) {
      onCancel();
      return;
    }
    const parsed = parseDimensionInput(raw, displayUnit);
    if (parsed !== null) {
      onCommit(parsed);
    } else {
      onCancel();
    }
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (clickable && !showHandles) {
      event.stopPropagation();
      onSelect(additive);
      return;
    }

    if (!showHandles) return;
    event.stopPropagation();
    pressedRef.current = true;

    if (!isSelected || additive) {
      onSelect(additive);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerUp = () => {
    if (showHandles && isSelected && pressedRef.current) onStartEdit();
    pressedRef.current = false;
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
            className="w-14 rounded border border-accent bg-surface px-1 py-0.5 font-mono text-xs text-accent outline-none"
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
          {/* Sits on the white page, so it must not inherit the dark theme's light text. */}
          <span className="font-mono text-xs text-[#1a1a1a]">{unitSuffix}</span>
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
        fill="transparent"
        style={{
          pointerEvents: showHandles || clickable ? "all" : "none",
          cursor: showHandles || clickable ? "pointer" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      />
      <text
        x={x}
        y={y}
        fill={color}
        stroke="#ffffff"
        strokeWidth={3}
        fontSize={12}
        fontWeight={600}
        fontFamily="var(--font-geist-mono), monospace"
        textAnchor="middle"
        dominantBaseline="middle"
        style={{ pointerEvents: "none", userSelect: "none", paintOrder: "stroke" }}
      >
        <DimensionText label={label} />
      </text>
    </>
  );
}
