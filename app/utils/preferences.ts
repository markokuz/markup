const CONFIRM_CLOSE_KEY = "markup.confirmCloseUnsaved";

export function loadConfirmCloseUnsaved(): boolean {
  try {
    return window.localStorage.getItem(CONFIRM_CLOSE_KEY) !== "false";
  } catch {
    return true;
  }
}

export function saveConfirmCloseUnsaved(enabled: boolean): void {
  try {
    window.localStorage.setItem(CONFIRM_CLOSE_KEY, String(enabled));
  } catch {
    // Storage unavailable (private mode, blocked site data) — keep the in-memory value.
  }
}

function loadBoolean(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function saveBoolean(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage unavailable — keep the in-memory value.
  }
}

const SNAP_LINES_KEY = "markup.snapLines";
const AUTO_ORIENT_KEY = "markup.autoOrientPortrait";

export const loadSnapLines = () => loadBoolean(SNAP_LINES_KEY, true);
export const saveSnapLines = (enabled: boolean) => saveBoolean(SNAP_LINES_KEY, enabled);
export const loadAutoOrientPortrait = () => loadBoolean(AUTO_ORIENT_KEY, true);
export const saveAutoOrientPortrait = (enabled: boolean) =>
  saveBoolean(AUTO_ORIENT_KEY, enabled);
