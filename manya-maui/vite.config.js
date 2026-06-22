import { defineConfig } from 'vite';
import react      from '@vitejs/plugin-react';
import tailwind   from '@tailwindcss/vite';
import legacy     from '@vitejs/plugin-legacy';
import path       from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Absolute paths
const MAUI_SRC    = path.resolve(__dirname, 'src');
const SHARED_SRC  = path.resolve(__dirname, '../manya-react/src');

export default defineConfig({
  // ── Entry ─────────────────────────────────────────────────────────────────
  // index.html lives here in manya-maui/, entry script is src/main.jsx (MAUI)
  root: __dirname,

  // ── CRITICAL: Relative base so all assets load via file:// in MAUI WebView ─
  base: './',

  plugins: [
    react(),
    tailwind(),

    // Legacy build — no ES modules, no crossorigin → works in MAUI WebView
    legacy({
      renderModernChunks: false,
      targets: ['defaults', 'not IE 11'],
    }),

    // No PWA plugin — MAUI WebView doesn't use service workers
  ],

  resolve: {
    alias: [
      // ── MAUI OVERRIDES (checked FIRST — order matters) ──────────────────
      // These files replace the web versions for the MAUI build.

      // 1. Boot entry — MAUI main.jsx calls runMigrations() before render
      {
        find: /^@\/main$/,
        replacement: path.resolve(MAUI_SRC, 'main.jsx'),
      },

      // 2. storageFacade — Android paths use manyaBridge.js (new API)
      {
        find: /.*\/backend\/storage\/storageFacade(\.js)?$/,
        replacement: path.resolve(MAUI_SRC, 'overrides/storageFacade.js'),
      },

      // 3. manyaDB — uses bridge instead of IndexedDB
      {
        find: /.*\/backend\/db\/manyaDB(\.js)?$/,
        replacement: path.resolve(MAUI_SRC, 'overrides/manyaDB.js'),
      },

      // ── SHARED CODE (all other imports resolve to manya-react/src) ───────
      // @/ points to manya-react's src so the MAUI entry can import App.jsx,
      // components, views, engines etc. without duplicating them.
      {
        find: '@',
        replacement: SHARED_SRC,
      },
    ],
  },

  build: {
    // Output goes here — copy this folder to C# MAUI Resources/Raw/wwwroot/
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',

    rollupOptions: {
      // Use manya-maui's own index.html as entry
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks(id) {
          if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) return 'react-core';
          if (id.includes('framer-motion')) return 'framer';
          if (id.includes('@supabase'))     return 'supabase';
          if (id.includes('lucide-react'))  return 'icons';
          if (id.includes('d3') || id.includes('topojson')) return 'd3';
          if (id.includes('node_modules'))  return 'vendor';
        },
      },
    },
  },

  // Dev server for testing MAUI build in browser
  server: {
    port: 5174,
    open: false,
  },
});
