import { nextOfKind, type NavIndex } from "retrace-core/browser";
import { useReplay } from "./ReplayContext.js";

const SPEEDS = [0.5, 1, 2, 4];

export function ReplayControls({ navIndex }: { navIndex: NavIndex }) {
  const { currentSeq, setCurrentSeq, maxSeq, playing, setPlaying, speed, setSpeed } = useReplay();

  // Any manual seek stops playback — otherwise the next tick would just
  // override wherever the user just jumped to.
  function seek(seq: number) {
    setPlaying(false);
    setCurrentSeq(seq);
  }

  function jump(kind: "errors" | "fileChanges", dir: 1 | -1) {
    const target = nextOfKind(navIndex, currentSeq, kind, dir);
    if (target !== null) seek(target);
  }

  const atStart = currentSeq <= 0;
  const atEnd = currentSeq >= maxSeq;

  return (
    <div className="replay-controls">
      <button type="button" onClick={() => seek(0)} disabled={atStart} aria-label="First step">
        ⏮
      </button>
      <button
        type="button"
        onClick={() => seek(currentSeq - 1)}
        disabled={atStart}
        aria-label="Step back"
      >
        ◀
      </button>
      <button
        type="button"
        className="replay-play"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? "Pause" : "Play"}
        disabled={atEnd && !playing}
      >
        {playing ? "⏸" : "▶"}
      </button>
      <button
        type="button"
        onClick={() => seek(currentSeq + 1)}
        disabled={atEnd}
        aria-label="Step forward"
      >
        ▶
      </button>
      <button type="button" onClick={() => seek(maxSeq)} disabled={atEnd} aria-label="Last step">
        ⏭
      </button>

      <input
        type="range"
        className="replay-scrubber"
        min={0}
        max={maxSeq}
        value={currentSeq}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label="Replay position"
      />
      <span className="replay-position muted small">
        {currentSeq} / {maxSeq}
      </span>

      <div className="replay-jumps">
        <button type="button" onClick={() => jump("errors", -1)} aria-label="Previous error">
          ◀ Error
        </button>
        <button type="button" onClick={() => jump("errors", 1)} aria-label="Next error">
          Error ▶
        </button>
        <button type="button" onClick={() => jump("fileChanges", -1)} aria-label="Previous file change">
          ◀ File
        </button>
        <button type="button" onClick={() => jump("fileChanges", 1)} aria-label="Next file change">
          File ▶
        </button>
      </div>

      <label className="replay-speed muted small">
        Speed
        <select
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
