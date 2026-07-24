import { useEffect, useRef } from "react";
import { indexForSeq, itemKey, itemRange, type TimelineItem } from "../timeline/grouping.js";
import { useReplay } from "./ReplayContext.js";

/** Milliseconds per row at 1x speed. */
export const BASE_INTERVAL_MS = 900;

/**
 * Advances the replay cursor through the currently visible (filtered +
 * grouped) `items` while playing — one row per tick, faster at higher
 * `speed` — and pauses automatically once the last row is reached. Reads
 * `items`/`currentSeq` off a ref inside the tick, so re-filtering the
 * timeline or moving the cursor doesn't tear down and restart the interval
 * mid-flight (only play/pause and speed do).
 */
export function usePlayback(items: TimelineItem[]): void {
  const { currentSeq, setCurrentSeq, playing, setPlaying, speed } = useReplay();

  const stateRef = useRef({ items, currentSeq });
  stateRef.current = { items, currentSeq };

  useEffect(() => {
    if (!playing) return;

    const interval = setInterval(() => {
      const { items: visible, currentSeq: seq } = stateRef.current;
      const index = indexForSeq(visible, seq);
      // indexForSeq snaps *forward* when the cursor sits in a gap the active
      // filter hid, so the row it lands on hasn't been played yet — step onto
      // it rather than past it. Only advance when the cursor is genuinely
      // inside (or past) that row already.
      const alreadyOnRow = index >= 0 && itemRange(visible[index])[0] <= seq;
      const nextIndex = alreadyOnRow ? index + 1 : index;
      if (nextIndex < 0 || nextIndex >= visible.length) {
        setPlaying(false);
        return;
      }
      setCurrentSeq(itemKey(visible[nextIndex]));
    }, BASE_INTERVAL_MS / speed);

    return () => clearInterval(interval);
  }, [playing, speed, setCurrentSeq, setPlaying]);
}
