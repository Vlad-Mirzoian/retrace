import { useEffect } from "react";
import { useReplay } from "./ReplayContext.js";

/**
 * Failures/Findings side panels highlight whatever the replay cursor is
 * currently sitting on. If the user scrolls away to look at something else
 * in the timeline without moving the cursor, that highlight would otherwise
 * stay pinned to a spot they're no longer looking at. Suppress it on the
 * first genuine user-driven scroll gesture (wheel/touchstart) — mirrors
 * `usePauseOnScroll`'s detection, but runs unconditionally (not just while
 * playing) and clears on the *next* seek rather than on a timer, via
 * `setCurrentSeq` itself resetting `selectionSuppressed` back to false.
 */
export function useClearSelectionOnScroll(): void {
  const { suppressSelection } = useReplay();

  useEffect(() => {
    window.addEventListener("wheel", suppressSelection, { passive: true });
    window.addEventListener("touchstart", suppressSelection, { passive: true });
    return () => {
      window.removeEventListener("wheel", suppressSelection);
      window.removeEventListener("touchstart", suppressSelection);
    };
  }, [suppressSelection]);
}
