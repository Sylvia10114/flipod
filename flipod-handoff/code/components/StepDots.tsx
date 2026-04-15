/**
 * StepDots — Practice flow step indicator (4 dots).
 *
 * Props:
 *   current  0‑3   active step index
 *   total    4     number of steps (default 4)
 *   color    accent color for the active dot  (default: accent-practice #A855F7)
 */

interface StepDotsProps {
  current: number;
  total?: number;
  color?: string;
}

export function StepDots({ current, total = 4, color }: StepDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className="block h-2 w-2 rounded-full"
          style={{
            backgroundColor:
              i === current ? (color ?? "#A855F7") : "rgba(255,255,255,0.12)",
          }}
        />
      ))}
    </div>
  );
}
