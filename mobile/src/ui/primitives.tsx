/** Small shared components. Visual rules are in `styles/app.css` and `mobile-design-system.md`. */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import { useServices } from '../app/services';
import { useTheme } from '../app/theme';
import { otherTheme, themeToggleLabel } from '../core/theme';
import { ChevronLeftIcon, MoonIcon, SunIcon } from './icons';

export function BrandMark({ size = 26 }: { size?: number }) {
  return <span className="brand-mark" aria-hidden="true" style={{ width: size, height: size }} />;
}

export function Brand() {
  return (
    <div className="topbar-start">
      <BrandMark />
      <span className="brand-word">EverLine</span>
    </div>
  );
}

export function ThemeToggle() {
  const { mode, toggle } = useTheme();
  return (
    <button type="button" className="icon-btn" aria-label={themeToggleLabel(mode)} onClick={toggle}>
      {otherTheme(mode) === 'light' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

/** A link back with a chevron ("‹ Live"). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="back-link">
      <ChevronLeftIcon size={18} />
      {label}
    </Link>
  );
}

/** A back control that goes one step back in history, or to `fallback` when there is none. */
export function BackButton({ label, fallback }: { label: string; fallback: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      className="back-link"
      onClick={() => {
        if (window.history.length > 1) void navigate(-1);
        else void navigate(fallback, { replace: true });
      }}
    >
      <ChevronLeftIcon size={18} />
      {label}
    </button>
  );
}

/** The top bar every screen has: something on the left, the environment chip, the theme toggle. */
export function TopBar({ start, showBadge = true }: { start?: ReactNode; showBadge?: boolean }) {
  const { config } = useServices();
  return (
    <div className="topbar">
      {start ?? <Brand />}
      <div className="topbar-mid">
        {showBadge && config.badge ? <span className="env-chip">{config.badge}</span> : null}
      </div>
      <ThemeToggle />
    </div>
  );
}

export type PillTone = 'ok' | 'warn' | 'crit';

export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      <span className="dot" aria-hidden="true" />
      {children}
    </span>
  );
}

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="switch-track">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

/** "1 Hotspot / 2 Cantol / 3 GPS" progress strip of the setup wizard. */
export function StepStrip({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['Hotspot', 'Cantol', 'GPS'];
  return (
    <div className="steps" role="list" aria-label="Setup progress">
      {steps.map((name, index) => {
        const number = index + 1;
        const state = number < current ? 'step-done' : number === current ? 'step-now' : '';
        return (
          <div key={name} className={state} role="listitem" aria-current={number === current ? 'step' : undefined}>
            <div className="step-bar" />
            <div className="step-label">
              {number} {name}
            </div>
          </div>
        );
      })}
    </div>
  );
}
