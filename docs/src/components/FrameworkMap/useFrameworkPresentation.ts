import { useEffect, useRef, useState } from 'react';
import type { DagrExplorerMode } from '@prnt/dagr-explorer';

export function useFrameworkPresentation() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [responsiveMode, setResponsiveMode] =
    useState<DagrExplorerMode>('outline');
  const [chosenMode, chooseMode] = useState<DagrExplorerMode | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const measure = (width: number) => {
      // The feature overview needs a wide host to keep every title readable.
      if (width > 0) setResponsiveMode(width < 960 ? 'outline' : 'map');
    };
    measure(host.getBoundingClientRect().width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((entry) => entry.target === host);
      if (entry !== undefined) measure(entry.contentRect.width);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return { hostRef, mode: chosenMode ?? responsiveMode, chooseMode };
}
