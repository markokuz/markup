"use client";

import dynamic from "next/dynamic";

const MarkupApp = dynamic(() => import("@/app/components/MarkupApp"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen items-center justify-center bg-background text-text-secondary">
      Loading…
    </div>
  ),
});

export default function ClientHome() {
  return <MarkupApp />;
}
