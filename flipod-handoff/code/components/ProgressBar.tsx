/**
 * ProgressBar — Audio progress bar with time labels.
 *
 * Layout:  currentTime  ─────●──────  totalTime
 *
 * Props:
 *   current   seconds elapsed
 *   total     total duration in seconds
 *   color     fill color (default: accent-feed)
 */

interface ProgressBarProps {
  current: number;
  total: number;
  color?: string;
  onSeek?: (seconds: number) => void;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function ProgressBar({
  current,
  total,
  color = "#8B9CF7",
  onSeek,
}: ProgressBarProps) {
  const pct = total > 0 ? (current / total) * 100 : 0;

  return (
    <div className="flex w-full items-center gap-2">
      <span className="font-mono text-caption-sm text-text-3 tabular-nums">
        {fmt(current)}
      </span>

      <div
        className="relative h-1 flex-1 rounded-sm"
        style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
        onClick={(e) => {
          if (!onSeek) return;
          const rect = e.currentTarget.getBoundingClientRect();
          onSeek((e.clientX - rect.left) / rect.width * total);
        }}
      >
        {/* filled track */}
        <div
          className="absolute left-0 top-0 h-full rounded-sm"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
        {/* thumb */}
        <div
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full bg-white/95"
          style={{ left: `${pct}%`, marginLeft: -6 }}
        />
      </div>

      <span className="font-mono text-caption-sm text-text-3 tabular-nums">
        {fmt(total)}
      </span>
    </div>
  );
}
