import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLoaded } from '@/adapters/storage';
import { Popup } from './Popup';
import './popup.css';

async function bootstrap() {
  // Hydrate the sync storage cache before rendering so Popup can call
  // getItem() synchronously from its first render — same pattern as Settings.
  await ensureLoaded();
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');
  createRoot(container).render(
    <React.StrictMode>
      <Popup />
    </React.StrictMode>,
  );
}

void bootstrap();
