import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    federation({
      name: 'mfe_estudio',
      filename: 'remoteEntry.js',
      exposes: { './mount': './src/mount.jsx' },
      // React es una sola instancia, compartida con el Shell
      shared: { react: { singleton: true }, 'react-dom': { singleton: true } },
      dts: false,
    }),
    react(),
  ],
  server: { port: 3001, strictPort: true, host: true, origin: 'http://localhost:3001' },
  preview: { port: 3001, strictPort: true, cors: true },
  build: { target: 'esnext' },
});
