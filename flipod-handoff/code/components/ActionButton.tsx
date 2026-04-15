/**
 * ActionButton — Full-width action button used across Practice screens.
 *
 * Variants:
 *   primary    filled accent color, white text
 *   secondary  transparent with subtle border, muted text
 *   success    green fill
 *   danger     red fill
 */

import { ReactNode } from "react";

type Variant = "primary" | "secondary" | "success" | "danger";

interface ActionButtonProps {
  children: ReactNode;
  variant?: Variant;
  onClick?: () => void;
  className?: string;
}

const styles: Record<Variant, string> = {
  primary:
    "bg-accent-practice text-text-1",
  secondary:
    "bg-transparent border border-stroke-subtle text-text-2",
  success:
    "bg-accent-success/20 text-accent-success",
  danger:
    "bg-accent-error/20 text-accent-error",
};

export function ActionButton({
  children,
  variant = "primary",
  onClick,
  className = "",
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-md py-3 text-center text-body font-medium ${styles[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
