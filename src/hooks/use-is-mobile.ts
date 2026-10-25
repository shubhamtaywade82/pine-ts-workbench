"use client";

import { useState, useEffect } from "react";

/**
 * Returns true when the viewport width is below the `breakpoint` (default 768px).
 * Used to switch the sidebar to a Sheet (drawer) on mobile, collapse the chart
 * grid to 1 column, and adjust touch-friendly control sizes.
 *
 * SSR-safe: returns false on the server (no window), then updates on mount.
 */
export function useIsMobile(breakpoint: number = 768): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}
