"use client";

import { useEffect, useRef, useState } from "react";
import { hexToHsv, hsvToHex, type Hsv } from "@/app/utils/colors";

const WHEEL_SIZE = 160;
const HEX_PATTERN = /^#?([0-9a-f]{6})$/i;
const HUE_RING =
  "conic-gradient(from 90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";

interface ColorWheelProps {
  value: string;
  /** `recordUndo` is false for the follow-up updates of one drag. */
  onChange: (hex: string, recordUndo: boolean) => void;
  /** "above" suits the bottom status bar; "below" suits scrolling panels. */
  placement?: "above" | "below";
}

/** Rainbow button that opens a hue/saturation wheel with a brightness slider and hex field. */
export function ColorWheel({ value, onChange, placement = "above" }: ColorWheelProps) {
  const [open, setOpen] = useState(false);
  // Kept locally so hue survives at zero saturation/brightness, which hex can't encode.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const apply = (next: Hsv, recordUndo: boolean) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setHexDraft(hex);
    onChange(hex, recordUndo);
  };

  const pickFromWheel = (event: React.PointerEvent, recordUndo: boolean) => {
    const rect = wheelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
    const s = Math.min(1, Math.hypot(dx, dy) / (rect.width / 2));
    // Picking on a black colour would show nothing, so lift brightness to full.
    apply({ h, s, v: hsv.v < 0.15 ? 1 : hsv.v }, recordUndo);
  };

  const radius = WHEEL_SIZE / 2;
  const marker = {
    x: radius + Math.cos((hsv.h * Math.PI) / 180) * hsv.s * radius,
    y: radius + Math.sin((hsv.h * Math.PI) / 180) * hsv.s * radius,
  };
  const fullColor = hsvToHex({ ...hsv, v: 1 });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title="Pick any colour"
        aria-label="Open colour wheel"
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            setHsv(hexToHsv(value));
            setHexDraft(value);
          }
          setOpen(!open);
        }}
        className="h-6 w-6 rounded-full border-2 border-surface shadow-sm ring-1 ring-border"
        style={{ background: HUE_RING }}
      />
      {open && (
        <div
          className={`absolute right-0 z-50 w-[192px] rounded-xl border border-border bg-surface p-4 shadow-lg ${
            placement === "above" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <div
            ref={wheelRef}
            role="slider"
            aria-label="Hue and saturation"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            aria-valuetext={hexDraft}
            className="relative cursor-crosshair touch-none rounded-full"
            style={{
              width: WHEEL_SIZE,
              height: WHEEL_SIZE,
              background: `radial-gradient(closest-side, #fff, rgba(255,255,255,0)), ${HUE_RING}`,
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingRef.current = true;
              pickFromWheel(event, true);
            }}
            onPointerMove={(event) => {
              if (draggingRef.current) pickFromWheel(event, false);
            }}
            onPointerUp={() => {
              draggingRef.current = false;
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-full bg-black"
              style={{ opacity: 1 - hsv.v }}
            />
            <div
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
              style={{ left: marker.x, top: marker.y, backgroundColor: hsvToHex(hsv) }}
            />
          </div>

          <input
            type="range"
            min={0}
            max={100}
            aria-label="Brightness"
            value={Math.round(hsv.v * 100)}
            onPointerDown={() => onChange(hsvToHex(hsv), true)}
            onChange={(event) => apply({ ...hsv, v: Number(event.target.value) / 100 }, false)}
            className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full"
            style={{ background: `linear-gradient(to right, #000, ${fullColor})` }}
          />

          <div className="mt-3 flex items-center gap-2">
            <span
              className="h-6 w-6 shrink-0 rounded border border-border"
              style={{ backgroundColor: hsvToHex(hsv) }}
            />
            <input
              value={hexDraft}
              aria-label="Hex colour"
              spellCheck={false}
              onChange={(event) => setHexDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") (event.target as HTMLInputElement).blur();
              }}
              onBlur={() => {
                const match = HEX_PATTERN.exec(hexDraft.trim());
                const current = hsvToHex(hsv);
                if (match && `#${match[1].toLowerCase()}` !== current) {
                  apply(hexToHsv(`#${match[1]}`), true);
                } else {
                  setHexDraft(current);
                }
              }}
              className="min-w-0 flex-1 rounded border border-border bg-surface px-2 py-1 font-mono text-xs uppercase text-text-primary"
            />
          </div>
        </div>
      )}
    </div>
  );
}
