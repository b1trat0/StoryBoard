import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/index.css';

const container = document.getElementById('root');

if (container === null) {
  // index.html ships the element, so this can only fire if something rewrote the
  // document. Failing loudly beats a blank window with no explanation.
  throw new Error('Root element #root is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);