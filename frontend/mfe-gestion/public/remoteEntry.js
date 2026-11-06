/**
 * Contenedor de Module Federation del ERP. Angular se compila con su propio empaquetador, sin el plugin de Vite,
 * así que este archivo implementa a mano la interfaz estándar de un remoto: init() y get().
 * Angular no se comparte con ningún otro microfrontend, por eso init() no tiene nada que negociar.
 */
const BASE = new URL('./', import.meta.url);

export function init() {}

export async function get(moduleName) {
  if (moduleName !== './mount') throw new Error(`El ERP no expone ${moduleName}`);
  const { mount } = await import(new URL('main.js', BASE).href);
  return () => ({
    async mount(element, context) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('styles.css', BASE).href;
      document.head.append(link);
      const unmount = await mount(element, context);
      return () => {
        unmount();
        link.remove();
      };
    },
  });
}
