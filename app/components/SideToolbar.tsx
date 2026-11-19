"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { ToolMode } from "@/app/types";
import { FloatingMenu } from "@/app/components/FloatingMenu";
import { ScrollHint, useScrollHints } from "@/app/components/ScrollHint";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";

export const SIDE_TOOLS: { id: ToolMode; label: string; hint: string; group: string }[] = [
  { id: "select", group: "Navigate", label: "Select", hint: "Move and edit measurements" },
  { id: "pan", group: "Navigate", label: "Pan", hint: "Drag to move, or hold middle mouse button" },
  { id: "measure", group: "Measure", label: "Line", hint: "Draw dimension lines" },
  {
    id: "area",
    group: "Measure",
    label: "Area",
    hint: "Click corners to measure area and perimeter. Double-click, Enter, or click the first point to finish",
  },
  {
    id: "polyline",
    group: "Measure",
    label: "Run",
    hint: "Click along a wall, pipe or conduit run to measure its total length. Double-click or Enter to finish",
  },
  {
    id: "count",
    group: "Measure",
    label: "Count",
    hint: "Click each item to count it. Press Enter or Esc to start a new count",
  },
  { id: "rectangle", group: "Markup", label: "Rect", hint: "Click two corners to draw a rectangle. Hold Shift for a square" },
  { id: "shape", group: "Markup", label: "Shapes", hint: "Ellipse, arrow or polygon. Right-click one to make it dashed" },
  { id: "cloud", group: "Markup", label: "Cloud", hint: "Click two corners to draw a revision cloud" },
  { id: "draw", group: "Markup", label: "Draw", hint: "Drag to draw freehand" },
  { id: "highlight", group: "Markup", label: "Highlight", hint: "Drag to highlight. Hold Shift for a straight line" },
  { id: "callout", group: "Markup", label: "Callout", hint: "Click the point to call out, then where the text goes" },
  { id: "text", group: "Markup", label: "Text", hint: "Free text or a note card. Double-click text to edit it" },
  {
    id: "snapshot",
    group: "Edit",
    label: "Snap",
    hint: "Click two corners to copy that part of the drawing, background removed. Paste with Ctrl+V",
  },
  {
    id: "erase",
    group: "Edit",
    label: "Erase",
    hint: "Remove part of the PDF; it is copied too, so Ctrl+V pastes it. Markups are not erased",
  },
];

export function SideToolbar() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const hidden = new Set(state.settings.hiddenTools);
  const hiddenTools = SIDE_TOOLS.filter((tool) => hidden.has(tool.id));
  // A short window can cut off the tool list; a tool's options opening under it change what fits.
  const { scrollRef, overflow, updateOverflow, scrollBy } = useScrollHints(
    "y",
    `${Boolean(state.fileBytes)}:${state.tool}:${hiddenTools.length}`,
  );
  const moreOpen = moreMenu !== null;

  useEffect(() => {
    if (!moreOpen) return;
    moreMenuRef.current?.querySelector("button")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!moreMenuRef.current?.contains(target) && !moreButtonRef.current?.contains(target)) setMoreMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // These work the menu; anything else, like a tool's hotkey, moves on from it.
      if (["Tab", "Enter", " ", "Shift"].includes(event.key)) return;
      setMoreMenu(null);
      if (event.key === "Escape") moreButtonRef.current?.focus();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [moreOpen]);

  if (!state.fileBytes) return null;

  const isActive = (tool: ToolMode) =>
    state.tool === tool || (tool === "text" && state.tool === "note");

  const shownIcon = (tool: ToolMode) => (tool === "text" && state.tool === "note" ? "note" : tool);
  // Erase rewrites the PDF itself; images have nothing to erase that way.
  const unavailable = (tool: ToolMode) => tool === "erase" && state.fileType !== "pdf";
  const hintWithKey = (tool: { id: ToolMode; hint: string }) =>
    unavailable(tool.id)
      ? "Erase works on PDFs only"
      : state.settings.hotkeys[tool.id]
        ? `${tool.hint} (${state.settings.hotkeys[tool.id].toUpperCase()})`
        : tool.hint;
  const pickTool = (tool: ToolMode) => {
    // Re-clicking Text keeps Note if that is the one picked.
    if (!(tool === "text" && isActive("text"))) dispatch({ type: "SET_TOOL", tool });
  };
  const toolButtonClass = (active: boolean) =>
    `flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-0.5 py-2 text-[10px] font-medium transition ${
      active ? "bg-accent text-white shadow-sm" : "text-text-secondary hover:bg-surface-muted hover:text-text-primary"
    } disabled:pointer-events-none disabled:opacity-40`;

  const activeHidden = hiddenTools.find((tool) => isActive(tool.id));
  const visibleTools = SIDE_TOOLS.filter((tool) => !hidden.has(tool.id));

  return (
    <aside className="relative flex w-26 shrink-0 flex-col border-r border-border bg-surface">
      <div
        ref={scrollRef}
        onScroll={updateOverflow}
        className="grid min-h-0 flex-1 grid-cols-2 content-start gap-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleTools.map((tool, i) => (
          <Fragment key={tool.id}>
            {tool.group !== visibleTools[i - 1]?.group && (
              <div
                className={`col-span-2 px-1 pb-0.5 text-[9px] font-medium uppercase tracking-widest ${
                  i > 0 ? "mt-2 border-t border-border pt-2" : ""
                } ${visibleTools.some((t) => t.group === tool.group && isActive(t.id)) ? "text-accent" : "text-text-muted"}`}
              >
                {tool.group}
              </div>
            )}
            <button
              type="button"
              title={hintWithKey(tool)}
              disabled={unavailable(tool.id)}
              onClick={() => pickTool(tool.id)}
              className={toolButtonClass(isActive(tool.id))}
            >
              <ToolIcon tool={shownIcon(tool.id)} />
              <span>{tool.id === "text" && state.tool === "note" ? "Note" : tool.label}</span>
            </button>
          </Fragment>
        ))}
        {hiddenTools.length > 0 && (
          <>
            {/* Shows the hidden tool in hand, so the active tool is always visible. */}
            <button
              ref={moreButtonRef}
              type="button"
              title={activeHidden ? `${hintWithKey(activeHidden)}. Click for more tools` : "More tools"}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                setMoreMenu((open) => (open ? null : { x: box.right + 4, y: box.top }));
              }}
              className={`relative ${toolButtonClass(Boolean(activeHidden))}`}
            >
              {/* Flyout mark: this button opens a menu even when it is showing a tool. */}
              <span aria-hidden className="absolute bottom-1 right-1 h-0 w-0 border-b-[5px] border-l-[5px] border-b-current border-l-transparent" />
              {activeHidden ? <ToolIcon tool={shownIcon(activeHidden.id)} /> : <MoreIcon />}
              <span>{activeHidden ? (state.tool === "note" ? "Note" : activeHidden.label) : "More"}</span>
            </button>
          </>
        )}
      </div>
      {moreMenu && (
        <FloatingMenu x={moreMenu.x} y={moreMenu.y} menuRef={moreMenuRef}>
          {hiddenTools.map((tool) => (
            <button
              key={tool.id}
              type="button"
              role="menuitem"
              title={tool.hint}
              disabled={unavailable(tool.id)}
              onClick={() => {
                setMoreMenu(null);
                pickTool(tool.id);
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted disabled:opacity-40 ${
                isActive(tool.id) ? "text-accent" : "text-text-primary"
              }`}
            >
              <ToolIcon tool={shownIcon(tool.id)} />
              <span className="flex-1 pr-4">{tool.id === "text" ? "Text / Note" : tool.label}</span>
              {state.settings.hotkeys[tool.id] && (
                <span className="font-mono text-xs text-text-muted">{state.settings.hotkeys[tool.id].toUpperCase()}</span>
              )}
            </button>
          ))}
        </FloatingMenu>
      )}
      {overflow.start && <ScrollHint direction="up" title="More tools above" onClick={() => scrollBy(-1)} />}
      {overflow.end && <ScrollHint direction="down" title="More tools below" onClick={() => scrollBy(1)} />}
    </aside>
  );
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <circle cx="4.5" cy="10" r="1.75" />
      <circle cx="10" cy="10" r="1.75" />
      <circle cx="15.5" cy="10" r="1.75" />
    </svg>
  );
}

export function ToolIcon({ tool }: { tool: ToolMode }) {
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
    case "note":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect
            x="3"
            y="4"
            width="14"
            height="12"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <line x1="6" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" />
          <line x1="6" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "area":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 15 L5 4 L15 3 L17 13 Z"
            fill="currentColor"
            fillOpacity="0.2"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "polyline":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 16 L8 7 L13 13 L17 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="3" cy="16" r="1.75" fill="currentColor" />
          <circle cx="8" cy="7" r="1.75" fill="currentColor" />
          <circle cx="13" cy="13" r="1.75" fill="currentColor" />
          <circle cx="17" cy="4" r="1.75" fill="currentColor" />
        </svg>
      );
    case "count":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <circle cx="6" cy="7" r="3" fill="currentColor" />
          <circle cx="14" cy="7" r="3" fill="currentColor" />
          <circle cx="10" cy="14" r="3" fill="currentColor" />
        </svg>
      );
    case "cloud":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M4 6 A2 2 0 0 1 8 5 A2 2 0 0 1 12 5 A2 2 0 0 1 16 6 A2 2 0 0 1 16 10 A2 2 0 0 1 16 14 A2 2 0 0 1 12 15 A2 2 0 0 1 8 15 A2 2 0 0 1 4 14 A2 2 0 0 1 4 10 A2 2 0 0 1 4 6 Z"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      );
    case "draw":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 15c2-4 4-7 6-5s-1 5 1 5 3-6 7-9"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "shape":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <ellipse cx="7.5" cy="7.5" rx="5" ry="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 17.5 L18 17.5 L14.5 11 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      );
    case "highlight":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M3 14.5h14" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.35" />
          <path d="M8 13l-1.5 1.5h-2l1-3L12.5 4.5a1.4 1.4 0 012 0l1 1a1.4 1.4 0 010 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      );
    case "callout":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="8" y="3" width="10" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="7" x2="3.5" y2="16" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 18 L3 13.5 L6 15.5 Z" fill="currentColor" />
        </svg>
      );
    case "text":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path d="M4 5V3.5h12V5M10 3.5v13M7.5 16.5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "snapshot":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M3 7a1.5 1.5 0 011.5-1.5h2L8 3.5h4l1.5 2h2A1.5 1.5 0 0117 7v8a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 15z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      );
    case "erase":
      return (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
          <path
            d="M8 16.5l-4-4a1.5 1.5 0 010-2.1L11.4 3a1.5 1.5 0 012.1 0l3.5 3.5a1.5 1.5 0 010 2.1L9.1 16.5zM7.3 7.1l5.6 5.6M8 16.5h9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return null;
  }
}
