import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink hover:opacity-90 border border-transparent disabled:opacity-50",
  secondary:
    "bg-surface text-ink border border-line-strong hover:bg-surface-muted disabled:opacity-50",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-muted border border-transparent",
  danger: "bg-transparent text-red-600 dark:text-red-400 border border-line hover:bg-red-500/5",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-corpo rounded-sm gap-1.5",
  md: "h-10 px-4 text-sm rounded-md gap-2",
  lg: "h-12 px-5 text-corpo-forte rounded-md gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center justify-center font-medium transition-colors select-none",
        "focus-visible:outline-2 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
