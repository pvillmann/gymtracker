import Link from "next/link";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold " +
  "transition-colors select-none disabled:opacity-50 disabled:pointer-events-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

const variants = {
  primary: "bg-accent text-ink hover:bg-accent-dim active:bg-accent-dim",
  secondary: "bg-surface-2 text-fg border border-line hover:border-faint",
  ghost: "text-muted hover:text-fg",
  danger: "bg-surface-2 text-down border border-line hover:border-down",
} as const;

const sizes = {
  sm: "h-9 px-3 text-sm",
  md: "h-12 px-5 text-[15px]",
  lg: "h-14 px-6 text-base",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export function buttonClass(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  extra?: string,
): string {
  return cx(buttonBase, variants[variant], sizes[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// Auf HTMLElement statt HTMLDivElement typisiert, damit dieselben Props
// für div/section/li/article passen.
type CardProps = HTMLAttributes<HTMLElement> & {
  as?: "div" | "section" | "li" | "article";
};

export function Card({ className, as: Tag = "div", ...props }: CardProps) {
  return (
    <Tag
      className={cx(
        "rounded-card border border-line-soft bg-surface p-4",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cx(
        // text-base (16px) verhindert den Auto-Zoom von iOS Safari.
        "h-12 w-full rounded-xl border border-line bg-surface-2 px-4 text-base",
        "text-fg placeholder:text-faint",
        "focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cx(
        "w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-base",
        "text-fg placeholder:text-faint focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cx(
        "h-12 w-full rounded-xl border border-line bg-surface-2 px-3 text-base",
        "text-fg focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export function ErrorMessage({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-xl border border-down/40 bg-down/10 px-4 py-3 text-sm text-down"
    >
      {children}
    </p>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold text-fg">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{description}</p>
      {action ? <div className="mt-5 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}
