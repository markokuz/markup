/** Last scroll position per tab, so switching tabs returns to the same spot. */
const scrollPositions = new Map<string, { left: number; top: number }>();

export function saveTabScroll(tabId: string, left: number, top: number) {
  scrollPositions.set(tabId, { left, top });
}

export function getTabScroll(tabId: string): { left: number; top: number } | null {
  return scrollPositions.get(tabId) ?? null;
}

/** Drop saved positions for tabs that have been closed. */
export function pruneTabScroll(openTabIds: string[]) {
  const open = new Set(openTabIds);
  for (const tabId of scrollPositions.keys()) {
    if (!open.has(tabId)) scrollPositions.delete(tabId);
  }
}
