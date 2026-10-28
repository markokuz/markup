"use client";

import { useEffect, useState } from "react";

export type SaveStatusKind = "saving" | "success" | "warning" | "error" | "info";

export interface SaveStatus {
  kind: SaveStatusKind;
  text: string;
  /** Changes on every report so the same message shown twice still re-animates. */
  id: number;
}

// Module-level so any save path can report without threading props or reducer state.
let current: SaveStatus | null = null;
let nextId = 1;
const listeners = new Set<(status: SaveStatus | null) => void>();

export function showSaveStatus(kind: SaveStatusKind, text: string): void {
  current = { kind, text, id: nextId++ };
  listeners.forEach((listener) => listener(current));
}

export function clearSaveStatus(id: number): void {
  if (current?.id !== id) return;
  current = null;
  listeners.forEach((listener) => listener(null));
}

export function useSaveStatus(): SaveStatus | null {
  const [status, setStatus] = useState<SaveStatus | null>(current);
  useEffect(() => {
    listeners.add(setStatus);
    return () => {
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}
