"use client";

import { useEffect, useRef } from "react";
import type { LevelListener } from "@/hooks/useAudioRecorder";

/**
 * Mic level bar. Writes the width straight to its own element instead of
 * going through React state, so a level update never re-renders anything —
 * see useAudioRecorder for why.
 */
export function LevelMeter({
  subscribe,
}: {
  subscribe: (fn: LevelListener) => () => void;
}) {
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(
    () =>
      subscribe((level) => {
        if (barRef.current) barRef.current.style.width = `${Math.round(level * 100)}%`;
      }),
    [subscribe]
  );

  return (
    <div className="h-2 w-24 overflow-hidden rounded-full bg-subtle">
      <div
        ref={barRef}
        className="h-full rounded-full bg-red-500 transition-[width] duration-100"
        style={{ width: "0%" }}
      />
    </div>
  );
}
