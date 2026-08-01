"use client";

import { ReactNode, useEffect } from "react";
import { X } from "lucide-react";

export function Button({
  children,
  variant = "primary",
  type = "button",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "accent";
}) {
  const styles = {
    primary:
      "bg-[var(--brand)] text-[var(--c-stone-50)] shadow-sm hover:bg-[var(--brand-hover)]",
    secondary:
      "border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)] shadow-xs hover:border-[var(--c-blue-400)]",
    danger:
      "bg-[var(--c-clay-700)] text-white shadow-sm hover:bg-[var(--c-clay-500)]",
    ghost: "text-[var(--c-stone-600)] hover:bg-[var(--c-stone-100)] hover:text-[var(--foreground)]",
    accent:
      "bg-[var(--accent)] text-[var(--c-blue-950)] shadow-sm hover:bg-[var(--c-gold-600)] hover:text-white",
  };
  return (
    <button
      type={type}
      className={`inline-flex cursor-pointer items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium tracking-wide transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-blue-400)]/40 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Input({
  label,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--c-stone-600)]">
          {label}
        </span>
      )}
      <input
        className={`w-full rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-3.5 py-2.5 text-sm shadow-xs transition-all placeholder:text-[var(--muted)] focus:border-[var(--c-blue-400)] focus:outline-none focus:ring-4 focus:ring-[var(--c-blue-400)]/15 ${className}`}
        {...props}
      />
    </label>
  );
}

export function Select({
  label,
  children,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label?: string }) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-[var(--c-stone-600)]">
          {label}
        </span>
      )}
      <select
        className={`w-full cursor-pointer rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-3.5 py-2.5 text-sm shadow-xs transition-all focus:border-[var(--c-blue-400)] focus:outline-none focus:ring-4 focus:ring-[var(--c-blue-400)]/15 ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`glass-card rounded-[var(--radius-lg)] p-6 ${className}`}>{children}</div>
  );
}

export function Alert({
  type = "error",
  children,
}: {
  type?: "error" | "success" | "info";
  children: ReactNode;
}) {
  const styles = {
    error: "border-[var(--c-clay-100)] bg-[var(--c-clay-100)] text-[var(--c-clay-700)]",
    success: "border-[var(--c-sage-100)] bg-[var(--c-sage-100)] text-[var(--c-sage-700)]",
    info: "border-[var(--c-blue-100)] bg-[var(--c-blue-50)] text-[var(--c-blue-800)]",
  };
  return (
    <div
      className={`rounded-md border px-4 py-3.5 text-sm shadow-[var(--shadow-xs)] ${styles[type]}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[var(--text-accent)]">
          MEGA SN SARL
        </p>
        <h1 className="font-display mt-1.5 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-[2rem]">
          {title}
        </h1>
        {description && (
          <p className="font-body mt-2 max-w-2xl text-sm leading-relaxed text-[var(--c-stone-600)]">
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

const statVariants = {
  default: {
    card: "border-[var(--border)] bg-[var(--card)]",
    accent: "bg-[var(--c-stone-100)] text-[var(--c-stone-600)]",
    value: "text-[var(--foreground)]",
  },
  positive: {
    card: "border-[var(--border)] bg-[var(--card)]",
    accent: "bg-[var(--c-sage-100)] text-[var(--c-sage-700)]",
    value: "text-[var(--c-sage-700)]",
  },
  negative: {
    card: "border-[var(--border)] bg-[var(--card)]",
    accent: "bg-[var(--c-clay-100)] text-[var(--c-clay-700)]",
    value: "text-[var(--c-clay-700)]",
  },
  warning: {
    card: "border-[var(--border)] bg-[var(--card)]",
    accent: "bg-[var(--c-amber-100)] text-[var(--c-amber-700)]",
    value: "text-[var(--c-amber-700)]",
  },
  inverse: {
    card: "border-transparent bg-[var(--c-blue-950)] text-[var(--c-stone-50)]",
    accent: "bg-[rgba(210,179,108,0.16)] text-[var(--c-gold-300)]",
    value: "text-[var(--c-stone-50)]",
  },
};

export function StatCard({
  label,
  value,
  hint,
  variant = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  variant?: "default" | "positive" | "negative" | "warning" | "inverse";
}) {
  const v = statVariants[variant];

  return (
    <div
      className={`rounded-[var(--radius-lg)] border p-6 shadow-[var(--shadow-xs)] transition-shadow hover:shadow-[var(--shadow-sm)] ${v.card}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={`text-[11px] font-medium uppercase tracking-[0.12em] ${
            variant === "inverse" ? "text-[var(--c-blue-200)]" : "text-[var(--muted)]"
          }`}
        >
          {label}
        </p>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${v.accent}`}
        >
          FCFA
        </span>
      </div>
      <p className={`mt-3 text-2xl font-semibold tracking-tight tabular-nums ${v.value}`}>
        {value}
      </p>
      {hint && (
        <p
          className={`mt-2.5 text-xs ${
            variant === "inverse" ? "text-[var(--c-blue-300)]" : "text-[var(--muted)]"
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300/80 bg-white/60 p-12 text-center">
      <p className="text-lg font-semibold text-slate-700">{title}</p>
      <p className="mt-2 text-sm text-slate-500">{description}</p>
    </div>
  );
}

export function DataTable({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-x-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm ${className}`}>
      <table className="data-table w-full text-sm">{children}</table>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizes = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-4xl",
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Fermer"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`relative flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/20 ${sizes[size]}`}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white px-6 py-5">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-slate-500">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Fermer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <div className="shrink-0 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function FormActions({
  onCancel,
  submitLabel = "Enregistrer",
  cancelLabel = "Annuler",
  loading = false,
  formId,
}: {
  onCancel: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  formId?: string;
}) {
  return (
    <div className="flex justify-end gap-3">
      <Button type="button" variant="secondary" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" form={formId} disabled={loading}>
        {loading ? "Enregistrement…" : submitLabel}
      </Button>
    </div>
  );
}

export function Fab({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-full bg-[var(--accent)] px-5 py-3.5 text-sm font-medium text-[var(--c-blue-950)] shadow-[var(--shadow-md)] transition-all hover:scale-105 hover:bg-[var(--c-gold-600)] hover:text-white lg:hidden"
      aria-label={label}
    >
      <span className="text-lg leading-none">+</span>
      {label}
    </button>
  );
}

export function StickyToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky top-0 z-30 -mx-1 mb-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)]/95 px-4 py-3 shadow-[var(--shadow-xs)] backdrop-blur-md">
      {children}
    </div>
  );
}
