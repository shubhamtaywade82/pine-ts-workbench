"use client";

import { useEffect, useRef, useState } from "react";

/** The element's current width in CSS pixels, so a chart can draw at its real size instead of being scaled. */
export function useElementWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(Math.max(200, Math.round(entry.contentRect.width))); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
