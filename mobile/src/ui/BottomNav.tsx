/** The Device / Live / Surveys tabs. Shown on those three screens only (`mobile-ui-spec.md` section 2). */
import { Link, useLocation } from 'react-router';

import { ListIcon, PulseIcon, WifiIcon } from './icons';

const TABS = [
  { to: '/device', label: 'Device', icon: <WifiIcon size={24} /> },
  { to: '/live', label: 'Live', icon: <PulseIcon size={24} /> },
  { to: '/surveys', label: 'Surveys', icon: <ListIcon size={24} /> },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  return (
    <nav className="tabs" aria-label="Main">
      {TABS.map((tab) => (
        <Link key={tab.to} to={tab.to} className="tab" aria-current={pathname === tab.to ? 'page' : undefined}>
          {tab.icon}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
