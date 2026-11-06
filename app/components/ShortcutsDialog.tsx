"use client";

import { useEffect, useState } from "react";
import { useAppState } from "@/app/context/AppContext";
import { HOTKEY_TOOLS } from "@/app/components/SettingsDialog";

const ACTIONS: { keys: string; label: string }[] = [
  { keys: "Ctrl+S", label: "Save" },
  { keys: "Ctrl+Z", label: "Undo" },
  { keys: "Ctrl+Y", label: "Redo" },
  { keys: "Ctrl+C", label: "Copy" },
  { keys: "Ctrl+X", label: "Cut" },
  { keys: "Ctrl+V", label: "Paste" },
  { keys: "Ctrl+D", label: "Duplicate" },
  { keys: "Ctrl+A", label: "Select everything on the sheet" },
  { keys: "Delete", label: "Delete the selection" },
  { keys: "Arrows", label: "Nudge the selection (Shift: further)" },
  { keys: "Enter", label: "Finish an area, run or count" },
  { keys: "Esc", label: "Cancel or deselect" },
  { keys: "Space + drag", label: "Pan, in any tool" },
  { keys: "Middle drag", label: "Pan, in any tool" },
  { keys: "Wheel", label: "Zoom" },
  { keys: "Ctrl+0", label: "Fit page" },
  { keys: "Ctrl+2", label: "Fit width" },
  { keys: "Page Up / Down", label: "Previous or next sheet" },
  { keys: "L", label: "Magnifier" },
  { keys: "?", label: "This list" },
];

function Keys({ children }: { children: string }) {
  return (
    <kbd className="whitespace-nowrap rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs text-text-primary">
      {children}
    </kbd>
  );
}

/** Header button and `?` key that open the list of shortcuts. */
export function ShortcutsButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      setOpen((was) => !was);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-sm font-medium text-text-secondary transition hover:bg-surface-muted hover:text-text-primary"
        aria-label="Keyboard shortcuts"
        aria-haspopup="dialog"
        title="Keyboard shortcuts (?)"
        onClick={() => setOpen(true)}
      >
        ?
      </button>
      {open && <ShortcutsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const { settings } = useAppState();
  const tools = HOTKEY_TOOLS.filter((tool) => settings.hotkeys[tool.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2 id="shortcuts-title" className="text-lg font-semibold text-text-primary">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            autoFocus
            aria-label="Close shortcuts"
            onClick={onClose}
            className="rounded p-1 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>
        <div className="grid min-h-0 gap-x-8 gap-y-4 overflow-y-auto px-6 pb-6 sm:grid-cols-[1fr_1.6fr]">
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Tools</h3>
            <p className="mb-2 text-xs text-text-muted">Change these in Settings.</p>
            <ul className="space-y-1.5 text-sm text-text-primary">
              {tools.map((tool) => (
                <li key={tool.id} className="flex items-center justify-between gap-3">
                  {tool.label}
                  <Keys>{settings.hotkeys[tool.id].toUpperCase()}</Keys>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">Everything else</h3>
            <ul className="space-y-1.5 text-sm text-text-primary">
              {ACTIONS.map((action) => (
                <li key={action.keys} className="flex items-center justify-between gap-3">
                  {action.label}
                  <Keys>{action.keys}</Keys>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
