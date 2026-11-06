const NON_TEXT_INPUTS = new Set(["color", "checkbox", "radio", "range", "button", "file"]);

/** A field that keys type into. */
export function isTextEntry(target: HTMLElement): boolean {
  return (
    target.isContentEditable ||
    target.tagName === "TEXTAREA" ||
    (target.tagName === "INPUT" && !NON_TEXT_INPUTS.has((target as HTMLInputElement).type))
  );
}

/** True from a Tab press until the next pointer press. */
let tabbing = false;

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (event) => {
    if (event.key === "Tab") tabbing = true;
  }, true);
  window.addEventListener("pointerdown", () => {
    tabbing = false;
  }, true);
}

/**
 * Focus a click left behind on a button, select or slider, which shouldn't swallow the app's
 * shortcuts. :focus-visible can't spot this: browsers turn it on for any focused element once a key is down.
 */
export function isLeftoverFocus(target: HTMLElement): boolean {
  return !tabbing && !isTextEntry(target) && !target.closest('[aria-modal="true"], [role="menu"]');
}
