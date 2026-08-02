import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "default" | "solid" | "outline";

const tones: Record<Tone, string> = {
  default: "bg-surface-muted text-ink-muted border border-line",
  solid: "bg-accent text-accent-ink border border-transparent",
  outline: "bg-transparent text-ink-muted border border-line-strong",
};

/** Pill badge (non-interactive). */
export function Badge({
  className,
  tone = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-legenda font-medium leading-none",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Interactive pill (filter chips, day-mode selector). */
export function PillButton({
  className,
  active = false,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-corpo font-medium leading-none transition-colors",
        "focus-visible:outline-2",
        active
          ? "bg-accent text-accent-ink border border-transparent"
          : "bg-transparent text-ink-muted border border-line-strong hover:bg-surface-muted hover:text-ink",
        className,
      )}
      {...props}
    />
  );
}
