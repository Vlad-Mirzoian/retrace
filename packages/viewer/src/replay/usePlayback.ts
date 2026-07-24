import { useEffect, useRef } from "react";
import { indexForSeq, itemKey, type TimelineItem } from "../timeline/grouping.js";
import { useReplay } from "./ReplayContext.js";

/** Milliseconds per row at 1x speed. */
export const BASE_INTERVAL_MS = 900;

/**
 * Advances the replay cursor through the currently visible (filtered +
 * grouped) `items` while playing — one row per tick, faster at higher
 * `speed` — and pauses automatically once the last row is reached. Reads
 * `items`/`currentSeq` off a ref inside the tick so changing `speed` doesn't
 * need to tear down and restart the interval mid-flight.
 */
export function usePlayback(items: TimelineItem[]): void {
  const { currentSeq, setCurrentSeq, playing, setPlaying, speed } = useReplay();

  const stateRef = useRef({ items, currentSeq });
  stateRef.current = { items, currentSeq };

  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      const { items: visible, currentSeq: seq } = stateRef.current;
      const nextIndex = indexForSeq(visible, seq) + 1;
      if (nextIndex >= visible.length) {
        setPlaying(false);
        return;
      }
      setCurrentSeq(itemKey(visible[nextIndex]));
    }, BASE_INTERVAL_MS / speed);

    return () => clearInterval(interval);
  }, [playing, speed, setCurrentSeq, setPlaying]);
}
