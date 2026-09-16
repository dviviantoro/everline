"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Sun, Moon } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { useTheme } from "@/lib/useTheme";

export function StubPageShell({ title, children }: { title: string; children: React.ReactNode }) {
  const [theme, setTheme] = useTheme();
  const router = useRouter();

  return (
    <div
      className={`${theme === "dark" ? "dark" : ""} min-h-screen bg-slate-50 font-body text-slate-800 dark:bg-slate-950 dark:text-slate-100`}
    >
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-4 w-4" /> Map
          </Link>
          <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
          <BrandMark className="h-6 w-6" />
          <h1 className="font-display text-base font-bold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            title="Toggle theme"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button
            onClick={() => router.push("/login")}
            title="Logout"
            className="rounded p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
