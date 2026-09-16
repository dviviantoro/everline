"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [shake, setShake] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      return;
    }
    setStatus("loading");
    // POC has no auth backend (planning/PROJECT_BRIEF.md §4) — this is a UI
    // gate only, not a real credential check. See the note below the form.
    setTimeout(() => router.push("/dashboard"), 700);
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 grid-backdrop [mask-image:radial-gradient(ellipse_70%_70%_at_30%_30%,black,transparent)]" />
        <Link href="/" className="relative z-10 flex items-center gap-2.5">
          <BrandMark className="h-8 w-8" />
          <span className="font-display text-xl font-bold tracking-tight text-paper">EverLine</span>
        </Link>

        <div className="relative z-10 max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-cyan">Field Survey Network</p>
          <h1 className="mt-4 font-display text-5xl font-black uppercase leading-[0.95] tracking-tight text-paper">
            Every reading, <span className="text-amber">on record.</span>
          </h1>
          <p className="mt-5 text-fog">
            Sign in to review network condition, or log a field survey the moment you finish a patrol.
          </p>
        </div>

        <p className="relative z-10 font-mono text-xs text-fog">20kV &middot; Central Java &middot; PLN</p>
      </div>

      {/* Form panel */}
      <div className="flex min-h-screen items-center justify-center bg-panel px-6 py-16">
        <div className={`w-full max-w-sm ${shake ? "animate-[shake_0.4s]" : ""}`}>
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-amber text-ink font-display text-lg font-black">
              E
            </span>
            <span className="font-display text-xl font-bold tracking-tight text-paper">EverLine</span>
          </div>

          <h2 className="font-display text-3xl font-bold text-paper">Sign in</h2>
          <p className="mt-2 text-sm text-fog">Enter the dashboard to review the network.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-fog">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@pln.co.id"
                className="w-full rounded-md border border-line bg-panel-raised px-3.5 py-2.5 text-paper placeholder:text-fog/50 outline-none transition focus:border-amber focus:ring-1 focus:ring-amber"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-fog">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Your password"
                className="w-full rounded-md border border-line bg-panel-raised px-3.5 py-2.5 text-paper placeholder:text-fog/50 outline-none transition focus:border-amber focus:ring-1 focus:ring-amber"
              />
            </div>

            <button
              type="submit"
              disabled={status === "loading"}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-amber py-2.5 font-semibold text-ink transition hover:brightness-110 disabled:opacity-70"
            >
              {status === "loading" ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/30 border-t-ink" />
                  Signing in…
                </>
              ) : (
                "Sign in"
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-fog">
            Internal proof-of-concept — any email and password will do.{" "}
            <Link href="/dashboard" className="text-cyan hover:underline">
              Skip sign-in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
