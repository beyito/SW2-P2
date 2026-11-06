import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const remote = (name, variable, fallback) => ({
    type: 'module',
    name,
    entry: `${env[variable] || fallback}/remoteEntry.js`,
  });

  return {
    plugins: [
      federation({
        name: 'shell',
        remotes: {
          mfe_estudio: remote('mfe_estudio', 'VITE_MFE_ESTUDIO_URL', 'http://localhost:3001'),
          mfe_reservas: remote('mfe_reservas', 'VITE_MFE_RESERVAS_URL', 'http://localhost:3002'),
          mfe_gestion: remote('mfe_gestion', 'VITE_MFE_GESTION_URL', 'http://localhost:3003'),
        },
        shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
        dts: false,
      }),
      react(),
    ],
    server: { port: 3000, strictPort: true, open: false, host: true },
    preview: { port: 3000, strictPort: true },
    build: { target: 'esnext' },
  };
});
