import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface ReplayContextValue {
  /** The replay cursor: a raw event seq, not an index into any filtered/grouped list. */
  currentSeq: number;
  setCurrentSeq: (seq: number) => void;
  /** The last event's seq in the session — the scrubber's upper bound. */
  maxSeq: number;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  /** Playback speed multiplier (1 = one row per base tick). */
  speed: number;
  setSpeed: (speed: number) => void;
  /**
   * True once the user has manually scrolled since the last seek. Failures/
   * Findings side panels use this to drop their "selected" highlight instead
   * of leaving it pinned to a spot the user has since scrolled away from —
   * see `useClearSelectionOnScroll`. A fresh `setCurrentSeq` call (from
   * anywhere: replay controls, a panel click, a timeline row) clears it back
   * to false on its own, since that's a new, deliberate look at that seq.
   */
  selectionSuppressed: boolean;
  suppressSelection: () => void;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

function clamp(seq: number, maxSeq: number): number {
  return Math.min(Math.max(seq, 0), maxSeq);
}

/**
 * Shares the replay cursor (current seq, play/pause, speed) across the
 * timeline, the working-tree panel, and the failure panel — the viewer's
 * first shared state, replacing what would otherwise be prop-drilling
 * through SessionDetailPage / the export bundle's equivalent.
 */
export function ReplayProvider({
  maxSeq,
  children,
}: {
  maxSeq: number;
  children: ReactNode;
}) {
  const [currentSeq, setCurrentSeqState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [selectionSuppressed, setSelectionSuppressed] = useState(false);

  const setCurrentSeq = useCallback(
    (seq: number) => {
      setCurrentSeqState(clamp(seq, maxSeq));
      setSelectionSuppressed(false);
    },
    [maxSeq],
  );

  const suppressSelection = useCallback(() => setSelectionSuppressed(true), []);

  const value = useMemo<ReplayContextValue>(
    () => ({
      currentSeq,
      setCurrentSeq,
      maxSeq,
      playing,
      setPlaying,
      speed,
      setSpeed,
      selectionSuppressed,
      suppressSelection,
    }),
    [currentSeq, setCurrentSeq, maxSeq, playing, speed, selectionSuppressed, suppressSelection],
  );

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function useReplay(): ReplayContextValue {
  const ctx = useContext(ReplayContext);
  if (!ctx) throw new Error("useReplay must be called within a ReplayProvider");
  return ctx;
}
