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
