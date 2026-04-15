/**
 * PlayButton — Circular play/pause toggle.
 *
 * Sizes:
 *   sm  48px  (practice screens)
 *   md  52px  (feed player, default)
 *   lg  64px  (blind listen waveform overlay)
 *
 * Uses lucide-react icons.
 */

import { Play, Pause } from "lucide-react";

interface PlayButtonProps {
  isPlaying?: boolean;
  size?: "sm" | "md" | "lg";
  color?: string;
  onToggle?: () => void;
}

const sizes = {
  sm: { box: 48, icon: 20 },
  md: { box: 52, icon: 22 },
  lg: { box: 64, icon: 26 },
} as const;

export function PlayButton({
  isPlaying = false,
  size = "md",
  color = "#8B9CF7",
  onToggle,
}: PlayButtonProps) {
  const s = sizes[size];
  const Icon = isPlaying ? Pause : Play;

  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-center rounded-full"
      style={{
        width: s.box,
        height: s.box,
        backgroundColor: color,
      }}
    >
      <Icon size={s.icon} className="text-text-on-accent" fill="currentColor" />
    </button>
  );
}
