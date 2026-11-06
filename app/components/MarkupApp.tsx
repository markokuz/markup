"use client";

import { useEffect, useRef, useState } from "react";
import { DropIcon } from "@/app/components/DropIcon";
import { MarkupsPanel } from "@/app/components/MarkupsPanel";
import { SaveToast } from "@/app/components/SaveToast";
import { AppProvider, useAppDispatch, useAppState } from "@/app/context/AppContext";
import { DocumentTabs } from "@/app/components/DocumentTabs";
import { CalibrateDialog } from "@/app/components/CalibrateDialog";
import { ImportPagesDialog } from "@/app/components/ImportPagesDialog";
import { PdfViewer } from "@/app/components/PdfCanvas";
import { SideToolbar } from "@/app/components/SideToolbar";
import { StatusBar, Toolbar } from "@/app/components/Toolbar";
import { UnsavedChangesDialog } from "@/app/components/UnsavedChangesDialog";
import { buildPaste, copySelection, duplicateSelection, hasClipboardContent } from "@/app/utils/clipboard";
import { openDroppedFiles } from "@/app/utils/openFile";
import { saveTabWithFeedback } from "@/app/utils/projectSave";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { toolForHotkey } from "@/app/utils/settings";
import { getActiveTabFromAppState } from "@/app/utils/tabState";
import { isLeftoverFocus, isTextEntry } from "@/app/utils/keyboardFocus";
import { viewerBridge } from "@/app/utils/viewerBridge";
import { setZoomAnchor } from "@/app/utils/zoomAnchor";

function MarkupShell() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [draggingFile, setDraggingFile] = useState(false);
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
  const pagesDialogOpen =
    state.fileType === "pdf" && state.pageCount > 1 && (state.sheets === null || state.pagesDialogOpen);

  // Ctrl+S runs in the capture phase so it wins even inside fields (note text,
  // dimension edits, dialogs) that stop key events from reaching the app.
  useEffect(() => {
    const handleSaveKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "s") {
        return;
      }
      // Always block the browser's own "Save page" dialog.
      event.preventDefault();
      const tab = getActiveTabFromAppState(stateRef.current);
      if (!tab) {
        showSaveStatus("info", "Nothing to save yet — open a file first");
        return;
      }
      if (savingRef.current) return;
      // Commit an in-progress dimension/note edit (they save on blur) first.
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        target.blur();
      }
      savingRef.current = true;
      showSaveStatus("saving", "Saving…");
      // Let the blur's state update land before reading the tab.
      setTimeout(() => {
        const latest = getActiveTabFromAppState(stateRef.current) ?? tab;
        void saveTabWithFeedback(latest, stateRef.current.displayUnit, "save", dispatch).finally(
          () => {
            savingRef.current = false;
          },
        );
      }, 0);
    };
    window.addEventListener("keydown", handleSaveKey, { capture: true });
    return () => window.removeEventListener("keydown", handleSaveKey, { capture: true });
  }, [dispatch]);

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
      // A select or slider used with the mouse keeps focus, and shouldn't hold on to the shortcuts.
      const isEditing =
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) && !isLeftoverFocus(target);
      // Copy/paste only yields to real text fields; a focused colour picker or select keeps focus after use.
      const inTextField = isTextEntry(target);

      if (closeDialogOpen) {
        if (event.key === "Escape") dispatch({ type: "CANCEL_CLOSE_TAB" });
        return;
      }
      // That dialog handles its own keys; tool hotkeys mustn't act behind it.
      if (pagesDialogOpen) return;
      // Nor behind this one, whatever in it has focus. Esc still closes it, below.
      if (stateRef.current.calibrateDialogOpen && event.key !== "Escape") return;

      if ((event.key === "PageUp" || event.key === "PageDown") && !isEditing && !target.isContentEditable) {
        const { sheets, page } = stateRef.current;
        if (sheets && sheets.length > 1) {
          event.preventDefault();
          const next = sheets[sheets.indexOf(page) + (event.key === "PageUp" ? -1 : 1)];
          if (next !== undefined) dispatch({ type: "SET_PAGE", page: next });
        }
        return;
      }

      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (ctrl && (key === "0" || key === "2") && !inTextField) {
        event.preventDefault();
        const fitted = viewerBridge.getFitZoom?.(key === "0" ? "page" : "width");
        if (fitted) {
          setZoomAnchor("center");
          dispatch({ type: "SET_ZOOM", zoom: fitted });
        }
        return;
      }

      if (ctrl && key === "a" && !inTextField && stateRef.current.fileBytes) {
        event.preventDefault();
        const { measurements, rectangles, notes, shapes } = stateRef.current;
        // The current sheet's markups; the calibration line is reference, not a markup.
        const ids = [...measurements.filter((m) => !m.isCalibration), ...rectangles, ...notes, ...shapes].map((m) => m.id);
        // With nothing to select, stay in the tool in hand.
        if (ids.length === 0) return;
        dispatch({ type: "SET_TOOL", tool: "select" });
        dispatch({ type: "SET_SELECTION", ids });
        return;
      }

      if (ctrl && key === "d" && !inTextField) {
        // Always ours: the browser's bookmark dialog is never what's wanted here.
        event.preventDefault();
        const current = stateRef.current;
        if (current.selectedIds.length === 0 || !current.documentViewport) return;
        const copies = duplicateSelection(current, current.documentViewport);
        if (copies) dispatch({ type: "PASTE_ANNOTATIONS", ...copies });
        return;
      }

      if (ctrl && (key === "c" || key === "x") && !inTextField) {
        const current = stateRef.current;
        if (current.selectedIds.length === 0 || !current.documentViewport) return;
        // Markups are selected, so a stray page text highlight is accidental.
        window.getSelection()?.removeAllRanges();
        event.preventDefault();
        const copied = copySelection(current, current.documentViewport);
        if (copied === 0) return;
        if (key === "x") dispatch({ type: "DELETE_SELECTED" });
        showSaveStatus("success", `${key === "x" ? "Cut" : "Copied"} ${copied} item${copied === 1 ? "" : "s"}`);
        return;
      }

      if (ctrl && key === "v" && !inTextField) {
        const current = stateRef.current;
        if (!hasClipboardContent() || !current.documentViewport || !current.fileType) return;
        const targetScreen = viewerBridge.cursor ?? viewerBridge.getVisibleCenter?.();
        if (!targetScreen) return;
        event.preventDefault();
        const pasted = buildPaste({
          viewport: current.documentViewport,
          zoom: current.zoom,
          scale: current.scale,
          targetScreen,
        });
        if (pasted) {
          dispatch({ type: "PASTE_ANNOTATIONS", ...pasted });
          const count =
            pasted.measurements.length + pasted.rectangles.length + pasted.notes.length + pasted.shapes.length;
          showSaveStatus("success", `Pasted ${count} item${count === 1 ? "" : "s"}`);
        }
        return;
      }

      if (event.key === "Enter" && !isEditing && stateRef.current.drawingShapeId) {
        event.preventDefault();
        dispatch({ type: "FINISH_SHAPE" });
        return;
      }

      if (event.key === "Escape") {
        dispatch({ type: "FINISH_SHAPE" });
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
        ctrl &&
        !isEditing &&
        (key === "y" || (key === "z" && event.shiftKey))
      ) {
        event.preventDefault();
        dispatch({ type: "REDO" });
        return;
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
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditing &&
        !target.isContentEditable &&
        stateRef.current.fileBytes
      ) {
        const hotkeyTool = toolForHotkey(stateRef.current.settings.hotkeys, key);
        if (hotkeyTool) {
          event.preventDefault();
          dispatch({ type: "SET_TOOL", tool: hotkeyTool });
          return;
        }
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
    pagesDialogOpen,
  ]);

  return (
    <div
      // An app, not a page: clicks and drags never highlight its text (inputs still select).
      className="flex h-screen select-none flex-col bg-background text-text-primary"
      // Whole window is a drop target so a stray drop never navigates the browser to the file.
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDraggingFile(true);
      }}
      onDragLeave={(e) => {
        // dragleave also fires when moving between children; only clear when leaving the window.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDraggingFile(false);
        void openDroppedFiles(e.dataTransfer, dispatch, state.tabs);
      }}
    >
      {draggingFile && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-sm">
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-4 border-dashed border-accent text-accent">
            <DropIcon className="h-16 w-16" />
            <p className="text-xl font-semibold">Drop to open</p>
          </div>
        </div>
      )}
      <Toolbar />
      <DocumentTabs />
      <div className="flex min-h-0 flex-1">
        <SideToolbar />
        {/* A fresh viewer per sheet: nothing about one page's view carries over to the next. */}
        <PdfViewer key={state.activeTabId ? `${state.activeTabId}:${state.page}` : "empty"} />
        <MarkupsPanel />
      </div>
      <StatusBar />
      <CalibrateDialog />
      <ImportPagesDialog />
      <SaveToast />
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
