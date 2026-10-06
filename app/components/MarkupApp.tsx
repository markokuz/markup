"use client";

import { useEffect, useRef } from "react";
import { AppProvider, useAppDispatch, useAppState } from "@/app/context/AppContext";
import { DocumentTabs } from "@/app/components/DocumentTabs";
import { CalibrateDialog } from "@/app/components/CalibrateDialog";
import { PdfViewer } from "@/app/components/PdfCanvas";
import { ScaleBanner } from "@/app/components/ScaleBanner";
import { SideToolbar } from "@/app/components/SideToolbar";
import { StatusBar, Toolbar } from "@/app/components/Toolbar";
import { UnsavedChangesDialog } from "@/app/components/UnsavedChangesDialog";
import { buildPaste, copySelection, hasClipboardContent } from "@/app/utils/clipboard";
import { saveTabProject } from "@/app/utils/projectSave";
import { getActiveTabFromAppState } from "@/app/utils/tabState";
import { viewerBridge } from "@/app/utils/viewerBridge";

function MarkupShell() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const nudgingRef = useRef(false);
  const savingRef = useRef(false);
  // Latest state for shortcut handlers without re-binding listeners on every change.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const documentViewport = state.documentViewport;
  const zoom = state.zoom;
  const hasSelection = state.selectedIds.length > 0;
  const closeDialogOpen = state.pendingCloseTabId !== null;

  useEffect(() => {
    const ARROW_KEYS: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };

    const screenDeltaToDoc = (dx: number, dy: number): { x: number; y: number } => {
      if (documentViewport) {
        const origin = documentViewport.convertToDocPoint(0, 0);
        const moved = documentViewport.convertToDocPoint(dx, dy);
        return { x: moved.x - origin.x, y: moved.y - origin.y };
      }
      const z = zoom || 1;
      return { x: dx / z, y: dy / z };
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";

      if (closeDialogOpen) {
        if (event.key === "Escape") dispatch({ type: "CANCEL_CLOSE_TAB" });
        return;
      }

      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl && key === "s" && !event.shiftKey) {
        // Always block the browser's "Save page" dialog.
        event.preventDefault();
        const current = stateRef.current;
        const tab = getActiveTabFromAppState(current);
        if (!tab || savingRef.current) return;
        // Commit an in-progress dimension/note edit (they save on blur) first.
        if (isEditing) target.blur();
        savingRef.current = true;
        // Let the blur's state update land before reading the tab.
        setTimeout(() => {
          const latest = getActiveTabFromAppState(stateRef.current) ?? tab;
          saveTabProject(latest, stateRef.current.displayUnit, "linked", dispatch)
            .catch((error: unknown) => {
              const message =
                error instanceof Error ? error.message : "Failed to save project.";
              window.alert(message);
            })
            .finally(() => {
              savingRef.current = false;
            });
        }, 0);
        return;
      }

      if (ctrl && key === "c" && !isEditing) {
        const current = stateRef.current;
        if (current.selectedIds.length === 0 || !current.documentViewport) return;
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        copySelection(current, current.documentViewport);
        return;
      }

      if (ctrl && key === "v" && !isEditing) {
        const current = stateRef.current;
        if (!hasClipboardContent() || !current.documentViewport || !current.fileType) return;
        const targetScreen = viewerBridge.cursor ?? viewerBridge.getVisibleCenter?.();
        if (!targetScreen) return;
        event.preventDefault();
        const pasted = buildPaste({
          viewport: current.documentViewport,
          zoom: current.zoom,
          scale: current.scale,
          fileType: current.fileType,
          targetScreen,
        });
        if (pasted) dispatch({ type: "PASTE_ANNOTATIONS", ...pasted });
        return;
      }

      if (event.key === "Escape") {
        dispatch({ type: "SET_PENDING_POINT", point: null });
        dispatch({ type: "SET_PENDING_MARQUEE", marquee: null });
        dispatch({ type: "CLEAR_EDITING_DIMENSION" });
        dispatch({ type: "SET_EDITING_NOTE", id: null });
        dispatch({ type: "SET_SELECTION", ids: [] });
        dispatch({ type: "CLOSE_CALIBRATE_DIALOG" });
      }

      if (
        (event.key === "z" || event.key === "Z") &&
        (event.ctrlKey || event.metaKey) &&
        !event.shiftKey &&
        !isEditing
      ) {
        event.preventDefault();
        dispatch({ type: "UNDO" });
      }

      if (
        (event.key === "l" || event.key === "L") &&
        !event.ctrlKey &&
        !event.metaKey &&
        !isEditing
      ) {
        event.preventDefault();
        dispatch({ type: "TOGGLE_LOUPE" });
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        state.selectedIds.length > 0 &&
        !isEditing
      ) {
        dispatch({ type: "DELETE_SELECTED" });
      }

      const arrow = ARROW_KEYS[event.key];
      if (arrow && state.selectedIds.length > 0 && !isEditing) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const delta = screenDeltaToDoc(arrow.x * step, arrow.y * step);
        dispatch({
          type: "NUDGE_SELECTED",
          dx: delta.x,
          dy: delta.y,
          recordUndo: !nudgingRef.current,
        });
        nudgingRef.current = true;
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key in ARROW_KEYS) {
        nudgingRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    dispatch,
    state.selectedIds,
    documentViewport,
    zoom,
    hasSelection,
    closeDialogOpen,
  ]);

  return (
    <div className="flex h-screen flex-col bg-background text-text-primary">
      <Toolbar />
      <DocumentTabs />
      <ScaleBanner />
      <div className="flex min-h-0 flex-1">
        <SideToolbar />
        <PdfViewer key={state.activeTabId ?? "empty"} />
      </div>
      <StatusBar />
      <CalibrateDialog />
      <UnsavedChangesDialog />
    </div>
  );
}

export default function MarkupApp() {
  return (
    <AppProvider>
      <MarkupShell />
    </AppProvider>
  );
}
