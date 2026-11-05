/** Last scroll position per page of each tab, so switching back returns to the same spot. */
const scrollPositions = new Map<string, { left: number; top: number }>();

export function tabScrollKey(tabId: string, page: number): string {
  return `${tabId}:${page}`;
}

export function saveTabScroll(key: string, left: number, top: number) {
  scrollPositions.set(key, { left, top });
}

export function getTabScroll(key: string): { left: number; top: number } | null {
  return scrollPositions.get(key) ?? null;
}

/** Drop saved positions for tabs that have been closed. */
export function pruneTabScroll(openTabIds: string[]) {
  const open = new Set(openTabIds);
  for (const key of scrollPositions.keys()) {
    if (!open.has(key.slice(0, key.lastIndexOf(":")))) scrollPositions.delete(key);
  }
}
