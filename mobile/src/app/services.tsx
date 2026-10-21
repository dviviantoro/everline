/**
 * The one place the screens get everything that lives outside the WebView. A build supplies a
 * `Services` value (demo: simulated sources; later: the Kotlin plugins and the HTTP API) and the
 * screens never know which.
 */
import { createContext, useContext, type ReactNode } from 'react';

import type { Dsp } from '../core/dsp';
import type { CantolLink, Gnss, HotspotAssistant, SurveyApi } from '../core/links';
import type { AppStore } from '../core/store';

export interface FooterLink {
  label: string;
  to: string;
}

export interface ExtraRoute {
  path: string;
  element: ReactNode;
}

/** Build-level switches. The product defaults are in `productConfig`. */
export interface AppConfig {
  /** A persistent chip on every screen after sign-in (the demo build says what the data is), or null. */
  badge: string | null;
  signIn: {
    /** A note under the sign-in button, or null. */
    note: string | null;
    /** When set, a "Skip sign-in" link signs in as this operator. */
    skipAs: string | null;
  };
  /** Length of the "Record" window in seconds. */
  recordSeconds(): number;
  /** Extra links under the Ready screen's primary action. */
  footerLinks: readonly FooterLink[];
  /** Extra routes inside the signed-in shell. */
  extraRoutes: readonly ExtraRoute[];
  /** The `pd_device` sent with every point: the seed's name for the Cantol mobile unit. */
  pdDevice: string;
  /** Elements rendered once inside the router (the demo build watches the route with one). */
  shellExtras: ReactNode;
}

export interface Services {
  config: AppConfig;
  dsp: Dsp;
  hotspot: HotspotAssistant;
  link: CantolLink;
  gnss: Gnss;
  api: SurveyApi;
  store: AppStore;
  /** The phone's clock in epoch milliseconds. */
  now: () => number;
}

/** `pd_device` used by `backend/scripts/seed.ts` for the Cantol mobile unit. */
export const PD_DEVICE = 'Cantol-Mobile V1';

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ services, children }: { services: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside ServicesProvider');
  return services;
}
