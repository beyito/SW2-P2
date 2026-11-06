import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { setPlatform } from './auth';
import css from './style.css?inline';

/** Contrato con el Shell: dibuja el microfrontend en el elemento y devuelve cómo retirarlo. */
export function mount(element, context) {
  setPlatform(context);
  element.classList.add('mfe-estudio');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const root = createRoot(element);
  root.render(<App />);
  return () => {
    // React es compartido con el Shell: esto corre durante su render y debe esperar a que termine
    queueMicrotask(() => {
      root.unmount();
      style.remove();
      element.classList.remove('mfe-estudio');
    });
  };
}
