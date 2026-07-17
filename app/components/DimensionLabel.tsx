"use client";

import { useEffect, useRef } from "react";
import type { Unit } from "@/app/types";
import { parseDimensionInput } from "@/app/utils/dimensions";

interface DimensionLabelProps {
  x: number;
  y: number;
  label: string;
  color: string;
  displayUnit: Unit;
  isSelected: boolean;
  showHandles: boolean;
  isEditing: boolean;
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
}: DimensionLabelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const labelWidth = Math.max(label.length * 7 + 12, 48);
  const numericValue = label.replace(/\s+\S+$/, "");

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
        x={x - 4}
        y={y - 14}
        width={Math.max(labelWidth, 72)}
        height={24}
      >
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            defaultValue={numericValue}
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
          <span className="font-mono text-xs text-slate-400">{displayUnit}</span>
        </div>
      </foreignObject>
    );
  }

  return (
    <>
      <rect
        x={x - 4}
        y={y - 14}
        width={labelWidth}
        height={20}
        rx={4}
        fill="rgba(15, 23, 42, 0.85)"
        stroke={color}
        strokeWidth={1}
        style={{
          pointerEvents: showHandles ? "all" : "none",
          cursor: showHandles ? "pointer" : "default",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      <text
        x={x + 2}
        y={y}
        fill={color}
        fontSize={12}
        fontWeight={600}
        fontFamily="var(--font-geist-mono), monospace"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {label}
      </text>
    </>
  );
}
