/**
 * FlashCard — Flippable vocabulary card (Step 3).
 *
 * Front: audio icon + English sentence + CEFR tag + counter
 * Back:  Chinese translation + separator + word + pronunciation + definition
 */

import { ReactNode } from "react";

interface FlashCardProps {
  children: ReactNode;
  onFlip?: () => void;
}

export function FlashCard({ children, onFlip }: FlashCardProps) {
  return (
    <button
      onClick={onFlip}
      className="flex w-full flex-1 flex-col items-center justify-center gap-5 rounded-xl bg-bg-surface-1 px-4 py-5"
    >
      {children}
    </button>
  );
}

/* ── Sub-components ── */

export function CefrTag({ word, level }: { word: string; level: string }) {
  return (
    <span className="rounded-sm bg-accent-gold/20 px-2.5 py-1 font-mono text-caption-sm font-semibold text-accent-gold">
      {word} {level}
    </span>
  );
}

export function WordDefinition({
  chinese,
  word,
  phonetic,
  definition,
}: {
  chinese: string;
  word: string;
  phonetic: string;
  definition: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-center text-title text-text-2">{chinese}</p>
      <div className="h-px w-[60px] bg-stroke-subtle" />
      <p className="text-lg font-semibold text-text-1">{word}</p>
      <p className="text-caption text-accent-gold">{phonetic}</p>
      <p className="text-center text-caption text-text-2 leading-relaxed">
        {definition}
      </p>
    </div>
  );
}
