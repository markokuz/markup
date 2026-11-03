"use client";

import { useEffect, useState } from "react";

export interface CalibrationPrompt {
  text: string;
  /** Changes on every prompt so a repeat re-flashes the Calibrate button. */
  id: number;
}

// Module-level, like saveStatus, so any tool can ask without threading props or reducer state.
let current: CalibrationPrompt | null = null;
let nextId = 1;
const listeners = new Set<(prompt: CalibrationPrompt | null) => void>();

/** Point the user at Calibrate: a measuring tool was used before a scale was set. */
export function promptCalibration(text: string): void {
  current = { text, id: nextId++ };
  listeners.forEach((listener) => listener(current));
}

export function clearCalibrationPrompt(id?: number): void {
  if (!current || (id !== undefined && current.id !== id)) return;
  current = null;
  listeners.forEach((listener) => listener(null));
}

export function useCalibrationPrompt(): CalibrationPrompt | null {
  const [prompt, setPrompt] = useState<CalibrationPrompt | null>(current);
  useEffect(() => {
    listeners.add(setPrompt);
    return () => {
      listeners.delete(setPrompt);
    };
  }, []);
  return prompt;
}
