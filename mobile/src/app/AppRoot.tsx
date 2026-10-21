/** Providers around the router. Everything environment-specific arrives through `services`. */
import { HashRouter } from 'react-router';

import { BackProvider } from './back';
import { AppRoutes } from './routes';
import { ServicesProvider, type Services } from './services';
import { SessionProvider } from './session';
import { ThemeProvider } from './theme';
import { WizardProvider } from './wizard';

export function AppRoot({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <ThemeProvider>
        <SessionProvider>
          <HashRouter>
            <BackProvider>
              <WizardProvider>
                <div className="app-root">
                  <AppRoutes />
                </div>
                {services.config.shellExtras}
              </WizardProvider>
            </BackProvider>
          </HashRouter>
        </SessionProvider>
      </ThemeProvider>
    </ServicesProvider>
  );
}
