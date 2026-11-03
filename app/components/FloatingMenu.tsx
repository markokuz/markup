"use client";

import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

/** Space kept between the menu and the window edge, in px. */
const EDGE_GAP_PX = 8;

/**
 * Menu at a window (client) point, outside any clipping container. It opens down
 * and right of the point, flipping left or up where that would run off the window.
 */
export function FloatingMenu({
  x,
  y,
  menuRef,
  role = "menu",
  className = "min-w-[150px] p-1",
  children,
}: {
  x: number;
  y: number;
  menuRef: RefObject<HTMLDivElement | null>;
  /** "menu" for a list of actions; "dialog" for a read-only popover. */
  role?: "menu" | "dialog";
  className?: string;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const fitsRight = x + width + EDGE_GAP_PX <= window.innerWidth;
    const fitsBelow = y + height + EDGE_GAP_PX <= window.innerHeight;
    el.style.left = `${Math.max(EDGE_GAP_PX, fitsRight ? x : x - width)}px`;
    el.style.top = `${Math.max(EDGE_GAP_PX, fitsBelow ? y : y - height)}px`;
  }, [menuRef, x, y]);

  return createPortal(
    <div
      ref={menuRef}
      role={role}
      className={`fixed z-50 rounded-lg border border-border bg-surface shadow-lg ${className}`}
      style={{ left: x, top: y }}
      // Portal events still bubble through React to the overlay; keep them here.
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
