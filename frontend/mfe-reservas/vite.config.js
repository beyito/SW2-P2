import { federation } from '@module-federation/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    federation({
      name: 'mfe_reservas',
      filename: 'remoteEntry.js',
      exposes: { './mount': './src/mount.js' },
      dts: false,
    }),
    vue(),
  ],
  server: { port: 3002, strictPort: true, host: true, origin: 'http://localhost:3002' },
  preview: { port: 3002, strictPort: true, cors: true },
  build: { target: 'esnext' },
});
