"use client";

import { useEffect, useRef } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { ACCEPTED_FILE_TYPES } from "@/app/utils/fileTypes";
import { PROJECT_ACCEPT } from "@/app/utils/projectFile";
import { openDocumentFile, pickAndOpenFile } from "@/app/utils/openFile";
import { pruneTabScroll } from "@/app/utils/tabScroll";

export function DocumentTabs() {
  const { tabs, activeTabId } = useAppState();
  const dispatch = useAppDispatch();
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    pruneTabScroll(tabs.map((tab) => tab.id));
  }, [tabs]);

  if (tabs.length === 0) return null;

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await openDocumentFile(file, dispatch);
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
          onClick={() => void pickAndOpenFile(dispatch, fileInputRef.current)}
        >
          +
        </button>
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
