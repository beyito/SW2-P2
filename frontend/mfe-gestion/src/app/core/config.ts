/** Direcciones de los servicios en el entorno local. */
export const CONFIG = {
  shellOrigin: 'http://localhost:3000',
  gestionUrl: 'http://localhost:8081/graphql',
  crmUrl: 'http://localhost:8083/graphql',
  asesoriaUrl: 'http://localhost:3100',
  mcpUrl: 'http://localhost:4000/mcp',
};

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
