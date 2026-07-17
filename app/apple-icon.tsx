import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
        }}
      >
        <svg
          width="120"
          height="120"
          viewBox="0 0 32 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="7" y="5" width="18" height="22" rx="2" stroke="#334155" strokeWidth="1.5" />
          <line
            x1="10"
            y1="22"
            x2="22"
            y2="10"
            stroke="#06b6d4"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
          <circle cx="10" cy="22" r="2.25" fill="#22d3ee" />
          <circle cx="22" cy="10" r="2.25" fill="#22d3ee" />
          <line
            x1="8"
            y1="24"
            x2="8"
            y2="22"
            stroke="#475569"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1="24"
            y1="10"
            x2="24"
            y2="8"
            stroke="#475569"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>
    ),
    { ...size },
  );
}
