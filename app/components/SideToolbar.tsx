"use client";

import type { ToolMode } from "@/app/types";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";

const TOOLS: { id: ToolMode; label: string; hint: string }[] = [
  { id: "measure", label: "Line", hint: "Draw dimension lines" },
  { id: "rectangle", label: "Rect", hint: "Click two corners to draw a rectangle" },
  { id: "select", label: "Select", hint: "Move and edit measurements" },
  { id: "pan", label: "Pan", hint: "Drag to move, or hold middle mouse button" },
];

export function SideToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  if (!state.fileBytes) return null;

  return (
    <aside className="flex w-14 shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-950/90 p-2">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          title={tool.hint}
          onClick={() => dispatch({ type: "SET_TOOL", tool: tool.id })}
          className={`flex flex-col items-center gap-0.5 rounded-lg px-1 py-2 text-[10px] font-medium transition ${
            state.tool === tool.id
              ? "bg-cyan-600 text-white shadow-sm"
              : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          }`}
        >
          <ToolIcon tool={tool.id} />
          <span>{tool.label}</span>
        </button>
      ))}
    </aside>
  );
}

function ToolIcon({ tool }: { tool: ToolMode }) {
  switch (tool) {
    case "measure":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <line x1="3" y1="17" x2="17" y2="3" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="3" cy="17" r="2" fill="currentColor" />
          <circle cx="17" cy="3" r="2" fill="currentColor" />
        </svg>
      );
    case "rectangle":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect
            x="3"
            y="5"
            width="14"
            height="10"
            stroke="currentColor"
            strokeWidth="1.5"
            rx="1"
          />
        </svg>
      );
    case "select":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M4 3 L4 14 L8 10 L11 17 L13 16 L10 9 L15 9 Z"
            fill="currentColor"
          />
        </svg>
      );
    case "pan":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M10 3 C8 3 7 5 7 6 L5 8 C4 9 4 11 5 12 L8 15 C9 16 11 16 12 15 L14 13"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M13 5 L16 8 M16 5 L13 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      );
    default:
      return null;
  }
}
