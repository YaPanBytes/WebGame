import { defineConfig } from 'vite';

export default defineConfig({
  // This tells Vite that your app is hosted at /WebGame/ (case-sensitive)
  // or use './' to make all paths relative to the current folder.
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  }
});
