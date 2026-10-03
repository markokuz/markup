"use client";

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ACCEPTED_FILE_TYPES, detectDocumentType } from "@/app/utils/fileTypes";
import {
  isProjectFile,
  PROJECT_ACCEPT,
  readProjectFile,
} from "@/app/utils/projectFile";

export function DocumentTabs() {
  const { tabs, activeTabId, confirmCloseUnsaved } = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (!settingsOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) {
        setSettingsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [settingsOpen]);

  if (tabs.length === 0) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (isProjectFile(file)) {
        const project = await readProjectFile(file);
        dispatch({
          type: "LOAD_PROJECT",
          bytes: project.bytes,
          fileName: project.fileName,
          fileType: project.fileType,
          mimeType: project.mimeType,
          scale: project.scale,
          measurements: project.measurements,
          rectangles: project.rectangles,
          notes: project.notes,
          displayUnit: project.displayUnit,
          zoom: project.zoom,
          rotation: project.rotation,
        });
        return;
      }

      const fileType = detectDocumentType(file);
      if (!fileType) return;

      const buffer = await file.arrayBuffer();
      dispatch({
        type: "LOAD_FILE",
        bytes: new Uint8Array(buffer),
        fileName: file.name,
        fileType,
        mimeType: file.type,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to open file.";
      window.alert(message);
    } finally {
      event.target.value = "";
    }
  };

  const renderTab = (tab: (typeof tabs)[0]) => {
    const isActive = tab.id === activeTabId;
    const label = tab.fileName ?? "Untitled";
    const requestClose = () => dispatch({ type: "REQUEST_CLOSE_TAB", tabId: tab.id });

    return (
      <div
        key={tab.id}
        className={`group flex max-w-[220px] shrink-0 items-center rounded-md text-sm transition ${
          isActive
            ? "border border-border bg-surface text-text-primary shadow-sm"
            : "border border-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary"
        }`}
        style={
          isActive
            ? { boxShadow: "inset 0 -2px 0 0 var(--accent)" }
            : undefined
        }
        onAuxClick={(event) => {
          if (event.button === 1) requestClose();
        }}
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-3 py-1.5 text-left"
          title={tab.dirty ? `${label} (unsaved changes)` : label}
          onClick={() => dispatch({ type: "SWITCH_TAB", tabId: tab.id })}
        >
          {label}
        </button>
        <button
          type="button"
          className={`group/close relative mr-1 rounded p-1 text-text-muted transition hover:bg-surface-muted hover:text-text-primary ${
            isActive || tab.dirty ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          aria-label={tab.dirty ? `Close ${label} (unsaved changes)` : `Close ${label}`}
          title="Close tab"
          onClick={(event) => {
            event.stopPropagation();
            requestClose();
          }}
        >
          {tab.dirty && (
            <span
              aria-hidden
              className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-text-secondary group-hover/close:hidden"
            />
          )}
          <svg
            viewBox="0 0 16 16"
            className={`h-3.5 w-3.5 ${tab.dirty ? "invisible group-hover/close:visible" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-1 border-b border-border bg-surface px-2">
      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto py-1.5">
        {tabs.map(renderTab)}
        <button
          type="button"
          className="btn-secondary shrink-0 px-2.5 py-1.5 text-sm"
          title="Open another file"
          onClick={() => fileInputRef.current?.click()}
        >
          +
        </button>
      </div>
      <div ref={settingsRef} className="relative shrink-0">
        <button
          type="button"
          className="rounded p-1.5 text-text-muted transition hover:bg-surface-muted hover:text-text-primary"
          aria-label="Tab settings"
          aria-expanded={settingsOpen}
          aria-haspopup="dialog"
          title="Tab settings"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <svg
            aria-hidden
            viewBox="0 0 16 16"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M2.5 4.5h11M2.5 11.5h11" />
            <circle cx="6" cy="4.5" r="1.75" fill="var(--surface)" />
            <circle cx="10" cy="11.5" r="1.75" fill="var(--surface)" />
          </svg>
        </button>
        {settingsOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-border bg-surface p-3 shadow-lg">
            <label className="flex items-start gap-2 text-sm text-text-primary">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={confirmCloseUnsaved}
                onChange={(event) =>
                  dispatch({
                    type: "SET_CONFIRM_CLOSE_UNSAVED",
                    enabled: event.target.checked,
                  })
                }
              />
              <span>
                Ask before closing tabs with unsaved changes
                <span className="mt-0.5 block text-xs text-text-muted">
                  Also warns before leaving or reloading the page.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={`${ACCEPTED_FILE_TYPES},${PROJECT_ACCEPT}`}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
