import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Configuración aparte: las pruebas no necesitan Module Federation
export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, css: true },
});
