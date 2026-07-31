"use client";

import { useRef } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ACCEPTED_FILE_TYPES, detectDocumentType } from "@/app/utils/fileTypes";

export function DocumentTabs() {
  const { tabs, activeTabId } = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (tabs.length === 0) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
    event.target.value = "";
  };

  const renderTab = (tab: (typeof tabs)[0]) => {
    const isActive = tab.id === activeTabId;
    const label = tab.fileName ?? "Untitled";

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
      >
        <button
          type="button"
          className="min-w-0 flex-1 truncate px-3 py-1.5 text-left"
          title={label}
          onClick={() => dispatch({ type: "SWITCH_TAB", tabId: tab.id })}
        >
          {label}
        </button>
        <button
          type="button"
          className={`mr-1 rounded p-1 text-text-muted transition hover:bg-surface-muted hover:text-text-primary ${
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
          aria-label={`Close ${label}`}
          onClick={(event) => {
            event.stopPropagation();
            dispatch({ type: "CLOSE_TAB", tabId: tab.id });
          }}
        >
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
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
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_FILE_TYPES}
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}
