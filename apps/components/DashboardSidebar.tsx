"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Map, Table2, FileBarChart, Settings, User, LogOut, Sun, Moon, ChevronLeft, Plus, type LucideIcon } from "lucide-react";
import { SEVERITY_DOT } from "@/components/detail/SeverityBadge";
import { BrandMark } from "@/components/BrandMark";
import type { Theme } from "@/lib/useTheme";

const NAV_ICONS: Record<string, LucideIcon> = {
  map: Map,
  registry: Table2,
  reports: FileBarChart,
  settings: Settings,
  profile: User,
  logout: LogOut,
};

const STORAGE_KEY = "everline-sidebar-collapsed";

interface Layers {
  showTransformers: boolean;
  showLines: boolean;
  showPoles: boolean;
  showMeasurementPoints: boolean;
}

export function DashboardSidebar({
  layers,
  onLayersChange,
  onAddAsset,
  theme,
  onThemeChange,
}: {
  layers: Layers;
  onLayersChange: (next: Layers) => void;
  onAddAsset: () => void;
  theme: Theme;
  onThemeChange: (t: Theme) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    // Reads a browser-only API unavailable during SSR, so this can't be a
    // lazy useState initializer (that would crash the server render) — it
    // has to be an effect, which is exactly this rule's own "subscribe to
    // an external system" exception.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable — keep default (expanded)
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore — per-viewer convenience only
      }
      return next;
    });
  }

  return (
    <aside
      className={`flex h-full flex-col border-r border-slate-200 bg-white transition-[width] duration-200 dark:border-slate-800 dark:bg-slate-900 ${
        collapsed ? "w-14" : "w-56"
      }`}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-3 dark:border-slate-800">
        <Link href="/" className="flex items-center gap-2 overflow-hidden">
          <BrandMark className="h-7 w-7" />
          {!collapsed && (
            <span className="font-display text-base font-bold tracking-tight text-slate-800 dark:text-slate-100">
              EverLine
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <SidebarSection title="Navigate" collapsed={collapsed}>
          <SidebarLink href="/dashboard" icon="map" label="Map" active={pathname === "/dashboard"} collapsed={collapsed} />
          <SidebarLink href="/registry" icon="registry" label="Asset Registry" active={pathname === "/registry"} collapsed={collapsed} />
          <SidebarLink href="/reports" icon="reports" label="Reports" active={pathname === "/reports"} collapsed={collapsed} />
        </SidebarSection>

        <SidebarSection title="Layers" collapsed={collapsed}>
          <LayerCheckbox
            collapsed={collapsed}
            label="Transformers"
            shape="circle"
            color="#64748b"
            checked={layers.showTransformers}
            onChange={(v) => onLayersChange({ ...layers, showTransformers: v })}
          />
          <LayerCheckbox
            collapsed={collapsed}
            label="Lines"
            shape="line"
            color="#64748b"
            checked={layers.showLines}
            onChange={(v) => onLayersChange({ ...layers, showLines: v })}
          />
          <LayerCheckbox
            collapsed={collapsed}
            label="Poles"
            shape="diamond"
            color="#94a3b8"
            checked={layers.showPoles}
            onChange={(v) => onLayersChange({ ...layers, showPoles: v })}
          />
          <LayerCheckbox
            collapsed={collapsed}
            label="PD Measurement"
            shape="square"
            color="#64748b"
            checked={layers.showMeasurementPoints}
            onChange={(v) => onLayersChange({ ...layers, showMeasurementPoints: v })}
          />
        </SidebarSection>

        <SidebarSection title="Legend" collapsed={collapsed}>
          {!collapsed && (
            <div className="space-y-1.5 px-2 py-1 text-xs text-slate-500 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_DOT.good }} />
                Good / Normal
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_DOT.warning }} />
                Warning
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_DOT.critical }} />
                Critical
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: SEVERITY_DOT.none }} />
                No data yet
              </div>
            </div>
          )}
        </SidebarSection>

        <div className="mt-3 px-2">
          <button
            onClick={onAddAsset}
            title="Add Asset"
            className="flex w-full items-center justify-center gap-2 rounded bg-slate-800 px-2 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 dark:bg-amber-500 dark:text-slate-950 dark:hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {!collapsed && "Add Asset"}
          </button>
        </div>

        <SidebarSection title="Account" collapsed={collapsed}>
          <SidebarLink href="/settings" icon="settings" label="Settings" active={pathname === "/settings"} collapsed={collapsed} />
          <SidebarLink href="/profile" icon="profile" label="Profile" active={pathname === "/profile"} collapsed={collapsed} />
          <button
            onClick={() => router.push("/login")}
            title="Logout"
            className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed && "Logout"}
          </button>
        </SidebarSection>
      </nav>

      <div className="border-t border-slate-200 px-2 py-2 dark:border-slate-800">
        <button
          onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}
          title="Toggle theme"
          className="flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          {theme === "dark" ? <Sun className="h-4 w-4 shrink-0" aria-hidden /> : <Moon className="h-4 w-4 shrink-0" aria-hidden />}
          {!collapsed && (theme === "dark" ? "Light mode" : "Dark mode")}
        </button>
      </div>

      <button
        onClick={toggleCollapsed}
        className="flex items-center justify-center gap-1.5 border-t border-slate-200 px-3 py-2.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <ChevronLeft className={`h-3.5 w-3.5 transition-transform ${collapsed ? "rotate-180" : ""}`} aria-hidden />
        {!collapsed && "Collapse"}
      </button>
    </aside>
  );
}

function SidebarSection({ title, collapsed, children }: { title: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      {!collapsed && (
        <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {title}
        </p>
      )}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function SidebarLink({
  href,
  icon,
  label,
  active,
  collapsed,
}: {
  href: string;
  icon: string;
  label: string;
  active?: boolean;
  collapsed: boolean;
}) {
  const Icon = NAV_ICONS[icon];
  return (
    <Link
      href={href}
      title={label}
      className={`flex items-center gap-2.5 rounded px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-50"
          : "text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden />
      {!collapsed && label}
    </Link>
  );
}

function LayerCheckbox({
  label,
  shape,
  color,
  checked,
  onChange,
  collapsed,
}: {
  label: string;
  shape: "circle" | "diamond" | "line" | "square";
  color: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  collapsed: boolean;
}) {
  return (
    <label
      title={label}
      className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800"
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <ShapeGlyph shape={shape} color={color} dimmed={!checked} />
      {!collapsed && <span className={checked ? "" : "text-slate-400 dark:text-slate-500"}>{label}</span>}
    </label>
  );
}

function ShapeGlyph({
  shape,
  color,
  dimmed,
}: {
  shape: "circle" | "diamond" | "line" | "square";
  color: string;
  dimmed?: boolean;
}) {
  const style = { opacity: dimmed ? 0.35 : 1 };
  if (shape === "circle") {
    return <span className="inline-block h-3 w-3 shrink-0 rounded-full border border-slate-500" style={{ background: color, ...style }} />;
  }
  if (shape === "diamond") {
    return <span className="inline-block h-2.5 w-2.5 shrink-0 rotate-45 border border-slate-500" style={{ background: color, ...style }} />;
  }
  if (shape === "line") {
    return <span className="inline-block h-0.5 w-3.5 shrink-0" style={{ background: color, ...style }} />;
  }
  return <span className="inline-block h-2.5 w-2.5 shrink-0 border border-slate-500" style={{ background: color, ...style }} />;
}
