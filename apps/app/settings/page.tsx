import { StubPageShell } from "@/components/StubPageShell";

export default function SettingsPage() {
  return (
    <StubPageShell title="Settings">
      <div className="rounded border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This is a proof of concept — there&apos;s no real account or org configuration to manage yet. The one
          setting that does persist is the light/dark theme toggle in the sidebar.
        </p>
      </div>
    </StubPageShell>
  );
}
