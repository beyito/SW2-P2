/** Direcciones de la nube, fijadas al compilar con --define (scripts/build.mjs). */
declare const SALON_URLS: Partial<typeof LOCAL_URLS> | undefined;

/** Direcciones de los servicios en el entorno local. */
const LOCAL_URLS = {
  // El ERP habla solo GraphQL: con gestión (que también es la puerta hacia los demás servicios) y con el CRM
  gestionUrl: 'http://localhost:8081/graphql',
  crmUrl: 'http://localhost:8083/graphql',
  // Solo para mostrar las imágenes de la comunidad, que la asesoría sirve como archivos públicos
  asesoriaUrl: 'http://localhost:3100',
  // Tablero de inteligencia de negocios en Python (Streamlit)
  biUrl: 'http://localhost:8501',
};

export const CONFIG = { ...LOCAL_URLS, ...(typeof SALON_URLS !== 'undefined' ? SALON_URLS : {}) };

/** Fecha local en formato AAAA-MM-DD. */
export function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
}

/** Mensaje presentable de un error desconocido. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Ocurrió un error inesperado.';
}
