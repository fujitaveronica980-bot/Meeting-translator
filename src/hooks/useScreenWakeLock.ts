"use client";

import { useEffect } from "react";

/**
 * Keeps the screen from turning off while `active` is true (Screen Wake
 * Lock API). A browser stops recording the microphone, and can drop an
 * upload in progress, once the phone's screen locks — a web page can't
 * work around that, so the next best thing is to stop the screen locking
 * for as long as it matters.
 *
 * The browser releases the lock whenever the page is hidden, so it is
 * taken again when the page becomes visible. Where the API is missing or
 * refused (e.g. low battery mode) this quietly does nothing.
 */
export function useScreenWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const sentinel = await navigator.wakeLock.request("screen");
        if (cancelled) sentinel.release().catch(() => {});
        else lock = sentinel;
      } catch (err) {
        console.warn("Could not keep the screen on:", err);
      }
    };

    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", acquire);
      lock?.release().catch(() => {});
    };
  }, [active]);
}
