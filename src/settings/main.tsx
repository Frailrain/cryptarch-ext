import React from 'react';
import { createRoot } from 'react-dom/client';
import { ensureLoaded } from '@/adapters/storage';
import { Settings } from './Settings';
import './settings.css';

async function bootstrap() {
  // Hydrate the sync storage cache before rendering so Settings can call
  // getItem() synchronously from its first render.
  await ensureLoaded();
  const container = document.getElementById('root');
  if (!container) throw new Error('Root element missing');
  createRoot(container).render(
    <React.StrictMode>
      <Settings />
    </React.StrictMode>,
  );
}

void bootstrap();
