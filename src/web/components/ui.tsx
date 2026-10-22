import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import type { Position } from "../../shared/model";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "a" | "b";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-ink hover:opacity-90 shadow-xs",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-surface-2 shadow-xs",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "bg-surface text-bad border border-line-strong hover:bg-bad-soft",
  a: "bg-a text-on-version hover:opacity-90 shadow-xs",
  b: "bg-b text-on-version hover:opacity-90 shadow-xs",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}

/** Button styling, also for links that look like buttons. */
export function buttonClass(
  variant: ButtonVariant = "secondary",
  size: "sm" | "md" | "lg" = "md",
): string {
  return cx(
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition",
    "disabled:cursor-not-allowed disabled:opacity-45",
    size === "sm" && "h-7 px-2.5 text-[12.5px]",
    size === "md" && "h-8.5 px-3.5 text-[13px]",
    size === "lg" && "h-10 px-5 text-sm",
    BUTTON_VARIANTS[variant],
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      className={cx(buttonClass(variant, size), className)}
      {...rest}
    >
      {loading ? <Spinner className="size-3.5" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "ok" | "bad" | "warn" | "info" | "a" | "b";

const TONES: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted border-line",
  ok: "bg-ok-soft text-ok border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  info: "bg-info-soft text-info border-transparent",
  a: "bg-a-soft text-a border-transparent",
  b: "bg-b-soft text-b border-transparent",
};

export function Badge({
  tone = "neutral",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={cx(
        "inline-flex h-5.5 items-center gap-1 whitespace-nowrap rounded-md border px-1.5 text-[11.5px] font-medium",
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

export function Dot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }): React.JSX.Element {
  const colour: Record<Tone, string> = {
    neutral: "bg-faint",
    ok: "bg-ok",
    bad: "bg-bad",
    warn: "bg-warn",
    info: "bg-info",
    a: "bg-a",
    b: "bg-b",
  };
  return (
    <span className="relative inline-flex size-2">
      {pulse && (
        <span
          className={cx("absolute inset-0 animate-ping rounded-full opacity-60", colour[tone])}
        />
      )}
      <span className={cx("relative inline-flex size-2 rounded-full", colour[tone])} />
    </span>
  );
}

/** The A / B mark used everywhere a version is named. */
export function VersionMark({
  position,
  size = "md",
}: {
  position: Position;
  size?: "sm" | "md" | "lg";
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-on-version",
        position === "a" ? "bg-a" : "bg-b",
        size === "sm" && "size-4.5 text-[10.5px]",
        size === "md" && "size-5.5 text-[12px]",
        size === "lg" && "size-7 text-[14px]",
      )}
    >
      {position.toUpperCase()}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className={cx("rounded-xl border border-line bg-surface shadow-xs", className)}>
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={cx("animate-spin", className ?? "size-4")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded border border-line-strong bg-surface px-1 font-sans text-[10.5px] font-medium text-muted">
      {children}
    </kbd>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon !== undefined && (
        <div className="mb-4 flex size-11 items-center justify-center rounded-xl border border-line bg-surface text-muted shadow-xs">
          {icon}
        </div>
      )}
      <h3 className="text-[15px] font-semibold tracking-tight">{title}</h3>
      {children !== undefined && (
        <div className="mt-1.5 max-w-sm text-[13px] text-muted">{children}</div>
      )}
      {action !== undefined && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div
      role="alert"
      className="rounded-lg border border-transparent bg-bad-soft px-3 py-2 text-[13px] text-bad"
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

const CONTROL =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-[13.5px] text-ink shadow-xs outline-none transition placeholder:text-faint focus:border-ring focus:ring-3 focus:ring-ring/15 disabled:opacity-60";

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
  optional = false,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor?: string;
  optional?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-faint">optional</span>}
      </label>
      {children}
      {hint !== undefined && error == null && <p className="text-[12px] text-muted">{hint}</p>}
      {error != null && <p className="text-[12px] text-bad">{error}</p>}
    </div>
  );
}

export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return <input className={cx(CONTROL, "h-9", className)} {...rest} />;
}

export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return <textarea className={cx(CONTROL, "py-2 leading-relaxed", className)} {...rest} />;
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select
      className={cx(CONTROL, "h-9 appearance-none bg-[length:16px] pr-8", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}): React.JSX.Element {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => {
          onChange(!checked);
        }}
        className={cx(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition",
          checked ? "bg-primary" : "bg-surface-3 ring-1 ring-line-strong ring-inset",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-4 rounded-full bg-surface shadow-xs transition",
            checked ? "left-4.5" : "left-0.5",
          )}
        />
      </button>
      <span className="flex flex-col">
        <span className="text-[13px] font-medium">{label}</span>
        {description !== undefined && <span className="text-[12px] text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  className,
}: {
  value: T;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className={cx(
        "inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          disabled={option.disabled}
          onClick={() => {
            onChange(option.value);
          }}
          className={cx(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition disabled:opacity-40",
            size === "sm" ? "h-6 px-2 text-[12px]" : "h-7 px-3 text-[12.5px]",
            option.value === value ? "bg-surface text-ink shadow-xs" : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}): React.JSX.Element | null {
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const focusable = panel.current?.querySelector<HTMLElement>(
      "textarea, input, select, button:not([data-dialog-close])",
    );
    focusable?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          "relative w-full rounded-2xl border border-line bg-surface shadow-pop",
          width,
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <h2 id={titleId} className="text-[16px] font-semibold tracking-tight">
              {title}
            </h2>
            {description !== undefined && (
              <div className="mt-1 text-[13px] text-muted">{description}</div>
            )}
          </div>
          <IconButton label="Close" data-dialog-close onClick={onClose} className="-mr-2 -mt-1">
            <X className="size-4" />
          </IconButton>
        </div>
        {children !== undefined && <div className="px-5 py-4">{children}</div>}
        {footer !== undefined && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
