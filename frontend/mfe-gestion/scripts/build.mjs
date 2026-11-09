// Compila el ERP. Las direcciones de los servicios se leen de las mismas variables VITE_* que usan
// los demás microfrontends; las que falten quedan en localhost (ver src/app/core/config.ts).
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VARIABLES = {
  gestionUrl: 'VITE_GESTION_URL',
  crmUrl: 'VITE_CRM_URL',
  asesoriaUrl: 'VITE_ASESORIA_URL',
  mcpUrl: 'VITE_MCP_URL',
  iaUrl: 'VITE_IA_URL',
  sagaUrl: 'VITE_SAGA_URL',
  crmBaseUrl: 'VITE_CRM_BASE_URL',
  biUrl: 'VITE_BI_URL',
};

const urls = Object.fromEntries(
  Object.entries(VARIABLES)
    .filter(([, variable]) => process.env[variable])
    .map(([key, variable]) => [key, process.env[variable]]),
);
const args = ['build'];
if (Object.keys(urls).length > 0) args.push('--define', `SALON_URLS=${JSON.stringify(urls)}`);

// Se ejecuta la CLI de Angular sin intérprete de comandos, para no alterar las comillas del JSON
const ng = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));
const result = spawnSync(process.execPath, [ng, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
