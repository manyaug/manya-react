import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg', 'assets/**/*'],
      manifest: {
        name: 'Manya Prep Hub',
        short_name: 'Manya',
        description: 'Elite PLE Prep for Uganda Primary Leaving Examinations',
        theme_color: '#7c3aed',
        background_color: '#FDFBF7',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: 'assets/icons/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'assets/icons/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'assets/icons/maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // ⚠️ CRITICAL: Exclude .mp3/.wav/.ogg from precache!
        // Audio files use HTTP Range requests (206 Partial Content) which
        // the Cache Storage API cannot handle. Including them causes the fatal
        // ERR_CACHE_OPERATION_NOT_SUPPORTED error loop.
        globPatterns: ['**/*.{js,css,html,ico,svg,webp}'],
        // Allow large image assets without failing the build
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // DiceBear avatars - Cache First (SVG content, safe to cache)
          {
            urlPattern: /^https:\/\/.*\.dicebear\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'dicebear-avatars',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // Audio files - Network Only with rangeRequests plugin
          // This correctly handles streaming Range requests without breaking
          {
            urlPattern: /\.(?:mp3|wav|ogg|m4a|flac)$/i,
            handler: 'NetworkOnly',
            options: {
              rangeRequests: true
            }
          },
          // Images (no audio) - Stale While Revalidate for speed
          {
            urlPattern: /assets\/.*\.(?:png|jpg|jpeg|svg|webp|gif)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-images-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 30
              },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          // Quest & engine JSON content - Stale While Revalidate
          {
            urlPattern: /content\/.*\.json$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'content-json-cache',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 7
              }
            }
          },
          // JS chunks - Stale While Revalidate (fast loads, silent background updates)
          {
            urlPattern: /\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'js-css-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 7
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            return 'vendor'
          }
        }
      }
    }
  }
})

