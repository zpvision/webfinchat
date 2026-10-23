import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { retireLegacyWorker } from './retireLegacyWorker.js';
import './styles.css';

void retireLegacyWorker();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
