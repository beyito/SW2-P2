import { ApplicationRef } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { PlatformContext, setPlatform } from './app/core/platform';

/**
 * Contrato con el Shell: dibuja el ERP en el elemento y devuelve cómo retirarlo.
 * Lo expone public/remoteEntry.js, el contenedor de Module Federation de este microfrontend.
 */
export async function mount(element: HTMLElement, context: PlatformContext): Promise<() => void> {
  await setPlatform(context);
  element.classList.add('mfe-gestion');
  const host = document.createElement('app-root');
  element.append(host);
  const application: ApplicationRef = await createApplication();
  application.bootstrap(AppComponent, host);
  return () => {
    application.destroy();
    host.remove();
    element.classList.remove('mfe-gestion');
  };
}
