import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const el = document.getElementById('ams-intake-chat');
if (el) {
  const root = createRoot(el);
  root.render(<App />);
}
