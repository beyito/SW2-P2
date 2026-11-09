/** Direcciones de la nube, fijadas al compilar con --define (scripts/build.mjs). */
declare const SALON_URLS: Partial<typeof LOCAL_URLS> | undefined;

/** Direcciones de los servicios en el entorno local. */
const LOCAL_URLS = {
  gestionUrl: 'http://localhost:8081/graphql',
  crmUrl: 'http://localhost:8083/graphql',
  asesoriaUrl: 'http://localhost:3100',
  mcpUrl: 'http://localhost:4000/mcp',
  iaUrl: 'http://localhost:8002/api/v1',
  sagaUrl: 'http://localhost:4100',
  crmBaseUrl: 'http://localhost:8083',
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
