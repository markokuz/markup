"use client";

import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppState } from "@/app/context/AppContext";
import { downloadBlob } from "@/app/utils/exportDocument";
import { liveMembers, markupIds, nextGroupName } from "@/app/utils/groups";
import { buildMarkupRows, rowsToCsv, summarizeRows, type MarkupRow } from "@/app/utils/markupList";
import { showSaveStatus } from "@/app/utils/saveStatus";

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
        className={`${button} hover:text-red-600`}
      >
        <TrashIcon />
      </button>
    </div>
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

/** Drag payload: the markups being dragged and the list they were dragged from. */
interface RowDrag {
  ids: string[];
  /** A group id, or ALL_LIST for the "All markups" list. */
  from: string;
}

const ALL_LIST = "all";

/** Right-hand list of every markup with quantities and totals, exportable to CSV. */
export function MarkupsPanel() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(true);
  const [totalsOpen, setTotalsOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Shift-click ranges run from here, within the list it was clicked in.
  const [anchor, setAnchor] = useState<{ list: string; id: string } | null>(null);
  // Ctrl+V pastes into the group last clicked (its header or one of its rows).
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [drag, setDrag] = useState<RowDrag | null>(null);
  // Enter then blur both commit; the ref lets only the first one apply.
  const renamingRef = useRef<string | null>(null);
  const asideRef = useRef<HTMLElement>(null);

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

  if (!state.fileBytes) return null;

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

  const rows = buildMarkupRows(state);
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const totals = summarizeRows(rows, state.displayUnit);
  const selected = new Set(state.selectedIds);
  const existing = markupIds(state);
  const groups = state.groups.map((group) => ({
    group,
    rows: liveMembers(group, existing).flatMap((id) => rowsById.get(id) ?? []),
  }));
  const listIds = (list: string) =>
    list === ALL_LIST ? rows.map((row) => row.id) : (groups.find((g) => g.group.id === list)?.rows ?? []).map((r) => r.id);
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
    setActiveGroupId(list === ALL_LIST ? null : list);
    const additive = event.ctrlKey || event.metaKey;
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

  // ---- Drag and drop rows between lists.
  const startDrag = (event: React.DragEvent, id: string, from: string) => {
    const ids = selected.has(id) ? state.selectedIds.filter((s) => existing.has(s)) : [id];
    setDrag({ ids, from });
    event.dataTransfer.effectAllowed = "copyMove";
    // Firefox only starts a drag with some data set.
    event.dataTransfer.setData("text/plain", ids.join(","));
  };
  const endDrag = () => {
    setDrag(null);
    setDropTarget(null);
  };
  const dropZone = (target: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!drag) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = event.ctrlKey || drag.from === ALL_LIST ? "copy" : "move";
      if (dropTarget !== target) setDropTarget(target);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
    },
    onDrop: (event: React.DragEvent) => {
      endDrag();
      if (!drag) return;
      event.preventDefault();
      if (target === ALL_LIST) {
        // Dragged out of a group onto the master list: leaves that group.
        if (drag.from !== ALL_LIST) dispatch({ type: "REMOVE_FROM_GROUP", groupId: drag.from, ids: drag.ids });
      } else if (drag.from === ALL_LIST || event.ctrlKey) {
        dispatch({ type: "ADD_TO_GROUP", groupId: target, ids: drag.ids });
      } else if (drag.from !== target) {
        dispatch({ type: "MOVE_TO_GROUP", fromGroupId: drag.from, toGroupId: target, ids: drag.ids });
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

  const renameInput = (id: string, current: string, placeholder: string, indent: boolean) => (
    <div className={`flex items-center gap-2 py-2 pr-3 ${indent ? "pl-7" : "pl-3"}`}>
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

  /** A markup's row in the list `list` (a group id, or the master list). */
  const renderRow = (row: MarkupRow, list: string) => {
    const inGroup = list !== ALL_LIST;
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
          renameInput(row.id, row.name, row.type, inGroup)
        ) : (
          <>
            <button
              type="button"
              onClick={(event) => selectRow(row.id, list, event)}
              onDoubleClick={() => startRename(row.id, row.name)}
              className={`flex w-full items-start gap-2 py-2 text-left text-sm ${inGroup ? "pl-7 pr-28" : "pl-3 pr-24"}`}
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

  const renderGroup = ({ group, rows: members }: (typeof groups)[number]) => {
    const key = `${GROUP_KEY}${group.id}`;
    const collapsed = collapsedGroups.has(group.id);
    const memberIds = members.map((row) => row.id);
    const isSelected = members.length > 0 && members.every((row) => selected.has(row.id));
    const allLocked = members.length > 0 && members.every((row) => row.locked);
    return (
      <li
        key={key}
        {...dropZone(group.id)}
        className={dropTarget === group.id ? "bg-accent/10 outline outline-1 -outline-offset-1 outline-accent" : ""}
      >
        <div
          className={`group relative transition ${
            isSelected || activeGroupId === group.id ? "bg-accent/10" : "hover:bg-surface-muted"
          }`}
        >
          {renamingId === key ? (
            renameInput(key, group.name, "Group", false)
          ) : (
            <>
              <div className="flex items-center">
                <button
                  type="button"
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                  onClick={() => toggleGroup(group.id)}
                  className="py-2 pl-3 pr-1 text-text-secondary hover:text-text-primary"
                >
                  <span aria-hidden className={`inline-block transition ${collapsed ? "" : "rotate-90"}`}>
                    ›
                  </span>
                </button>
                <button
                  type="button"
                  title="Select everything in this group"
                  onClick={() => selectGroup(group.id, memberIds)}
                  onDoubleClick={() => startRename(key, group.name)}
                  className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-24 text-left text-sm"
                >
                  <span className="truncate font-semibold text-text-primary">{group.name}</span>
                  <span className="shrink-0 text-xs text-text-muted">
                    {members.length} item{members.length === 1 ? "" : "s"}
                  </span>
                </button>
              </div>
              <RowActions
                label={group.name}
                renameTitle="Rename group"
                deleteTitle="Delete this group (its markups stay)"
                locked={allLocked}
                onRename={() => startRename(key, group.name)}
                onToggleLock={() => dispatch({ type: "SET_LOCKED", ids: memberIds, locked: !allLocked })}
                onDelete={() => dispatch({ type: "DELETE_GROUP", groupId: group.id })}
              />
            </>
          )}
        </div>
        {!collapsed &&
          (members.length === 0 ? (
            <p className="border-t border-border py-2 pl-7 pr-3 text-xs text-text-muted">
              Drag markups here, or copy them and paste with Ctrl+V.
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {members.map((row) => renderRow(row, group.id))}
            </ul>
          ))}
      </li>
    );
  };

  const exportCsv = () => {
    const base = (state.fileName ?? "markups").replace(/\.[^.]+$/, "");
    // BOM so Excel opens the UTF-8 (×, ², ·) correctly.
    const blob = new Blob(["﻿", rowsToCsv(rows, state.displayUnit)], {
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
      className="flex w-72 shrink-0 flex-col border-l border-border bg-surface outline-none"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold text-text-primary">
          Markups <span className="font-normal text-text-secondary">({rows.length})</span>
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => createGroup(state.selectedIds)}
            {...dropZone("new")}
            onDrop={(event) => {
              endDrag();
              if (!drag) return;
              event.preventDefault();
              createGroup(drag.ids);
            }}
            className={`btn-secondary px-2 py-1 text-xs ${dropTarget === "new" ? "border-accent text-accent" : ""}`}
            title="New group (with the selected markups). You can also drop markups here."
          >
            + Group
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
            title="Download the list as a CSV file for Excel"
          >
            Export CSV
          </button>
          <button
            type="button"
            title="Hide markups list"
            onClick={() => setOpen(false)}
            className="rounded px-1.5 py-1 text-text-secondary hover:bg-surface-muted hover:text-text-primary"
          >
            ›
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length > 0 && (
          <>
            <div className={sectionLabel}>Groups</div>
            <ul className="divide-y divide-border border-y border-border">{groups.map(renderGroup)}</ul>
          </>
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
            {groups.length > 0 && <div className={sectionLabel}>All markups</div>}
            <ul className="divide-y divide-border">{rows.map((row) => renderRow(row, ALL_LIST))}</ul>
          </div>
        )}
      </div>

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
          <ul className={`mt-1 max-h-48 space-y-1 overflow-y-auto ${totalsOpen ? "" : "hidden"}`}>
            {totals.map((t) => (
              <li key={`${t.type}-${t.color}`} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
                <span className="text-text-secondary">{t.type}</span>
                <span className="ml-auto font-medium text-text-primary">{t.display}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  );
}
