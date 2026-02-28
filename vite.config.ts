import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  root: 'app',
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist-app',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SG Mahjong',
        short_name: 'SG Mahjong',
        description: 'Singapore-style Mahjong game',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1a5c2a',
        background_color: '#1a5c2a',
        icons: [
          {
            src: '/assets/icons/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
          },
          {
            src: '/assets/icons/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
    }),
  ],
});
