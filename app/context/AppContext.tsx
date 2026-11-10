"use client";

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  initialTabsState,
  type AppAction,
  type AppState,
  type DocumentTab,
  type Point2D,
  type ShapeAnnotation,
  type TabsState,
  type UndoSnapshot,
} from "@/app/types";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type AppSettings,
} from "@/app/utils/settings";
import { setFeetPrecision } from "@/app/utils/units";
import { appendHistory, createUndoSnapshot } from "@/app/utils/history";
import { eraseFromStrokes, joinStrokes, splitStrokes } from "@/app/utils/geometry";
import { markupsOnPage, pageOf, pagesWithMarkups } from "@/app/utils/pages";
import { drawPieces, drawWidth } from "@/app/utils/shapeMetrics";
import { markupIds, nextGroupName, wouldNestInItself } from "@/app/utils/groups";
import {
  loadAutoOrientPortrait,
  loadConfirmCloseUnsaved,
  loadSnapLines,
  saveAutoOrientPortrait,
  saveConfirmCloseUnsaved,
  saveSnapLines,
} from "@/app/utils/preferences";
import {
  createDocumentTab,
  EMPTY_DOCUMENT_VIEW,
  getActiveTab,
  updateActiveTab,
  updateTabById,
} from "@/app/utils/tabState";

function removeIdsFromSelection(selectedIds: string[], removedIds: string[]): string[] {
  const removed = new Set(removedIds);
  return selectedIds.filter((id) => !removed.has(id));
}

/** Ends the in-progress area/run/count; an area under 3 vertices or a run under 2 is discarded. */
function finishDrawingShape(tab: DocumentTab): DocumentTab {
  if (!tab.drawingShapeId) return tab.cutoutTargetId ? { ...tab, cutoutTargetId: null } : tab;
  const shape = tab.shapes.find((s) => s.id === tab.drawingShapeId);
  const incomplete =
    (shape?.kind === "area" && shape.points.length < 3) ||
    (shape?.kind === "polyline" && shape.points.length < 2);
  const target = tab.shapes.find((s) => s.id === tab.cutoutTargetId && s.kind === "area");
  if (target && shape?.kind === "area") return finishCutout(tab, target, shape, incomplete);
  return {
    ...tab,
    drawingShapeId: null,
    cutoutTargetId: null,
    shapes: incomplete ? tab.shapes.filter((s) => s.id !== shape.id) : tab.shapes,
  };
}

/** Moves the area just drawn into `target` as a cutout, as one undo step however many clicks it took. */
function finishCutout(
  tab: DocumentTab,
  target: ShapeAnnotation,
  drawn: ShapeAnnotation,
  incomplete: boolean,
): DocumentTab {
  // Keep history up to the state just before the drawn shape existed.
  let keep = tab.history.length;
  while (keep > 0 && tab.history[keep - 1].shapes.some((s) => s.id === drawn.id)) keep--;
  return {
    ...tab,
    drawingShapeId: null,
    cutoutTargetId: null,
    history: tab.history.slice(0, keep),
    shapes: tab.shapes.flatMap((s) => {
      if (s.id === drawn.id) return [];
      if (s.id !== target.id || incomplete) return [s];
      return [{ ...s, ...joinStrokes([...splitStrokes(s.points, s.breaks), drawn.points]) }];
    }),
  };
}

/** `markup` on the page on screen. Page 1 stays unmarked, as in files from before pages existed. */
function onCurrentPage<T extends { page?: number }>(tab: DocumentTab, markup: T): T {
  return { ...markup, page: tab.page || undefined };
}

/** Moves to another page: whatever was in progress ends here. */
function showPage(tab: DocumentTab, page: number): DocumentTab {
  return {
    ...finishDrawingShape(tab),
    page,
    selectedIds: [],
    aligning: null,
    pendingPoint: null,
    pendingMarquee: null,
    editingDimension: null,
    editingNoteId: null,
    calibrateDialogOpen: false,
    pendingCalibrationLine: null,
    autoOrientPending: tab.fileType === "pdf" && tab.rotations[page] === undefined,
  };
}

/** Puts an undo or redo snapshot back, on the page that change was made on. */
function restoreSnapshot(tab: DocumentTab, snapshot: UndoSnapshot): DocumentTab {
  const samePage = snapshot.page === tab.page;
  return {
    ...tab,
    measurements: snapshot.measurements,
    rectangles: snapshot.rectangles,
    notes: snapshot.notes,
    shapes: snapshot.shapes,
    groups: snapshot.groups,
    scales: snapshot.scales,
    selectedIds: snapshot.selectedIds,
    page: snapshot.page,
    // Markups never end up on a hidden sheet, even if that sheet was dropped since.
    sheets:
      tab.sheets && !tab.sheets.includes(snapshot.page)
        ? [...tab.sheets, snapshot.page].sort((a, b) => a - b)
        : tab.sheets,
    drawingShapeId: samePage ? tab.drawingShapeId : null,
    cutoutTargetId: samePage ? tab.cutoutTargetId : null,
    pendingPoint: null,
    pendingMarquee: null,
    editingDimension: null,
    editingNoteId: null,
  };
}

function tabsReducer(state: TabsState, action: AppAction): TabsState {
  switch (action.type) {
    case "SET_TOOL":
      return {
        ...updateActiveTab(state, (tab) => ({
          ...finishDrawingShape(tab),
          pendingPoint: null,
          pendingMarquee: null,
          editingDimension: null,
          editingNoteId: null,
          selectedIds: action.tool === "select" ? tab.selectedIds : [],
          aligning: null,
        })),
        tool: action.tool,
        countStart: action.tool === "count" ? 1 : state.countStart,
        drawEraser: false,
      };
    case "SET_CLOUD_MODE":
      return { ...state, cloudMode: action.mode };
    case "SET_DRAW_ERASER":
      return { ...state, drawEraser: action.on };
    case "ERASE_DRAWINGS":
      return updateActiveTab(state, (tab) => {
        const erased = new Map<string, Point2D[][]>();
        for (const shape of tab.shapes) {
          if (shape.kind !== "draw" || shape.locked || pageOf(shape) !== tab.page) continue;
          const radius = (action.radiusPx + drawWidth(shape) / 2) / action.pxPerDoc;
          let pieces = drawPieces(shape);
          let touched = false;
          for (const centre of action.centres) {
            const next = eraseFromStrokes(pieces, centre, radius, 0.5 / action.pxPerDoc);
            if (!next) continue;
            pieces = next;
            touched = true;
          }
          if (touched) erased.set(shape.id, pieces);
        }
        if (erased.size === 0) return tab;
        // A stroke rubbed out completely goes away; a cut one stays a single markup.
        const gone = [...erased].filter(([, pieces]) => pieces.length === 0).map(([id]) => id);
        return {
          ...tab,
          history: action.recordUndo ? appendHistory(tab) : tab.history,
          shapes: tab.shapes.flatMap((shape) => {
            const pieces = erased.get(shape.id);
            if (!pieces) return [shape];
            if (pieces.length === 0) return [];
            return [{ ...shape, breaks: undefined, ...joinStrokes(pieces) }];
          }),
          selectedIds: removeIdsFromSelection(tab.selectedIds, gone),
        };
      });
    case "SET_LINE_MODE":
      return { ...state, lineMode: action.mode };
    case "SET_RECT_MODE":
      return { ...state, rectMode: action.mode };
    case "SET_AREA_MODE":
      return { ...updateActiveTab(state, finishDrawingShape), areaMode: action.mode };
    case "SET_SHAPE_MODE":
      return {
        ...updateActiveTab(state, (tab) => ({ ...finishDrawingShape(tab), pendingPoint: null })),
        shapeMode: action.mode,
      };
    case "UPDATE_SETTINGS":
      return { ...state, settings: { ...state.settings, ...action.patch } };
    case "SET_TOOL_COLOR":
      return {
        ...state,
        settings: {
          ...state.settings,
          toolColors: { ...state.settings.toolColors, [action.tool]: action.color },
        },
      };
    case "SET_HOTKEY": {
      // A key belongs to one tool: assigning it here takes it away from any other.
      const hotkeys = Object.fromEntries(
        Object.entries(state.settings.hotkeys).map(([tool, key]) => [
          tool,
          tool === action.tool ? action.key : key === action.key ? "" : key,
        ]),
      ) as AppSettings["hotkeys"];
      return { ...state, settings: { ...state.settings, hotkeys } };
    }
    case "RESET_SETTINGS":
      return {
        ...state,
        settings: { ...DEFAULT_SETTINGS, darkMode: state.settings.darkMode },
        displayUnit: DEFAULT_SETTINGS.defaultUnit,
      };
    case "SET_TAB_TOOL_COLOR":
      return updateActiveTab(state, (tab) => {
        const counting = tab.shapes.some((s) => s.id === tab.drawingShapeId && s.kind === "count");
        return {
          // A new count colour starts a new count group; dots already placed keep theirs.
          ...(action.tool === "count" && counting ? finishDrawingShape(tab) : tab),
          toolColors: { ...tab.toolColors, [action.tool]: action.color },
        };
      });
    case "SET_COUNT_START":
      return { ...state, countStart: Math.max(0, Math.floor(action.start)) };
    case "SET_ANNOTATION_LABEL":
      return updateActiveTab(state, (tab) => {
        const label = action.label.trim() || undefined;
        const rename = <T extends { id: string; label?: string }>(a: T): T =>
          a.id === action.id ? { ...a, label } : a;
        return {
          ...tab,
          history: appendHistory(tab),
          measurements: tab.measurements.map(rename),
          rectangles: tab.rectangles.map(rename),
          notes: tab.notes.map(rename),
          shapes: tab.shapes.map(rename),
        };
      });
    case "CREATE_GROUP":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        groups: [
          ...tab.groups,
          {
            id: action.groupId,
            name: nextGroupName(tab.groups),
            memberIds: uniqueMarkupIds(action.memberIds, tab),
          },
        ],
      }));
    case "RENAME_GROUP":
      return updateActiveTab(state, (tab) => {
        const name = action.name.trim();
        if (!name) return tab;
        return {
          ...tab,
          history: appendHistory(tab),
          groups: tab.groups.map((g) => (g.id === action.groupId ? { ...g, name } : g)),
        };
      });
    case "DELETE_GROUP":
      return updateActiveTab(state, (tab) => {
        const deleted = tab.groups.find((g) => g.id === action.groupId);
        if (!deleted) return tab;
        return {
          ...tab,
          history: appendHistory(tab),
          // Its subgroups move up to where it was.
          groups: tab.groups
            .filter((g) => g.id !== action.groupId)
            .map((g) => (g.parentId === action.groupId ? { ...g, parentId: deleted.parentId } : g)),
        };
      });
    case "NEST_GROUP":
      return updateActiveTab(state, (tab) => {
        const group = tab.groups.find((g) => g.id === action.groupId);
        if (!group || (group.parentId ?? null) === action.parentId) return tab;
        if (action.parentId && wouldNestInItself(tab.groups, action.groupId, action.parentId)) return tab;
        return {
          ...tab,
          history: appendHistory(tab),
          groups: tab.groups.map((g) =>
            g.id === action.groupId ? { ...g, parentId: action.parentId ?? undefined } : g,
          ),
        };
      });
    case "ADD_TO_GROUP":
    case "REMOVE_FROM_GROUP":
    case "MOVE_TO_GROUP":
      return updateActiveTab(state, (tab) => {
        const ids = uniqueMarkupIds(action.ids, tab);
        if (ids.length === 0) return tab;
        const into = action.type === "ADD_TO_GROUP" ? action.groupId : action.type === "MOVE_TO_GROUP" ? action.toGroupId : null;
        const outOf =
          action.type === "REMOVE_FROM_GROUP" ? action.groupId : action.type === "MOVE_TO_GROUP" ? action.fromGroupId : null;
        if (into && into === outOf) return tab;
        const moving = new Set(ids);
        return {
          ...tab,
          history: appendHistory(tab),
          groups: tab.groups.map((g) => {
            if (g.id === into) {
              return { ...g, memberIds: [...g.memberIds, ...ids.filter((id) => !g.memberIds.includes(id))] };
            }
            if (g.id === outOf) return { ...g, memberIds: g.memberIds.filter((id) => !moving.has(id)) };
            return g;
          }),
        };
      });
    case "SET_LOCKED":
      return updateActiveTab(state, (tab) => {
        const ids = new Set(action.ids);
        const locked = action.locked || undefined;
        const set = <T extends { id: string }>(a: T): T => (ids.has(a.id) ? { ...a, locked } : a);
        return {
          ...tab,
          history: appendHistory(tab),
          measurements: tab.measurements.map((m) => (m.isCalibration ? m : set(m))),
          rectangles: tab.rectangles.map(set),
          notes: tab.notes.map(set),
          shapes: tab.shapes.map(set),
        };
      });
    case "SET_DASHED":
      return updateActiveTab(state, (tab) => {
        const ids = new Set(action.ids);
        const dashed = action.dashed || undefined;
        const set = <T extends { id: string }>(a: T): T => (ids.has(a.id) ? { ...a, dashed } : a);
        return {
          ...tab,
          history: appendHistory(tab),
          measurements: tab.measurements.map((m) => (m.isCalibration ? m : set(m))),
          rectangles: tab.rectangles.map(set),
          shapes: tab.shapes.map(set),
        };
      });
    case "SET_DISPLAY_UNIT":
      return { ...state, displayUnit: action.unit };
    case "LOAD_FILE": {
      const tab = createDocumentTab({
        bytes: action.bytes,
        fileName: action.fileName,
        fileType: action.fileType,
        mimeType: action.mimeType,
      });
      return {
        ...state,
        tabs: [
          ...state.tabs,
          // Always orient new files: a PDF's own /Rotate is applied even with the setting off.
          { ...tab, autoOrientPending: true, projectHandle: action.handle ?? null },
        ],
        activeTabId: tab.id,
        tool: "calibrate",
      };
    }
    case "LOAD_PROJECT": {
      const base = createDocumentTab(
        {
          bytes: action.bytes,
          fileName: action.fileName,
          fileType: action.fileType,
          mimeType: action.mimeType,
      });
      const tab = {
        ...base,
        page: action.page,
        // A first guess, so a saved later page shows only its own markups; the PDF corrects it.
        pageCount: Math.max(action.page, ...(action.sheets ?? [])) + 1,
        sheets: action.sheets ?? base.sheets,
        scales: action.scales,
        measurements: action.measurements,
        rectangles: action.rectangles,
        notes: action.notes,
        shapes: action.shapes,
        groups: action.groups ?? [],
        zoom: action.zoom,
        rotations: action.rotations,
        autoOrientPending: action.fileType === "pdf" && action.rotations[action.page] === undefined,
        projectHandle: action.handle ?? null,
        legacyRotationFixPending: action.legacyRotatedImage ?? false,
        toolColors: action.toolColors ?? {},
      };
      return {
        ...state,
        tabs: [...state.tabs, tab],
        activeTabId: tab.id,
        displayUnit: action.displayUnit,
        tool: action.scales[action.page] ? "measure" : "calibrate",
      };
    }
    case "SET_PAGE":
      return updateActiveTab(state, (tab) =>
        tab.page === action.page || !tab.sheets?.includes(action.page) ? tab : showPage(tab, action.page),
      );
    case "SET_PAGE_INFO":
      return updateTabById(state, action.tabId, (tab) => {
        const { pageCount, pageLabels } = action;
        const known =
          tab.pageCount === pageCount && tab.pageLabels === pageLabels && (pageCount > 1 || tab.sheets !== null);
        if (known) return tab;
        const valid = pageCount === 1 ? [0] : (tab.sheets ?? []).filter((page) => page < pageCount);
        const next = { ...tab, pageCount, pageLabels, sheets: valid.length > 0 ? valid : null };
        return next.sheets && !next.sheets.includes(tab.page) ? showPage(next, next.sheets[0]) : next;
      });
    case "SET_SHEETS":
      return updateTabById(state, action.tabId, (tab) => {
        // A sheet with markups stays, or they would vanish from view and from the totals' page.
        const kept = pagesWithMarkups([tab.measurements, tab.rectangles, tab.notes, tab.shapes]);
        const sheets = [...new Set([...action.sheets, ...kept])]
          .filter((page) => page < tab.pageCount)
          .sort((a, b) => a - b);
        if (sheets.length === 0) return tab;
        const next = { ...tab, sheets, pagesDialogOpen: false };
        return sheets.includes(tab.page) ? next : showPage(next, sheets[0]);
      });
    case "SET_PAGES_DIALOG":
      return updateActiveTab(state, (tab) => ({ ...tab, pagesDialogOpen: action.open }));
    case "APPLY_SCALE_TO_UNCALIBRATED":
      return updateActiveTab(state, (tab) => {
        const scale = tab.scales[tab.page];
        const uncalibrated = (tab.sheets ?? []).filter((page) => !tab.scales[page]);
        if (!scale || uncalibrated.length === 0) return tab;
        return {
          ...tab,
          history: appendHistory(tab),
          scales: { ...tab.scales, ...Object.fromEntries(uncalibrated.map((page) => [page, scale])) },
        };
      });
    case "COPY_SCALE_FROM_SHEET": {
      const next = updateActiveTab(state, (tab) => {
        const scale = tab.scales[action.page];
        if (!scale) return tab;
        return { ...tab, history: appendHistory(tab), scales: { ...tab.scales, [tab.page]: scale } };
      });
      // The sheet is calibrated now, so measuring comes next, as after calibrating by hand.
      return state.tool === "calibrate" ? { ...next, tool: "measure" } : next;
    }
    case "MOVE_TAB": {
      const from = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (from === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      tabs.splice(Math.max(0, Math.min(action.toIndex, tabs.length)), 0, state.tabs[from]);
      return { ...state, tabs };
    }
    case "SWITCH_TAB":
      if (!state.tabs.some((tab) => tab.id === action.tabId)) return state;
      return { ...state, activeTabId: action.tabId };
    case "CLOSE_TAB": {
      const index = state.tabs.findIndex((tab) => tab.id === action.tabId);
      if (index === -1) return state;

      const tabs = state.tabs.filter((tab) => tab.id !== action.tabId);
      let activeTabId = state.activeTabId;

      if (state.activeTabId === action.tabId) {
        activeTabId =
          tabs.length === 0
            ? null
            : tabs[Math.min(index, tabs.length - 1)].id;
      }

      return {
        ...state,
        tabs,
        activeTabId,
        pendingCloseTabId:
          state.pendingCloseTabId === action.tabId ? null : state.pendingCloseTabId,
      };
    }
    case "REQUEST_CLOSE_TAB": {
      const tab = state.tabs.find((t) => t.id === action.tabId);
      if (!tab) return state;
      if (tab.dirty && state.confirmCloseUnsaved) {
        return { ...state, pendingCloseTabId: tab.id };
      }
      return tabsReducer(state, { type: "CLOSE_TAB", tabId: tab.id });
    }
    case "CANCEL_CLOSE_TAB":
      return { ...state, pendingCloseTabId: null };
    case "MARK_TAB_SAVED":
      return updateTabById(state, action.tabId, (tab) => ({
        ...tab,
        dirty: annotationsChanged(action.saved, tab),
      }));
    case "SET_CONFIRM_CLOSE_UNSAVED":
      return { ...state, confirmCloseUnsaved: action.enabled };
    case "SET_ZOOM":
      return updateActiveTab(state, (tab) => ({ ...tab, zoom: action.zoom }));
    case "SET_ROTATION":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        rotations: { ...tab.rotations, [tab.page]: action.rotation },
      }));
    case "SET_PENDING_POINT":
      return updateActiveTab(state, (tab) => ({ ...tab, pendingPoint: action.point }));
    case "SET_PENDING_MARQUEE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        pendingMarquee: action.marquee,
      }));
    case "ADD_MEASUREMENT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        measurements: [...tab.measurements, onCurrentPage(tab, action.measurement)],
        pendingPoint: null,
      }));
    case "UPDATE_MEASUREMENT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        measurements: tab.measurements.map((m) =>
          m.id === action.id ? { ...m, ...action.updates } : m,
        ),
      }));
    case "ADD_RECTANGLE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        rectangles: [...tab.rectangles, onCurrentPage(tab, action.rectangle)],
        pendingPoint: null,
      }));
    case "UPDATE_RECTANGLE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        rectangles: tab.rectangles.map((r) =>
          r.id === action.id ? { ...r, ...action.updates } : r,
        ),
      }));
    case "ADD_NOTE":
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          history: appendHistory(tab),
          notes: [...tab.notes, onCurrentPage(tab, action.note)],
          selectedIds: [action.note.id],
          editingNoteId: action.note.id,
        })),
      };
    case "UPDATE_NOTE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        notes: tab.notes.map((n) =>
          n.id === action.id ? { ...n, ...action.updates } : n,
        ),
      }));
    case "ADD_SHAPE": {
      const { shape } = action;
      const next = updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        shapes: [...tab.shapes, onCurrentPage(tab, shape)],
        pendingPoint: null,
        drawingShapeId: action.drawing ? shape.id : null,
        cutoutTargetId: action.cutoutTargetId ?? null,
        ...(shape.kind === "callout" || shape.kind === "text"
          ? { selectedIds: [shape.id], editingNoteId: shape.id }
          : {}),
      }));
      // Callouts and text open straight into text editing, like notes; the tool stays.
      return next;
    }
    case "APPEND_SHAPE_POINT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        shapes: tab.shapes.map((s) =>
          s.id === action.id ? { ...s, points: [...s.points, action.point] } : s,
        ),
      }));
    case "FINISH_SHAPE":
      return updateActiveTab(state, finishDrawingShape);
    case "UPDATE_SHAPE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        shapes: tab.shapes.map((s) =>
          s.id === action.id ? { ...s, ...action.updates } : s,
        ),
      }));
    case "DELETE_SHAPE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
        shapes: tab.shapes.filter((s) => s.id !== action.id),
        selectedIds: removeIdsFromSelection(tab.selectedIds, [action.id]),
        editingNoteId: tab.editingNoteId === action.id ? null : tab.editingNoteId,
        drawingShapeId: tab.drawingShapeId === action.id ? null : tab.drawingShapeId,
      }));
    case "SET_SELECTION":
      return updateActiveTab(state, (tab) => {
        // Nudge and delete act on the selection, so it must never hold markups out of sight
        // (a group in the panel can span sheets).
        const visible = (id: string) =>
          [tab.measurements, tab.rectangles, tab.notes, tab.shapes].some((list) =>
            list.some((markup) => markup.id === id && pageOf(markup) === tab.page),
          );
        return {
          ...tab,
          selectedIds: tab.pageCount > 1 ? action.ids.filter(visible) : action.ids,
          aligning: null,
          editingDimension: null,
          editingNoteId: null,
        };
      });
    case "SET_ALIGNING":
      return updateActiveTab(state, (tab) => ({ ...tab, aligning: action.aligning }));
    case "NUDGE_SELECTED":
      return updateActiveTab(state, (tab) => {
        if (tab.selectedIds.length === 0) return tab;
        // Locked markups stay put, even when dragged along with a selection or group.
        const lockedIds = new Set(
          [...tab.measurements, ...tab.rectangles, ...tab.notes, ...tab.shapes]
            .filter((a) => a.locked)
            .map((a) => a.id),
        );
        const selected = new Set(tab.selectedIds.filter((id) => !lockedIds.has(id)));
        const { dx, dy } = action;
        return {
          ...tab,
          history: action.recordUndo ? appendHistory(tab) : tab.history,
          measurements: tab.measurements.map((m) =>
            selected.has(m.id) && !m.isCalibration
              ? {
                  ...m,
                  start: { x: m.start.x + dx, y: m.start.y + dy },
                  end: { x: m.end.x + dx, y: m.end.y + dy },
                }
              : m,
          ),
          rectangles: tab.rectangles.map((r) =>
            selected.has(r.id)
              ? {
                  ...r,
                  topLeft: { x: r.topLeft.x + dx, y: r.topLeft.y + dy },
                  bottomRight: {
                    x: r.bottomRight.x + dx,
                    y: r.bottomRight.y + dy,
                  },
                }
              : r,
          ),
          notes: tab.notes.map((n) =>
            selected.has(n.id)
              ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
              : n,
          ),
          shapes: tab.shapes.map((s) =>
            selected.has(s.id)
              ? { ...s, points: s.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
              : s,
          ),
        };
      });
    case "DELETE_SELECTED":
      return updateActiveTab(state, (tab) => deleteAnnotations(tab, tab.selectedIds));
    case "DELETE_ANNOTATIONS":
      return updateActiveTab(state, (tab) => deleteAnnotations(tab, action.ids));
    case "SET_ANNOTATION_COLOR":
      return updateActiveTab(state, (tab) => {
        const targetIds = new Set(action.ids);
        // Remember the colour for each recoloured markup's tool, so the next one matches.
        const toolColors = { ...tab.toolColors };
        if (action.color) {
          for (const m of tab.measurements) {
            if (targetIds.has(m.id) && !m.isCalibration) toolColors.measure = action.color;
          }
          if (tab.rectangles.some((r) => targetIds.has(r.id))) toolColors.rectangle = action.color;
          if (tab.notes.some((n) => targetIds.has(n.id))) toolColors.note = action.color;
          for (const s of tab.shapes) {
            if (targetIds.has(s.id) && s.kind !== "image") toolColors[s.kind] = action.color;
          }
        }
        return {
          ...tab,
          toolColors,
          // A colour-wheel drag sends many updates; only its first one records undo.
          history: action.recordUndo === false ? tab.history : appendHistory(tab),
          measurements: tab.measurements.map((m) =>
            targetIds.has(m.id) && !m.isCalibration
              ? { ...m, color: action.color }
              : m,
          ),
          rectangles: tab.rectangles.map((r) =>
            targetIds.has(r.id) ? { ...r, color: action.color } : r,
          ),
          notes: tab.notes.map((n) =>
            targetIds.has(n.id) ? { ...n, color: action.color } : n,
          ),
          shapes: tab.shapes.map((s) =>
            targetIds.has(s.id) ? { ...s, color: action.color } : s,
          ),
        };
      });
    case "SET_EDITING_DIMENSION":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        editingDimension: action.editing,
        editingNoteId: null,
      }));
    case "CLEAR_EDITING_DIMENSION":
      return updateActiveTab(state, (tab) => ({ ...tab, editingDimension: null }));
    case "SET_EDITING_NOTE":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        editingNoteId: action.id,
        editingDimension: null,
      }));
    case "SET_SCALE":
      return {
        ...updateActiveTab(state, (tab) => {
          const pages = action.allSheets ? (tab.sheets ?? [tab.page]) : [tab.page];
          return {
            ...tab,
            history: appendHistory(tab),
            scales: { ...tab.scales, ...Object.fromEntries(pages.map((page) => [page, action.scale])) },
            // A sheet's calibration line stays until its scale is replaced: it would no longer be true.
            measurements: [
              ...tab.measurements.filter((m) => !m.isCalibration || !pages.includes(pageOf(m))),
              ...(action.calibrationMeasurement ? [onCurrentPage(tab, action.calibrationMeasurement)] : []),
            ],
            calibrateDialogOpen: false,
            pendingCalibrationLine: null,
            pendingPoint: null,
          };
        }),
        tool: "measure",
      };
    case "OPEN_CALIBRATE_DIALOG":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        calibrateDialogOpen: true,
        pendingCalibrationLine: action.line,
        pendingPoint: null,
      }));
    case "CLOSE_CALIBRATE_DIALOG":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        calibrateDialogOpen: false,
        pendingCalibrationLine: null,
      }));
    case "RECORD_UNDO":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        history: appendHistory(tab),
      }));
    case "UNDO":
      return updateActiveTab(state, (tab) => {
        if (tab.history.length === 0) return tab;
        const snapshot = tab.history[tab.history.length - 1];
        return {
          ...restoreSnapshot(tab, snapshot),
          history: tab.history.slice(0, -1),
          // Filed under the edit's page, not wherever the user is now, so redo returns there too.
          future: [...tab.future, { ...createUndoSnapshot(tab), page: snapshot.page }],
        };
      });
    case "REDO":
      return updateActiveTab(state, (tab) => {
        if (tab.future.length === 0) return tab;
        const snapshot = tab.future[tab.future.length - 1];
        return {
          ...restoreSnapshot(tab, snapshot),
          history: appendHistory({ ...tab, page: snapshot.page }),
          future: tab.future.slice(0, -1),
          drawingShapeId: null,
        };
      });
    case "SET_DOCUMENT_VIEWPORT":
      return updateActiveTab(state, (tab) => ({
        ...tab,
        documentViewport: action.viewport,
      }));
    case "TOGGLE_LOUPE":
      return { ...state, loupeEnabled: !state.loupeEnabled };
    case "SET_MINIMAP_HIDDEN":
      return { ...state, minimapHidden: action.hidden };
    case "SET_SNAP_LINES":
      return { ...state, snapLines: action.enabled };
    case "SET_AUTO_ORIENT_PORTRAIT":
      return { ...state, autoOrientPortrait: action.enabled };
    case "APPLY_AUTO_ORIENT":
      return updateTabById(state, action.tabId, (tab) => ({
        ...tab,
        rotations: { ...tab.rotations, [tab.page]: action.rotation },
        zoom: action.zoom ?? tab.zoom,
        autoOrientPending: false,
      }));
    case "SET_PROJECT_HANDLE":
      return updateTabById(state, action.tabId, (tab) => ({
        ...tab,
        projectHandle: action.handle,
        ...(action.fileName ? { fileName: action.fileName } : {}),
      }));
    case "FIX_LEGACY_ROTATION":
      return updateTabById(state, action.tabId, (tab) => {
        if (!tab.legacyRotationFixPending) return tab;
        // Pre-v2 rotated-image coords were offset by (height - width) along one
        // doc axis: x at 270°, y at 90°.
        const shift = action.height - action.width;
        const rotation = tab.rotations[tab.page];
        const offset = rotation === 270 ? { x: -shift, y: 0 } : rotation === 90 ? { x: 0, y: shift } : null;
        if (!offset) return { ...tab, legacyRotationFixPending: false };
        const move = (p: Point2D): Point2D => ({ x: p.x + offset.x, y: p.y + offset.y });
        return {
          ...tab,
          legacyRotationFixPending: false,
          measurements: tab.measurements.map((m) => ({
            ...m,
            start: move(m.start),
            end: move(m.end),
          })),
          rectangles: tab.rectangles.map((r) => ({
            ...r,
            topLeft: move(r.topLeft),
            bottomRight: move(r.bottomRight),
          })),
          notes: tab.notes.map((n) => ({ ...n, position: move(n.position) })),
          shapes: tab.shapes.map((s) => ({ ...s, points: s.points.map(move) })),
        };
      });
    case "PASTE_ANNOTATIONS": {
      const pastedIds = [
        ...action.measurements.map((m) => m.id),
        ...action.rectangles.map((r) => r.id),
        ...action.notes.map((n) => n.id),
        ...action.shapes.map((s) => s.id),
      ];
      if (pastedIds.length === 0) return state;
      return {
        ...updateActiveTab(state, (tab) => ({
          ...tab,
          history: appendHistory(tab),
          // Copied markups remember the sheet they came from; they land on this one.
          measurements: [...tab.measurements, ...action.measurements.map((m) => onCurrentPage(tab, m))],
          rectangles: [...tab.rectangles, ...action.rectangles.map((r) => onCurrentPage(tab, r))],
          notes: [...tab.notes, ...action.notes.map((n) => onCurrentPage(tab, n))],
          shapes: [...tab.shapes, ...action.shapes.map((s) => onCurrentPage(tab, s))],
          selectedIds: pastedIds,
          aligning: null,
          pendingPoint: null,
          pendingMarquee: null,
          editingDimension: null,
          editingNoteId: null,
        })),
        tool: "select",
      };
    }
    default:
      return state;
  }
}

type SavedFields = Pick<
  DocumentTab,
  "measurements" | "rectangles" | "notes" | "shapes" | "groups" | "scales" | "sheets"
>;

function annotationsChanged(a: SavedFields, b: SavedFields): boolean {
  return (
    a.measurements !== b.measurements ||
    a.rectangles !== b.rectangles ||
    a.notes !== b.notes ||
    a.shapes !== b.shapes ||
    a.groups !== b.groups ||
    a.scales !== b.scales ||
    a.sheets !== b.sheets
  );
}

/** Flags tabs whose annotations or scale changed as a result of an action. */
function trackDirtyTabs(prev: TabsState, next: TabsState): TabsState {
  if (prev.tabs === next.tabs) return next;

  const prevById = new Map(prev.tabs.map((tab) => [tab.id, tab]));
  let changed = false;
  const tabs = next.tabs.map((tab) => {
    const before = prevById.get(tab.id);
    if (!before || tab.dirty) return tab;
    if (annotationsChanged(before, tab)) {
      changed = true;
      return { ...tab, dirty: true };
    }
    return tab;
  });

  return changed ? { ...next, tabs } : next;
}

/** Any new undo step (an edit, not undo/redo itself) makes the redo stack stale. */
function clearStaleRedo(prev: TabsState, next: TabsState, action: AppAction): TabsState {
  if (action.type === "UNDO" || action.type === "REDO" || prev.tabs === next.tabs) return next;
  const prevById = new Map(prev.tabs.map((tab) => [tab.id, tab]));
  let changed = false;
  const tabs = next.tabs.map((tab) => {
    const before = prevById.get(tab.id);
    if (!before || tab.future.length === 0 || tab.history === before.history) return tab;
    changed = true;
    return { ...tab, future: [] };
  });
  return changed ? { ...next, tabs } : next;
}

/** `ids` that are groupable markups in `tab`, once each. */
function uniqueMarkupIds(ids: string[], tab: DocumentTab): string[] {
  const existing = markupIds(tab);
  return [...new Set(ids)].filter((id) => existing.has(id));
}

/** Remove the markups `ids` (never the calibration line) as one undo step. */
function deleteAnnotations(tab: DocumentTab, ids: string[]): DocumentTab {
  if (ids.length === 0) return tab;
  const doomed = new Set(ids);
  return {
    ...tab,
    history: appendHistory(tab),
    measurements: tab.measurements.filter((m) => !doomed.has(m.id) || m.isCalibration),
    rectangles: tab.rectangles.filter((r) => !doomed.has(r.id)),
    notes: tab.notes.filter((n) => !doomed.has(n.id)),
    shapes: tab.shapes.filter((s) => !doomed.has(s.id)),
    groups: tab.groups.map((g) =>
      g.memberIds.some((id) => doomed.has(id)) ? { ...g, memberIds: g.memberIds.filter((id) => !doomed.has(id)) } : g,
    ),
    drawingShapeId: tab.drawingShapeId && doomed.has(tab.drawingShapeId) ? null : tab.drawingShapeId,
    selectedIds: tab.selectedIds.filter((id) => !doomed.has(id)),
    editingDimension: tab.editingDimension && doomed.has(tab.editingDimension.id) ? null : tab.editingDimension,
    editingNoteId: tab.editingNoteId && doomed.has(tab.editingNoteId) ? null : tab.editingNoteId,
  };
}

function appReducer(state: TabsState, action: AppAction): TabsState {
  const next = clearStaleRedo(state, tabsReducer(state, action), action);
  // Migrating an old project's coordinates, reading the PDF's page list and answering the
  // import question aren't user edits.
  if (
    action.type === "FIX_LEGACY_ROTATION" ||
    action.type === "SET_PAGE_INFO" ||
    (action.type === "SET_SHEETS" && action.initial)
  ) {
    return next;
  }
  return trackDirtyTabs(state, next);
}

function initTabsState(state: TabsState): TabsState {
  const settings = loadSettings();
  return {
    ...state,
    confirmCloseUnsaved: loadConfirmCloseUnsaved(),
    snapLines: loadSnapLines(),
    autoOrientPortrait: loadAutoOrientPortrait(),
    settings,
    displayUnit: settings.defaultUnit,
  };
}

function mergeActiveTabView(state: TabsState): AppState {
  const activeTab = getActiveTab(state);
  const { id: _id, ...documentFields } = activeTab ?? { id: "", ...EMPTY_DOCUMENT_VIEW };
  const { page, pageCount, scales, rotations } = documentFields;
  return {
    ...documentFields,
    // Everything reading app state works on the page on screen; a page's data is the whole document
    // only to the reducer, the Markups panel and saving, which read the tab itself.
    measurements: markupsOnPage(documentFields.measurements, page, pageCount),
    rectangles: markupsOnPage(documentFields.rectangles, page, pageCount),
    notes: markupsOnPage(documentFields.notes, page, pageCount),
    shapes: markupsOnPage(documentFields.shapes, page, pageCount),
    scale: scales[page] ?? null,
    rotation: rotations[page] ?? 0,
    tool: state.tool,
    displayUnit: state.displayUnit,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    loupeEnabled: state.loupeEnabled,
    minimapHidden: state.minimapHidden,
    confirmCloseUnsaved: state.confirmCloseUnsaved,
    pendingCloseTabId: state.pendingCloseTabId,
    snapLines: state.snapLines,
    autoOrientPortrait: state.autoOrientPortrait,
    cloudMode: state.cloudMode,
    drawEraser: state.drawEraser,
    countStart: state.countStart,
    lineMode: state.lineMode,
    rectMode: state.rectMode,
    areaMode: state.areaMode,
    shapeMode: state.shapeMode,
    settings: state.settings,
  };
}

const AppStateContext = createContext<AppState | null>(null);
const AppDispatchContext = createContext<Dispatch<AppAction> | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [tabsState, dispatch] = useReducer(appReducer, initialTabsState, initTabsState);
  const appState = mergeActiveTabView(tabsState);
  // During render, so every label below already uses it on the render a change arrives in.
  setFeetPrecision(tabsState.settings.feetPrecision);

  useEffect(() => {
    saveConfirmCloseUnsaved(tabsState.confirmCloseUnsaved);
  }, [tabsState.confirmCloseUnsaved]);

  useEffect(() => {
    saveSnapLines(tabsState.snapLines);
  }, [tabsState.snapLines]);

  useEffect(() => {
    saveSettings(tabsState.settings);
  }, [tabsState.settings]);

  useEffect(() => {
    document.documentElement.dataset.theme = tabsState.settings.darkMode ? "dark" : "light";
  }, [tabsState.settings.darkMode]);

  // Work is only ever saved to files now: clear the browser backups earlier versions kept.
  useEffect(() => {
    try {
      indexedDB.deleteDatabase("markup-session");
    } catch {
      // No storage: nothing to clear.
    }
  }, []);

  useEffect(() => {
    saveAutoOrientPortrait(tabsState.autoOrientPortrait);
  }, [tabsState.autoOrientPortrait]);

  // Warn before the browser tab itself closes or reloads with unsaved work.
  const hasUnsavedTabs = tabsState.tabs.some((tab) => tab.dirty);
  useEffect(() => {
    if (!hasUnsavedTabs || !tabsState.confirmCloseUnsaved) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedTabs, tabsState.confirmCloseUnsaved]);

  return (
    <AppStateContext.Provider value={appState}>
      <AppDispatchContext.Provider value={dispatch}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppProvider");
  return ctx;
}

export function useAppDispatch() {
  const ctx = useContext(AppDispatchContext);
  if (!ctx) throw new Error("useAppDispatch must be used within AppProvider");
  return ctx;
}
