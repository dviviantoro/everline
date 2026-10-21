/** Providers around the router. Everything environment-specific arrives through `services`. */
import { HashRouter } from 'react-router';

import { AppRoutes } from './routes';
import { ServicesProvider, type Services } from './services';
import { SessionProvider } from './session';
import { ThemeProvider } from './theme';

export function AppRoot({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <ThemeProvider>
        <SessionProvider>
          <HashRouter>
            <div className="app-root">
              <AppRoutes />
            </div>
            {services.config.shellExtras}
          </HashRouter>
        </SessionProvider>
      </ThemeProvider>
    </ServicesProvider>
  );
}
