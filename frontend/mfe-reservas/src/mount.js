import { createApp } from 'vue';
import Root from './Root.vue';
import { setPlatform } from './auth';
import css from './style.css?inline';

/** Contrato con el Shell: dibuja el microfrontend en el elemento y devuelve cómo retirarlo. */
export function mount(element, context) {
  setPlatform(context);
  element.classList.add('mfe-reservas');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const app = createApp(Root);
  app.mount(element);
  return () => {
    app.unmount();
    style.remove();
    element.classList.remove('mfe-reservas');
  };
}
