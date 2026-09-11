import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export interface LogoProps {
  className?: string;
  withWordmark?: boolean;
}

export function Logo({ className, withWordmark = true }: LogoProps) {
  return (
    <Link
      to="/"
      className={cn("group inline-flex items-center gap-2.5", className)}
      aria-label="SENTINEL home"
    >
      <span className="relative flex size-9 items-center justify-center rounded-xl bg-gradient-primary shadow-soft">
        <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
          <path
            d="M12 3.2 5.6 5.7v5.6c0 4 2.7 7.6 6.4 8.9 3.7-1.3 6.4-4.9 6.4-8.9V5.7L12 3.2Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            className="text-primary-foreground"
          />
          <path
            d="M9 12.4l2 2 4-4.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary-foreground"
          />
        </svg>
      </span>
      {withWordmark ? (
        <span className="flex flex-col leading-none">
          <span className="text-sm font-bold tracking-[0.18em] text-foreground">SENTINEL</span>
          <span className="mt-0.5 text-[10px] font-medium tracking-tight text-muted-foreground">
            Wellbeing companion
          </span>
        </span>
      ) : null}
    </Link>
  );
}
