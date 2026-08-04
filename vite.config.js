import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    // Service Worker. Der einzige Zweck ist die Installierbarkeit plus
    // schnelleres Nachladen der Bundles -- NICHT Offline-Faehigkeit.
    //
    // PartyBox ist eine Live-Mehrspieler-App: eine gecachte Lobby, ein
    // gecachter Spielstand oder eine gecachte Supabase-Antwort waeren nicht
    // "etwas veraltet", sondern schlicht falsch (der Mitspieler ist laengst
    // weiter). Deshalb gibt es hier bewusst KEIN runtimeCaching -- ohne
    // solche Regeln laesst Workbox alles durch, was nicht im Precache steht:
    // jeder Supabase-Aufruf, der Realtime-WebSocket und /api/* gehen
    // unveraendert ans Netz.
    VitePWA({
      registerType: 'autoUpdate',
      // Das Manifest wird von Hand in public/manifest.json gepflegt und ist
      // in index.html verlinkt; das Plugin soll kein zweites erzeugen.
      manifest: false,
      workbox: {
        // Nur statische, gehashte Build-Artefakte. Bewusst OHNE html:
        // waere index.html im Precache, beantwortete der Service Worker
        // auch Navigationsanfragen aus dem Cache und die Nutzer haengen
        // nach einem Deploy auf der alten App-Huelle fest.
        globPatterns: ['**/*.{js,css,woff,woff2,png,svg,webp,ico}'],
        // Aus demselben Grund kein Fallback auf die App-Huelle.
        navigateFallback: undefined,
        // Passend zu registerType 'autoUpdate': neue Version uebernimmt
        // sofort, alte Precaches werden geloescht.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      // Im Dev-Server bleibt der Service Worker aus (Vite-Voreinstellung),
      // sonst kaeme HMR gegen den Precache nicht an. Zum Testen der
      // Installierbarkeit: npm run build && npm run preview.
      devOptions: { enabled: false },
    }),
  ],
})
