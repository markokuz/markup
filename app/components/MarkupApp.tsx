"use client";

import { useEffect } from "react";
import { AppProvider, useAppDispatch, useAppState } from "@/app/context/AppContext";
import { CalibrateDialog } from "@/app/components/CalibrateDialog";
import { PdfViewer } from "@/app/components/PdfCanvas";
import { ScaleBanner } from "@/app/components/ScaleBanner";
import { SideToolbar } from "@/app/components/SideToolbar";
import { StatusBar, Toolbar } from "@/app/components/Toolbar";

function MarkupShell() {
  const state = useAppState();
  const dispatch = useAppDispatch();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const isEditing =
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT";

      if (event.key === "Escape") {
        dispatch({ type: "SET_PENDING_POINT", point: null });
        dispatch({ type: "SET_PENDING_RECT_DRAG", drag: null });
        dispatch({ type: "SET_PENDING_MARQUEE", marquee: null });
        dispatch({ type: "CLEAR_EDITING_DIMENSION" });
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
        (event.key === "Delete" || event.key === "Backspace") &&
        state.selectedIds.length > 0 &&
        !isEditing
      ) {
        dispatch({ type: "DELETE_SELECTED" });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dispatch, state.selectedIds.length]);

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <Toolbar />
      <div className="border-b border-slate-800 px-4 py-2">
        <ScaleBanner />
      </div>
      <div className="flex min-h-0 flex-1">
        <SideToolbar />
        <PdfViewer />
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
