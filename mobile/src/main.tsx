import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html is missing #root');

// `VITE_DEMO` is replaced with a constant at build time, so in a normal build this branch (and
// everything the demo imports) is removed from the bundle. The demo build is `npm run build:demo`.
if (import.meta.env.VITE_DEMO === '1') {
  void import('./demo/boot').then(({ bootDemo }) => bootDemo(container));
} else {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
