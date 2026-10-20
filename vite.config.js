import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hash-based routing means the built app works on any static host without rewrites.
export default defineConfig({
  plugins: [react()],
  base: './',
});
