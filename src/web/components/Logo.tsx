import { cx } from "./ui";

export function LogoMark({
  className,
  animated = false,
}: {
  className?: string;
  animated?: boolean;
}): React.JSX.Element {
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className ?? "size-6")} aria-hidden>
      <circle
        cx="12"
        cy="16"
        r="9"
        fill="var(--a)"
        className={animated ? "tf-orbit-a" : undefined}
      />
      <circle
        cx="20"
        cy="16"
        r="9"
        fill="var(--b)"
        fillOpacity="0.85"
        className={animated ? "tf-orbit-b" : undefined}
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark className="size-5.5" />
      <span className="text-[15px] font-semibold tracking-tight">Twofold</span>
    </span>
  );
}
