import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Configuración aparte: las pruebas no necesitan Module Federation
export default defineConfig({
  plugins: [vue()],
  test: { environment: 'jsdom', globals: true, css: false },
});
