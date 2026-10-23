import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import PocketFoleyStudio from './components/PocketFoleyStudio';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <PocketFoleyStudio />
  </StrictMode>,
);

// Offline support for the installed app. Dev builds skip it so edits always show up.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // No offline mode (e.g. plain http on a LAN address) — the app still works online.
    });
  });
}
