import { useEffect } from "react";
import { useReplay } from "./ReplayContext.js";

/**
 * Auto-playback and the user's own scrolling both want to drive the
 * viewport — if the user wheels or touches to look around while playback is
 * running, it should get out of their way rather than keep yanking the page
 * back to the advancing cursor every tick.
 *
 * Listens for genuine user-driven scroll gestures (wheel/touchstart), not
 * the generic `scroll` event: playback's own auto-scroll-to-cursor
 * (Timeline's `scrollToIndex` effect) fires scroll events too, and reacting
 * to those would pause playback on its own very first tick. Only attached
 * while actually playing — nothing to pause otherwise.
 */
export function usePauseOnScroll(): void {
  const { playing, setPlaying } = useReplay();

  useEffect(() => {
    if (!playing) return;

    function pause() {
      setPlaying(false);
    }

    window.addEventListener("wheel", pause, { passive: true });
    window.addEventListener("touchstart", pause, { passive: true });
    return () => {
      window.removeEventListener("wheel", pause);
      window.removeEventListener("touchstart", pause);
    };
  }, [playing, setPlaying]);
}
