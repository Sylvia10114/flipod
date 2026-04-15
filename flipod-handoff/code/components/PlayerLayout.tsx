/**
 * PlayerLayout — Master frame layout for all Player/Practice screens.
 *
 * Zones (within a 375×812 iPhone frame, status bar excluded):
 *   Header   — 120px fixed  (step dots, title, source)
 *   Content  — flex-1        (subtitles, waveform, flashcard)
 *   Controls — 180px fixed   (buttons, progress bar, play)
 *
 * All Player & Practice screens share this skeleton so that the
 * header‑bottom, content‑start, and controls‑top lines are pixel‑aligned.
 */

import { ReactNode } from "react";

interface PlayerLayoutProps {
  header?: ReactNode;
  children: ReactNode;       // content zone
  controls?: ReactNode;
  /** Optional absolute‑positioned overlays (side icons, word popup) */
  overlays?: ReactNode;
}

export function PlayerLayout({
  header,
  children,
  controls,
  overlays,
}: PlayerLayoutProps) {
  return (
    <div className="relative flex h-full flex-col px-body-x">
      {/* ── Header Zone ── */}
      <div className="flex h-zone-header flex-col items-center justify-center gap-2">
        {header}
      </div>

      {/* ── Content Zone ── */}
      <div className="flex flex-1 flex-col items-center justify-center">
        {children}
      </div>

      {/* ── Controls Zone ── */}
      <div className="flex h-zone-controls flex-col items-center justify-center gap-3.5">
        {controls}
      </div>

      {/* ── Overlays (absolute) ── */}
      {overlays}
    </div>
  );
}
