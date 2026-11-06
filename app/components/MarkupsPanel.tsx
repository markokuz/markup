"use client";

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { downloadBlob } from "@/app/utils/saveFilePicker";
import {
  childGroups,
  liveMembers,
  markupIds,
  nextGroupName,
  subtreeMembers,
  wouldNestInItself,
} from "@/app/utils/groups";
import {
  buildMarkupRows,
  markupCenter,
  rowsToCsv,
  summarizeRows,
  type MarkupRow,
  type MarkupTotal,
} from "@/app/utils/markupList";
import type { MarkupGroup } from "@/app/types";
import { FloatingMenu } from "@/app/components/FloatingMenu";
import { showSaveStatus } from "@/app/utils/saveStatus";
import { getActiveTabFromAppState } from "@/app/utils/tabState";
import { revealOnNextSheet, viewerBridge } from "@/app/utils/viewerBridge";

/** Group rename targets share the rename box with rows; their ids carry this prefix. */
const GROUP_KEY = "group:";

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M13.5 3.5l3 3L7 16H4v-3l9.5-9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 6h12M8 6V4h4v2M6 6l.8 10h6.4L14 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rename, lock, remove-from-group and delete buttons, shown on hover at the right of a row. */
function RowActions({
  label,
  renameTitle,
  deleteTitle,
  locked,
  onRename,
  onToggleLock,
  onRemove,
  onDelete,
}: {
  label: string;
  renameTitle: string;
  deleteTitle: string;
  locked: boolean;
  onRename: () => void;
  onToggleLock: () => void;
  /** Rows inside a group: take the markup out of that group only. */
  onRemove?: () => void;
  onDelete: () => void;
}) {
  const button =
    "rounded p-1 text-text-secondary transition hover:bg-surface hover:text-text-primary";
  return (
    <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" title={renameTitle} aria-label={`Rename ${label}`} onClick={onRename} className={button}>
        <PencilIcon />
      </button>
      <button
        type="button"
        title={locked ? "Unlock (allow moving and resizing)" : "Lock in place"}
        aria-label={`${locked ? "Unlock" : "Lock"} ${label}`}
        aria-pressed={locked}
        onClick={onToggleLock}
        className={`${button} ${locked ? "text-accent" : ""}`}
      >
        <LockIcon open={!locked} size={14} />
      </button>
      {onRemove && (
        <button
          type="button"
          title="Remove from this group (keeps the markup)"
          aria-label={`Remove ${label} from this group`}
          onClick={onRemove}
          className={button}
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      <button
        type="button"
        title={deleteTitle}
        aria-label={`Delete ${label}`}
        onClick={onDelete}
        className={`${button} hover:text-red-600 dark:hover:text-red-400`}
      >
        <TrashIcon />
      </button>
    </div>
  );
}

function ChartIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3 16.5h14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M4 13l4-4.5 3 2.5 5-6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Totals per type and colour, as in the panel footer and each group's popover. */
function TotalsList({ totals, className = "" }: { totals: MarkupTotal[]; className?: string }) {
  return (
    <ul className={`space-y-1 ${className}`}>
      {totals.map((t) => (
        <li key={`${t.type}-${t.color}`} className="flex items-center gap-2 text-sm">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
          <span className="text-text-secondary">{t.type}</span>
          <span className="ml-auto font-medium text-text-primary">{t.display}</span>
        </li>
      ))}
    </ul>
  );
}

/** Padlock; `open` swings the shackle up for the "unlocked" state. */
function LockIcon({ open = false, size = 11 }: { open?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="4" y="9" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      <path d={open ? "M7 9V6.5a3 3 0 015.6-1.5" : "M7 9V6.5a3 3 0 016 0V9"} stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

interface MembershipClip {
  ids: string[];
  /** Set by Ctrl+X: pasting moves the markups out of this group. */
  cutFrom: string | null;
}

/** Copied or cut group memberships (Ctrl+C / Ctrl+X in the panel); never duplicates markups. */
let membershipClipboard: MembershipClip | null = null;

function setMembershipClipboard(clip: MembershipClip | null) {
  membershipClipboard = clip;
}

function getMembershipClipboard(): MembershipClip | null {
  return membershipClipboard;
}

/** Drag payload: markup rows (and the list they came from), or a whole group. */
type PanelDrag =
  | {
      kind: "markups";
      ids: string[];
      /** A group id, or ALL_LIST for the "All markups" list. */
      from: string;
    }
  | { kind: "group"; groupId: string };

const ALL_LIST = "all";
/** List key for the ungrouped markups of one type, e.g. "all:Text". */
const TYPE_LIST_PREFIX = `${ALL_LIST}:`;
/** The ungrouped lists: drags from them copy into a group, like the old master list. */
const isUngroupedList = (list: string) => list === ALL_LIST || list.startsWith(TYPE_LIST_PREFIX);
/** Drop zone for taking a group out of its parent, back to the top level. */
const TOP_LEVEL = "top";
/** Drop zone on the "+ Group" button. */
const NEW_GROUP = "new";
/** Indent per nesting level, in px. */
const NEST_INDENT_PX = 16;

/** Panel width in px: default, limits, and where the last width is kept. */
const PANEL_DEFAULT_WIDTH = 360;
const PANEL_MIN_WIDTH = 340;
const PANEL_MAX_WIDTH = 900;
/** The drawing always keeps at least this much of the window. */
const PANEL_MIN_CANVAS_PX = 360;
const PANEL_WIDTH_KEY = "markup.markupsPanelWidth";

function clampPanelWidth(width: number): number {
  const roomy = typeof window === "undefined" ? PANEL_MAX_WIDTH : window.innerWidth - PANEL_MIN_CANVAS_PX;
  return Math.round(Math.max(PANEL_MIN_WIDTH, Math.min(width, PANEL_MAX_WIDTH, roomy)));
}

function loadPanelWidth(): number {
  try {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
    return stored ? clampPanelWidth(stored) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

function savePanelWidth(width: number) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  } catch {
    // Storage unavailable — keep the in-memory width.
  }
}

/** Right-hand list of every markup with quantities and totals, exportable to CSV. */
export function MarkupsPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(true);
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? PANEL_DEFAULT_WIDTH : loadPanelWidth(),
  );
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [totalsOpen, setTotalsOpen] = useState(true);
  const [thisSheetOnly, setThisSheetOnly] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Shift-click ranges run from here, within the list it was clicked in.
  const [anchor, setAnchor] = useState<{ list: string; id: string } | null>(null);
  // Ctrl+V pastes into the group last clicked (its header or one of its rows).
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  // Enter then blur both commit; the ref lets only the first one apply.
  const renamingRef = useRef<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // A group's totals popover: hovering its chart icon shows it, clicking keeps it open.
  const [groupTotals, setGroupTotals] = useState<{
    groupId: string;
    x: number;
    y: number;
    pinned: boolean;
  } | null>(null);
  const totalsRef = useRef<HTMLDivElement>(null);

  // Ctrl+C/V act on group memberships only while the panel has focus; clicking the
  // drawing (which takes no focus itself) hands copy/paste back to the canvas.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const aside = asideRef.current;
      const active = document.activeElement;
      if (aside && active instanceof HTMLElement && aside.contains(active) && !aside.contains(event.target as Node)) {
        active.blur();
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  // A pinned totals popover closes on Escape or a click anywhere else.
  const totalsPinned = groupTotals?.pinned ?? false;
  useEffect(() => {
    if (!totalsPinned) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (totalsRef.current?.contains(target) || target?.closest("[data-group-totals]")) return;
      setGroupTotals(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setGroupTotals(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [totalsPinned]);

  // A narrower window can leave the panel too wide; pull it back in.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampPanelWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!state.fileBytes) return null;

  const resizeTo = (next: number) => {
    const clamped = clampPanelWidth(next);
    setWidth(clamped);
    return clamped;
  };

  const startRename = (id: string, current: string) => {
    setDraftName(current);
    setRenamingId(id);
    renamingRef.current = id;
  };

  const cancelRename = () => {
    renamingRef.current = null;
    setRenamingId(null);
  };

  const commitRename = (id: string, current: string) => {
    if (renamingRef.current !== id) return;
    cancelRename();
    if (draftName.trim() === current) return;
    if (id.startsWith(GROUP_KEY)) {
      dispatch({ type: "RENAME_GROUP", groupId: id.slice(GROUP_KEY.length), name: draftName });
    } else {
      dispatch({ type: "SET_ANNOTATION_LABEL", id, label: draftName });
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        title="Show markups list"
        onClick={() => setOpen(true)}
        className="flex w-8 shrink-0 flex-col items-center gap-2 border-l border-border bg-surface py-3 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        <span aria-hidden>‹</span>
        <span style={{ writingMode: "vertical-rl" }}>Markups</span>
      </button>
    );
  }

  // The whole document, not the current sheet's slice of it: groups and totals span sheets.
  const tab = getActiveTabFromAppState(state);
  if (!tab) return null;
  const multiSheet = (tab.sheets?.length ?? 1) > 1;
  const allRows = buildMarkupRows({ ...tab, displayUnit: state.displayUnit });
  const rows = thisSheetOnly && multiSheet ? allRows.filter((row) => row.page === state.page) : allRows;
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const totals = summarizeRows(rows, state.displayUnit);
  const selected = new Set(state.selectedIds);
  const existing = markupIds(tab);
  const groups = state.groups.map((group) => ({
    group,
    rows: liveMembers(group, existing).flatMap((id) => rowsById.get(id) ?? []),
  }));
  // Markups in no group, sorted under one heading per type (in the order types first appear).
  const grouped = new Set(groups.flatMap((entry) => entry.rows.map((row) => row.id)));
  const ungroupedByType = new Map<string, MarkupRow[]>();
  for (const row of rows) {
    if (grouped.has(row.id)) continue;
    const list = ungroupedByType.get(row.type);
    if (list) list.push(row);
    else ungroupedByType.set(row.type, [row]);
  }
  const listIds = (list: string) =>
    list === ALL_LIST
      ? rows.map((row) => row.id)
      : list.startsWith(TYPE_LIST_PREFIX)
        ? (ungroupedByType.get(list.slice(TYPE_LIST_PREFIX.length)) ?? []).map((r) => r.id)
        : (groups.find((g) => g.group.id === list)?.rows ?? []).map((r) => r.id);
  const groupsById = new Map(groups.map((entry) => [entry.group.id, entry]));
  const groupName = (groupId: string) => state.groups.find((g) => g.id === groupId)?.name ?? "the group";

  const toggleGroup = (groupId: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  /** Explorer-style: click picks one, Ctrl+click toggles, Shift+click picks a range. */
  const selectRow = (id: string, list: string, event: React.MouseEvent) => {
    dispatch({ type: "SET_TOOL", tool: "select" });
    setActiveGroupId(isUngroupedList(list) ? null : list);
    const markup = [...tab.measurements, ...tab.rectangles, ...tab.notes, ...tab.shapes].find((m) => m.id === id);
    const center = markup ? markupCenter(markup) : null;
    // On another sheet: go there and pick it; a selection can't span sheets.
    const rowPage = rowsById.get(id)?.page;
    if (rowPage !== undefined && rowPage !== state.page) {
      revealOnNextSheet(center);
      dispatch({ type: "SET_PAGE", page: rowPage });
      dispatch({ type: "SET_SELECTION", ids: [id] });
      setAnchor({ list, id });
      return;
    }
    const additive = event.ctrlKey || event.metaKey;
    if (center && !additive && !event.shiftKey) viewerBridge.revealDocPoint?.(center);
    if (event.shiftKey && anchor && anchor.list === list) {
      const ids = listIds(list);
      const [a, b] = [ids.indexOf(anchor.id), ids.indexOf(id)].sort((x, y) => x - y);
      const range = a >= 0 ? ids.slice(a, b + 1) : [id];
      dispatch({
        type: "SET_SELECTION",
        ids: additive ? [...new Set([...state.selectedIds, ...range])] : range,
      });
      return;
    }
    setAnchor({ list, id });
    if (additive) {
      dispatch({
        type: "SET_SELECTION",
        ids: selected.has(id) ? state.selectedIds.filter((s) => s !== id) : [...state.selectedIds, id],
      });
    } else {
      dispatch({ type: "SET_SELECTION", ids: [id] });
    }
  };

  /** The only way to select a whole group: click the group itself. */
  const selectGroup = (groupId: string, memberIds: string[]) => {
    dispatch({ type: "SET_TOOL", tool: "select" });
    dispatch({ type: "SET_SELECTION", ids: memberIds });
    setActiveGroupId(groupId);
    setAnchor(null);
  };

  const createGroup = (memberIds: string[]) => {
    const groupId = crypto.randomUUID();
    const name = nextGroupName(state.groups);
    dispatch({ type: "CREATE_GROUP", groupId, memberIds });
    setActiveGroupId(groupId);
    startRename(`${GROUP_KEY}${groupId}`, name);
  };

  // ---- Drag and drop: markup rows between lists, and groups into other groups.
  const startDrag = (event: React.DragEvent, id: string, from: string) => {
    event.stopPropagation();
    const ids = selected.has(id) ? state.selectedIds.filter((s) => existing.has(s)) : [id];
    setDrag({ kind: "markups", ids, from: isUngroupedList(from) ? ALL_LIST : from });
    event.dataTransfer.effectAllowed = "copyMove";
    // Firefox only starts a drag with some data set.
    event.dataTransfer.setData("text/plain", ids.join(","));
  };
  const startGroupDrag = (event: React.DragEvent, groupId: string) => {
    event.stopPropagation();
    setDrag({ kind: "group", groupId });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
  };
  const endDrag = () => {
    setDrag(null);
    setDropTarget(null);
  };
  /** Whether the current drag may drop on `target` (a group id or one of the special zones). */
  const accepts = (target: string): boolean => {
    if (!drag) return false;
    if (drag.kind === "group") {
      if (target === TOP_LEVEL) return true;
      if (target === ALL_LIST || target === NEW_GROUP) return false;
      return !wouldNestInItself(state.groups, drag.groupId, target);
    }
    return target !== TOP_LEVEL;
  };
  const dropZone = (target: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!accepts(target)) return;
      // The innermost zone (a nested group) wins over the groups around it.
      event.stopPropagation();
      event.preventDefault();
      event.dataTransfer.dropEffect =
        drag?.kind === "markups" && (event.ctrlKey || drag.from === ALL_LIST) ? "copy" : "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: React.DragEvent) => {
      const current = drag;
      endDrag();
      if (!current || !accepts(target)) return;
      event.stopPropagation();
      event.preventDefault();
      if (current.kind === "group") {
        dispatch({
          type: "NEST_GROUP",
          groupId: current.groupId,
          parentId: target === TOP_LEVEL ? null : target,
        });
      } else if (target === ALL_LIST) {
        // Dragged out of a group onto the master list: leaves that group.
        if (current.from !== ALL_LIST) {
          dispatch({ type: "REMOVE_FROM_GROUP", groupId: current.from, ids: current.ids });
        }
      } else if (current.from === ALL_LIST || event.ctrlKey) {
        dispatch({ type: "ADD_TO_GROUP", groupId: target, ids: current.ids });
      } else if (current.from !== target) {
        dispatch({ type: "MOVE_TO_GROUP", fromGroupId: current.from, toGroupId: target, ids: current.ids });
      }
    },
  });

  // ---- Copy / cut / paste group memberships while the panel has focus.
  const onKeyDown = (event: React.KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key !== "c" && key !== "x" && key !== "v") return;
    // Keep the canvas from copying or pasting markups as well.
    event.preventDefault();
    event.stopPropagation();
    if (key === "c" || key === "x") {
      const ids = state.selectedIds.filter((id) => existing.has(id));
      if (ids.length === 0) return;
      setMembershipClipboard({ ids, cutFrom: key === "x" ? activeGroupId : null });
      showSaveStatus("info", `${key === "x" ? "Cut" : "Copied"} ${ids.length} — click a group and press Ctrl+V`);
      return;
    }
    const clip = getMembershipClipboard();
    if (!clip) return;
    if (!activeGroupId) {
      showSaveStatus("info", "Click a group first, then paste");
      return;
    }
    if (clip.cutFrom && clip.cutFrom !== activeGroupId) {
      dispatch({ type: "MOVE_TO_GROUP", fromGroupId: clip.cutFrom, toGroupId: activeGroupId, ids: clip.ids });
      setMembershipClipboard(null);
    } else {
      dispatch({ type: "ADD_TO_GROUP", groupId: activeGroupId, ids: clip.ids });
    }
    showSaveStatus("success", `Added ${clip.ids.length} to ${groupName(activeGroupId)}`);
  };

  const indentStyle = (depth: number) => ({ paddingLeft: 12 + depth * NEST_INDENT_PX });

  const renameInput = (id: string, current: string, placeholder: string, depth: number) => (
    <div className="flex items-center gap-2 py-2 pr-3" style={indentStyle(depth)}>
      <input
        autoFocus
        value={draftName}
        placeholder={placeholder}
        aria-label={`Name for ${placeholder}`}
        onChange={(event) => setDraftName(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitRename(id, current);
          if (event.key === "Escape") cancelRename();
        }}
        onBlur={() => commitRename(id, current)}
        className="min-w-0 flex-1 rounded border border-accent bg-surface px-1.5 py-0.5 text-sm text-text-primary outline-none"
      />
    </div>
  );

  /** A markup's row in the list `list` (a group id, or the master list), `depth` levels in. */
  const renderRow = (row: MarkupRow, list: string, depth = 0) => {
    const inGroup = !isUngroupedList(list);
    return (
      <li
        key={`${list}:${row.id}`}
        draggable={renamingId !== row.id}
        onDragStart={(event) => startDrag(event, row.id, list)}
        onDragEnd={endDrag}
        className={`group relative transition ${
          selected.has(row.id) ? "bg-accent/10" : "hover:bg-surface-muted"
        }`}
      >
        {renamingId === row.id ? (
          renameInput(row.id, row.name, row.type, depth)
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => selectRow(row.id, list, event)}
              onDoubleClick={() => startRename(row.id, row.name)}
              style={indentStyle(depth)}
              className={`flex w-full items-start gap-2 py-2 text-left text-sm ${inGroup ? "pr-28" : "pr-24"}`}
            >
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 truncate text-xs font-medium text-text-secondary">
                  {row.name ? (
                    <>
                      <span className="font-semibold text-text-primary">{row.name}</span>
                      <span> · {row.type}</span>
                    </>
                  ) : (
                    row.type
                  )}
                  {multiSheet && row.page !== undefined && (
                    <span className="font-normal text-text-muted">· p.{row.page + 1}</span>
                  )}
                  {row.locked && (
                    <span title="Locked" className="text-text-muted">
                      <LockIcon />
                    </span>
                  )}
                </span>
                <span className="block truncate text-text-primary">{row.display}</span>
              </span>
            </button>
            <RowActions
              label={row.name || row.type}
              renameTitle="Rename"
              deleteTitle="Delete this markup"
              locked={!!row.locked}
              onRename={() => startRename(row.id, row.name)}
              onToggleLock={() => dispatch({ type: "SET_LOCKED", ids: [row.id], locked: !row.locked })}
              onRemove={
                inGroup
                  ? () => dispatch({ type: "REMOVE_FROM_GROUP", groupId: list, ids: [row.id] })
                  : undefined
              }
              onDelete={() => dispatch({ type: "DELETE_ANNOTATIONS", ids: [row.id] })}
            />
          </>
        )}
      </li>
    );
  };

  /** A group, its subgroups and its markups, `depth` levels in. */
  const renderGroup = (group: MarkupGroup, depth: number): React.ReactNode => {
    const members = groupsById.get(group.id)?.rows ?? [];
    const subgroups = childGroups(state.groups, group.id);
    const key = `${GROUP_KEY}${group.id}`;
    const collapsed = collapsedGroups.has(group.id);
    // Selecting, locking and counting cover the subgroups too.
    const allIds = subtreeMembers(state.groups, group.id, existing);
    const isSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
    const allLocked = allIds.length > 0 && allIds.every((id) => rowsById.get(id)?.locked);
    const counts = [
      `${allIds.length} item${allIds.length === 1 ? "" : "s"}`,
      ...(subgroups.length ? [`${subgroups.length} group${subgroups.length === 1 ? "" : "s"}`] : []),
    ].join(" · ");
    return (
      <li
        key={key}
        {...dropZone(group.id)}
        className={dropTarget === group.id ? "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent" : ""}
      >
        <div
          draggable={renamingId !== key}
          onDragStart={(event) => startGroupDrag(event, group.id)}
          onDragEnd={endDrag}
          className={`group relative transition ${
            isSelected || activeGroupId === group.id ? "bg-accent/10" : "hover:bg-surface-muted"
          }`}
        >
          {renamingId === key ? (
            renameInput(key, group.name, "Group", depth)
          ) : (
            <>
              <div className="flex items-center" style={indentStyle(depth)}>
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                  onClick={() => toggleGroup(group.id)}
                  className="py-2 pr-1 text-text-secondary hover:text-text-primary"
                >
                  <span aria-hidden className={`inline-block transition ${collapsed ? "" : "rotate-90"}`}>
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  title="Select everything in this group, including its subgroups. Drag to put it inside another group."
                  onClick={() => selectGroup(group.id, allIds)}
                  onDoubleClick={() => startRename(key, group.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm"
                >
                  <span className="truncate font-semibold text-text-primary">{group.name}</span>
                  <span className="shrink-0 text-xs text-text-muted">{counts}</span>
                </button>
                <button
                  type="button"
                  data-group-totals
                  title={`Totals for ${group.name}`}
                  aria-label={`Totals for ${group.name}`}
                  aria-expanded={groupTotals?.groupId === group.id}
                  onPointerEnter={(event) => {
                    if (groupTotals?.pinned) return;
                    const box = event.currentTarget.getBoundingClientRect();
                    setGroupTotals({ groupId: group.id, x: box.left, y: box.bottom + 4, pinned: false });
                  }}
                  onPointerLeave={() => {
                    setGroupTotals((open) => (open && !open.pinned ? null : open));
                  }}
                  onClick={(event) => {
                    const box = event.currentTarget.getBoundingClientRect();
                    setGroupTotals((open) =>
                      open?.groupId === group.id && open.pinned
                        ? null
                        : { groupId: group.id, x: box.left, y: box.bottom + 4, pinned: true },
                    );
                  }}
                  className={`mr-24 shrink-0 rounded p-1 transition hover:bg-surface hover:text-text-primary ${
                    groupTotals?.groupId === group.id ? "text-accent" : "text-text-muted"
                  }`}
                >
                  <ChartIcon />
                </button>
              </div>
              <RowActions
                label={group.name}
                renameTitle="Rename group"
                deleteTitle="Delete this group (its markups and subgroups stay)"
                locked={allLocked}
                onRename={() => startRename(key, group.name)}
                onToggleLock={() => dispatch({ type: "SET_LOCKED", ids: allIds, locked: !allLocked })}
                onDelete={() => dispatch({ type: "DELETE_GROUP", groupId: group.id })}
              />
            </>
          )}
        </div>
        {!collapsed &&
          (members.length === 0 && subgroups.length === 0 ? (
            <p className="border-t border-border py-2 pr-3 text-xs text-text-muted" style={indentStyle(depth + 1)}>
              Drag markups or groups here, or copy markups and paste with Ctrl+V.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {subgroups.map((child) => renderGroup(child, depth + 1))}
              {members.map((row) => renderRow(row, group.id, depth + 1))}
            </ul>
          ))}
      </li>
    );
  };

  /** Ungrouped markups of one type, under a heading like a group's (but not editable). */
  const renderTypeSection = (type: string, members: MarkupRow[]) => {
    const list = `${TYPE_LIST_PREFIX}${type}`;
    const collapsed = collapsedGroups.has(list);
    const ids = members.map((row) => row.id);
    const isSelected = ids.every((id) => selected.has(id));
    return (
      <li key={list}>
        <div className={`flex items-center transition ${isSelected ? "bg-accent/10" : "hover:bg-surface-muted"}`} style={indentStyle(0)}>
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${type}` : `Collapse ${type}`}
            onClick={() => toggleGroup(list)}
            className="py-2 pr-1 text-text-secondary hover:text-text-primary"
          >
            <span aria-hidden className={`inline-block transition ${collapsed ? "" : "rotate-90"}`}>
              ›
            </span>
          </button>
          <button
            type="button"
            title={`Select every ungrouped ${type.toLowerCase()} markup`}
            onClick={() => {
              dispatch({ type: "SET_TOOL", tool: "select" });
              dispatch({ type: "SET_SELECTION", ids });
              setActiveGroupId(null);
              setAnchor(null);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left text-sm"
          >
            <span className="truncate font-semibold text-text-primary">{type}</span>
            <span className="shrink-0 text-xs text-text-muted">
              {members.length} item{members.length === 1 ? "" : "s"}
            </span>
          </button>
        </div>
        {!collapsed && (
          <ul className="divide-y divide-border border-t border-border">
            {members.map((row) => renderRow(row, list, 1))}
          </ul>
        )}
      </li>
    );
  };

  const exportCsv = () => {
    const base = (state.fileName ?? "markups").replace(/\.[^.]+$/, "");
    // BOM so Excel opens the UTF-8 (×, ², ·) correctly.
    const blob = new Blob(["﻿", rowsToCsv(allRows, state.displayUnit)], {
      type: "text/csv;charset=utf-8",
    });
    downloadBlob(blob, `${base}-markups.csv`);
  };

  const sectionLabel = "px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-text-muted";

  return (
    <aside
      ref={asideRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ width }}
      className="relative flex shrink-0 flex-col border-l border-border bg-surface outline-none"
    >
      {/* Drag the left edge to resize; double-click puts it back to the default width. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize markups list"
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        tabIndex={0}
        title="Drag to resize. Double-click to reset."
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeRef.current = { startX: event.clientX, startWidth: width };
        }}
        onPointerMove={(event) => {
          const resize = resizeRef.current;
          if (!resize) return;
          resizeTo(resize.startWidth + resize.startX - event.clientX);
        }}
        onPointerUp={() => {
          if (!resizeRef.current) return;
          resizeRef.current = null;
          savePanelWidth(width);
        }}
        onPointerCancel={() => {
          resizeRef.current = null;
        }}
        onDoubleClick={() => savePanelWidth(resizeTo(PANEL_DEFAULT_WIDTH))}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 64 : 16;
          if (event.key === "ArrowLeft") savePanelWidth(resizeTo(width + step));
          else if (event.key === "ArrowRight") savePanelWidth(resizeTo(width - step));
          else return;
          event.preventDefault();
        }}
        className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none"
      >
        <div className="mx-auto h-full w-0.5 bg-transparent transition group-hover:bg-accent group-focus-visible:bg-accent" />
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-text-primary">
          Markups <span className="font-normal text-text-secondary">({rows.length})</span>
        </h2>
        <div className="flex shrink-0 items-center gap-1 whitespace-nowrap">
          <button
            type="button"
            onClick={() => createGroup(state.selectedIds)}
            {...dropZone(NEW_GROUP)}
            onDrop={(event) => {
              const current = drag;
              endDrag();
              if (current?.kind !== "markups") return;
              event.preventDefault();
              createGroup(current.ids);
            }}
            className={`btn-secondary px-1.5 py-1 text-xs ${dropTarget === NEW_GROUP ? "border-accent text-accent" : ""}`}
            title="New group (with the selected markups). You can also drop markups here."
          >
            + Group
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={allRows.length === 0}
            className="btn-secondary px-1.5 py-1 text-xs disabled:opacity-40"
            title="Download the list of every sheet as a CSV file for Excel"
          >
            Export CSV
          </button>
          <button
            type="button"
            title="Hide markups list"
            onClick={() => setOpen(false)}
            className="rounded px-1 py-1 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          >
            ›
          </button>
        </div>
      </div>

      {multiSheet && (
        <div className="flex gap-0.5 border-b border-border p-1" role="group" aria-label="Which sheets to list">
          {[
            { only: false, label: "All sheets" },
            { only: true, label: "This sheet" },
          ].map(({ only, label }) => (
            <button
              key={label}
              type="button"
              aria-pressed={thisSheetOnly === only}
              onClick={() => setThisSheetOnly(only)}
              className={`flex-1 rounded-md py-1 text-xs font-medium transition ${
                thisSheetOnly === only
                  ? "bg-surface-muted text-accent"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length > 0 && (
          <div
            {...dropZone(TOP_LEVEL)}
            className={dropTarget === TOP_LEVEL ? "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent" : ""}
          >
            <div className={sectionLabel} title="Drop a group here to take it out of its parent group">
              Groups
            </div>
            <ul className="divide-y divide-border border-y border-border">
              {childGroups(state.groups, null).map((group) => renderGroup(group, 0))}
            </ul>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-text-secondary">
            Markups you draw show up here with their measurements.
          </p>
        ) : (
          <div
            {...dropZone(ALL_LIST)}
            className={dropTarget === ALL_LIST ? "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent" : ""}
          >
            {groups.length > 0 && (
              <div className={sectionLabel} title="Drop markups here to take them out of the group they came from">
                Ungrouped
              </div>
            )}
            {ungroupedByType.size > 0 ? (
              <ul className="divide-y divide-border border-b border-border">
                {[...ungroupedByType].map(([type, members]) => renderTypeSection(type, members))}
              </ul>
            ) : (
              <p className="px-3 pb-3 text-xs text-text-muted">
                Everything is in a group. Drag a markup here to take it out of its group.
              </p>
            )}
          </div>
        )}
      </div>

      {groupTotals &&
        (() => {
          const group = state.groups.find((g) => g.id === groupTotals.groupId);
          if (!group) return null;
          const ids = new Set(subtreeMembers(state.groups, group.id, existing));
          const groupRows = rows.filter((row) => ids.has(row.id));
          const groupSums = summarizeRows(groupRows, state.displayUnit);
          return (
            <FloatingMenu
              x={groupTotals.x}
              y={groupTotals.y}
              menuRef={totalsRef}
              role="dialog"
              className="w-64 px-3 py-2"
            >
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-semibold uppercase tracking-wide text-text-secondary">
                  {group.name} totals
                </span>
                <span className="shrink-0 text-xs text-text-muted">
                  {groupRows.length} item{groupRows.length === 1 ? "" : "s"}
                </span>
              </div>
              {groupSums.length > 0 ? (
                <TotalsList totals={groupSums} />
              ) : (
                <p className="text-sm text-text-muted">No measured markups in this group yet.</p>
              )}
            </FloatingMenu>
          );
        })()}
      {totals.length > 0 && (
        <div className="border-t border-border bg-surface-muted px-3 py-2">
          <button
            type="button"
            aria-expanded={totalsOpen}
            onClick={() => setTotalsOpen((v) => !v)}
            className="flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-text-primary"
          >
            <span aria-hidden className={`inline-block transition ${totalsOpen ? "rotate-90" : ""}`}>
              ›
            </span>
            Totals
            {!totalsOpen && (
              <span className="ml-auto font-normal normal-case text-text-muted">{totals.length}</span>
            )}
          </button>
          <TotalsList
            totals={totals}
            className={`mt-1 max-h-48 overflow-y-auto ${totalsOpen ? "" : "hidden"}`}
          />
        </div>
      )}
    </aside>
  );
}
