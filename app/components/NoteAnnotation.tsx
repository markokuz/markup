"use client";

import { useEffect, useRef } from "react";
import type { NoteAnnotation as NoteAnnotationType } from "@/app/types";
import { toScreenPoint } from "@/app/utils/coordinates";
import { getAnnotationColor, SELECTION_ACCENT } from "@/app/utils/colors";
import type { DocumentViewport } from "@/app/utils/documentViewport";
import { NOTE_CARD } from "@/app/utils/noteLayout";

const FOREIGN_OBJECT_WIDTH = 320;
const FOREIGN_OBJECT_HEIGHT = 120;

interface NoteAnnotationProps {
  note: NoteAnnotationType;
  /** Shown when the text is empty. */
  placeholder?: string;
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
  placeholder = "Note",
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
  const color = getAnnotationColor(note);
  const interactive = isEditing || isSelectMode;
  const selectionGlow = isSelected
    ? `0 0 0 3px ${SELECTION_ACCENT}66`
    : "0 1px 3px rgba(15, 23, 42, 0.18)";
  // Comment-card look; metrics shared with the PDF/PNG export via NOTE_CARD.
  const cardStyle: React.CSSProperties = {
    backgroundColor: "rgba(255, 255, 255, 0.96)",
    border: `1px solid ${color}99`,
    borderLeft: `${NOTE_CARD.accentWidth}px solid ${color}`,
    color: NOTE_CARD.textColor,
    fontSize: NOTE_CARD.fontSize,
    lineHeight: `${NOTE_CARD.lineHeight}px`,
    padding: `${NOTE_CARD.padY}px ${NOTE_CARD.padX}px`,
    maxWidth: NOTE_CARD.maxTextWidth + NOTE_CARD.padX * 2 + NOTE_CARD.accentWidth,
    minWidth: NOTE_CARD.minWidth,
  };

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

    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!isSelected || additive) {
      onSelect(note.id, additive);
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
      <div className="inline-block">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            autoFocus
            defaultValue={note.text}
            rows={1}
            className="block resize-none rounded-md font-sans outline-none"
            style={
              {
                ...cardStyle,
                boxShadow: `0 0 0 3px ${color}33`,
                // Auto-sized to its content, so a scroll bar is never needed.
                overflow: "hidden",
                // Grow with the text like the display card instead of a fixed textarea width.
                fieldSizing: "content",
              } as React.CSSProperties
            }
            onPointerDown={(event) => event.stopPropagation()}
            onInput={(event) => {
              const target = event.target as HTMLTextAreaElement;
              target.style.height = "auto";
              // border-box sizing: add the borders, or the last line is clipped.
              target.style.height = `${target.scrollHeight + target.offsetHeight - target.clientHeight}px`;
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
            className="rounded-md font-sans whitespace-pre-wrap break-words"
            style={{
              ...cardStyle,
              width: "fit-content",
              cursor: isSelectMode ? "pointer" : "default",
              boxShadow: selectionGlow,
            }}
            onPointerDown={handleDisplayPointerDown}
            onPointerMove={handleDisplayPointerMove}
            onPointerUp={handleDisplayPointerUp}
          >
            {note.text || placeholder}
          </div>
        )}
      </div>
    </foreignObject>
  );
}
