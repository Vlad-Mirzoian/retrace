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

  const setCurrentSeq = useCallback(
    (seq: number) => setCurrentSeqState(clamp(seq, maxSeq)),
    [maxSeq],
  );

  const value = useMemo<ReplayContextValue>(
    () => ({ currentSeq, setCurrentSeq, maxSeq, playing, setPlaying, speed, setSpeed }),
    [currentSeq, setCurrentSeq, maxSeq, playing, speed],
  );

  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

export function useReplay(): ReplayContextValue {
  const ctx = useContext(ReplayContext);
  if (!ctx) throw new Error("useReplay must be called within a ReplayProvider");
  return ctx;
}
