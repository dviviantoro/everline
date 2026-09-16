import { StubPageShell } from "@/components/StubPageShell";

export default function ProfilePage() {
  return (
    <StubPageShell title="Profile">
      <div className="rounded border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          This POC has no real auth backend — the login screen is a UI-only gate, so there&apos;s no signed-in
          identity to show a profile for yet.
        </p>
      </div>
    </StubPageShell>
  );
}
