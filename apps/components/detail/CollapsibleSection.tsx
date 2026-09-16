"use client";

import { useState, type ReactNode } from "react";

export function CollapsibleSection({
  title,
  right,
  defaultOpen = true,
  children,
}: {
  title: string;
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
          <svg
            viewBox="0 0 8 8"
            className={`h-2 w-2 shrink-0 text-slate-400 transition-transform dark:text-slate-500 ${open ? "rotate-90" : ""}`}
            fill="currentColor"
          >
            <path d="M1 0l6 4-6 4z" />
          </svg>
          {title}
        </span>
        {right}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
