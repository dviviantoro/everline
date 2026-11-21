/** The Device / Live / Surveys tabs. Shown on those three screens only (`mobile-ui-spec.md` section 2). */
import { Link, useLocation } from 'react-router';

import { useServices } from '../app/services';
import { ListIcon, PulseIcon, WifiIcon } from './icons';

const TABS = [
  { to: '/device', label: 'Device', icon: <WifiIcon size={24} /> },
  { to: '/live', label: 'Live', icon: <PulseIcon size={24} /> },
  { to: '/surveys', label: 'Surveys', icon: <ListIcon size={24} /> },
] as const;

export function BottomNav() {
  const { pathname } = useLocation();
  const { config } = useServices();
  // A build without the survey server has no Surveys list, so it has two tabs.
  const tabs = config.surveysNote != null ? TABS.filter((tab) => tab.to !== '/surveys') : TABS;
  return (
    <nav className="tabs" aria-label="Main" style={{ gridTemplateColumns: `repeat(${String(tabs.length)}, minmax(0, 1fr))` }}>
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className="tab" aria-current={pathname === tab.to ? 'page' : undefined}>
          {tab.icon}
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
