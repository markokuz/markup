"use client";

import { useEffect, useRef } from "react";
import type { NoteAnnotation as NoteAnnotationType } from "@/app/types";
import { toScreenPoint } from "@/app/utils/coordinates";
import { getAnnotationColor } from "@/app/utils/colors";
import type { DocumentViewport } from "@/app/utils/documentViewport";

const FOREIGN_OBJECT_WIDTH = 320;
const FOREIGN_OBJECT_HEIGHT = 120;

interface NoteAnnotationProps {
  note: NoteAnnotationType;
  viewport: DocumentViewport;
  isSelected: boolean;
  isSelectMode: boolean;
  showHandles: boolean;
  isEditing: boolean;
  onSelect: (id: string, shiftKey: boolean) => void;
  onUpdateText: (id: string, text: string) => void;
  onStartEdit: (id: string) => void;
  onEndEdit: () => void;
  onBodyPointerDown: (id: string, event: React.PointerEvent) => void;
}

export function NoteAnnotation({
  note,
  viewport,
  isSelected,
  isSelectMode,
  showHandles,
  isEditing,
  onSelect,
  onUpdateText,
  onStartEdit,
  onEndEdit,
  onBodyPointerDown,
}: NoteAnnotationProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);
  const ignoreBlurRef = useRef(false);
  const screenPos = toScreenPoint(viewport, note.position.x, note.position.y);
  const color = getAnnotationColor(note, isSelected);
  const interactive = isEditing || isSelectMode;

  useEffect(() => {
    if (!isEditing) return;

    ignoreBlurRef.current = true;

    const focusTextarea = () => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.select();
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(focusTextarea);
    });

    const enableBlur = () => {
      ignoreBlurRef.current = false;
    };

    window.addEventListener("pointerup", enableBlur, { once: true });
    return () => window.removeEventListener("pointerup", enableBlur);
  }, [isEditing]);

  const handleDisplayPointerDown = (event: React.PointerEvent) => {
    if (!isSelectMode) return;
    event.stopPropagation();
    pointerStartRef.current = { x: event.clientX, y: event.clientY };
    dragStartedRef.current = false;

    if (!isSelected) {
      onSelect(note.id, event.shiftKey);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDisplayPointerMove = (event: React.PointerEvent) => {
    if (!showHandles || !isSelected || !pointerStartRef.current || dragStartedRef.current) {
      return;
    }

    const dx = event.clientX - pointerStartRef.current.x;
    const dy = event.clientY - pointerStartRef.current.y;
    if (Math.hypot(dx, dy) > 4) {
      dragStartedRef.current = true;
      onBodyPointerDown(note.id, event);
    }
  };

  const handleDisplayPointerUp = () => {
    if (!isSelectMode || !isSelected) {
      pointerStartRef.current = null;
      return;
    }

    if (!dragStartedRef.current && pointerStartRef.current) {
      onStartEdit(note.id);
    }

    pointerStartRef.current = null;
    dragStartedRef.current = false;
  };

  return (
    <foreignObject
      x={screenPos.x}
      y={screenPos.y}
      width={FOREIGN_OBJECT_WIDTH}
      height={FOREIGN_OBJECT_HEIGHT}
      style={{ overflow: "visible", pointerEvents: interactive ? "all" : "none" }}
    >
      <div className="inline-block max-w-[min(40vw,320px)]">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            autoFocus
            defaultValue={note.text}
            rows={1}
            className="block w-fit min-w-[4rem] resize-none rounded border px-2 py-1 font-sans text-sm outline-none"
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.55)",
              borderColor: color,
              color,
            }}
            onPointerDown={(event) => event.stopPropagation()}
            onInput={(event) => {
              const target = event.target as HTMLTextAreaElement;
              target.style.height = "auto";
              target.style.height = `${target.scrollHeight}px`;
              onUpdateText(note.id, target.value);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Escape") {
                event.preventDefault();
                onEndEdit();
              }
            }}
            onBlur={(event) => {
              if (ignoreBlurRef.current) return;
              onUpdateText(note.id, event.target.value);
              onEndEdit();
            }}
          />
        ) : (
          <div
            className="rounded border px-2 py-1 font-sans text-sm whitespace-pre-wrap break-words"
            style={{
              backgroundColor: "rgba(15, 23, 42, 0.55)",
              borderColor: color,
              color,
              width: "fit-content",
              minWidth: "3rem",
              cursor: isSelectMode ? "pointer" : "default",
            }}
            onPointerDown={handleDisplayPointerDown}
            onPointerMove={handleDisplayPointerMove}
            onPointerUp={handleDisplayPointerUp}
          >
            {note.text || "Note"}
          </div>
        )}
      </div>
    </foreignObject>
  );
}
