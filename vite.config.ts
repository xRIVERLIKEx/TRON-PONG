
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
// Fix: Import process from node:process to provide correct Node.js types in the Vite config
import process from 'node:process';

export default defineConfig(({ mode }) => {
  // Fix: Explicitly use process.cwd() from the imported Node.js process module
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    base: './', // Ensures relative paths for GitHub Pages subfolders
    define: {
      // Shims process.env for the Gemini SDK in a browser environment
      'process.env.API_KEY': JSON.stringify(env.VITE_API_KEY || env.API_KEY)
    },
    build: {
      outDir: 'dist',
    }
  };
});
