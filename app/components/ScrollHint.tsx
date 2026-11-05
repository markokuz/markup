"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * For a scroll area with its scrollbar hidden: which ends are cut off, and a way to
 * scroll toward them. `watch` is anything whose change can alter what's inside.
 */
export function useScrollHints(axis: "x" | "y", watch: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const [position, size, total] =
      axis === "x"
        ? [el.scrollLeft, el.clientWidth, el.scrollWidth]
        : [el.scrollTop, el.clientHeight, el.scrollHeight];
    const start = position > 1;
    const end = position + size < total - 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, [axis]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateOverflow();
    // The window resizing, or something inside changing size, changes what fits.
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [updateOverflow, watch]);

  const scrollBy = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = direction * 0.6 * (axis === "x" ? el.clientWidth : el.clientHeight);
    el.scrollBy({ [axis === "x" ? "left" : "top"]: distance, behavior: "smooth" });
  };

  return { scrollRef, overflow, updateOverflow, scrollBy };
}

const HINTS = {
  up: { bar: "inset-x-0 top-0 h-7 items-start justify-center bg-linear-to-b pt-0.5", chevron: "M3 9l4-4 4 4" },
  down: { bar: "inset-x-0 bottom-0 h-7 items-end justify-center bg-linear-to-t pb-0.5", chevron: "M3 5l4 4 4-4" },
  left: { bar: "inset-y-0 left-0 w-8 items-center justify-start bg-linear-to-r pl-0.5", chevron: "M9 3L5 7l4 4" },
  right: { bar: "inset-y-0 right-0 w-8 items-center justify-end bg-linear-to-l pr-0.5", chevron: "M5 3l4 4-4 4" },
};

/** Fade and chevron over a cut-off end of a scroll area in a `relative` parent; clicking scrolls that way. */
export function ScrollHint({
  direction,
  title,
  onClick,
}: {
  direction: keyof typeof HINTS;
  title: string;
  onClick: () => void;
}) {
  const { bar, chevron } = HINTS[direction];
  return (
    <button
      type="button"
      tabIndex={-1}
      title={title}
      aria-label={`Scroll to ${title.toLowerCase()}`}
      onClick={onClick}
      className={`absolute flex from-surface via-surface/90 to-transparent text-text-secondary hover:text-text-primary ${bar}`}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
        <path d={chevron} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
