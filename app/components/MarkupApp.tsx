"use client";

import { useEffect, useRef } from "react";
import { AppProvider, useAppDispatch, useAppState } from "@/app/context/AppContext";
import { DocumentTabs } from "@/app/components/DocumentTabs";
import { CalibrateDialog } from "@/app/components/CalibrateDialog";
import { PdfViewer } from "@/app/components/PdfCanvas";
import { ScaleBanner } from "@/app/components/ScaleBanner";
import { SideToolbar } from "@/app/components/SideToolbar";
import { StatusBar, Toolbar } from "@/app/components/Toolbar";

function MarkupShell() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const nudgingRef = useRef(false);

  const documentViewport = state.documentViewport;
  const zoom = state.zoom;
  const hasSelection = state.selectedIds.length > 0;

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
  }, [dispatch, state.selectedIds, documentViewport, zoom, hasSelection]);

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
