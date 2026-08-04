import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),

    // Service Worker. Zweck: Installierbarkeit, schnelleres Nachladen der
    // Bundles, und -- seit den Push-Benachrichtigungen -- ein push/
    // notificationclick-Handler. NICHT Offline-Faehigkeit.
    //
    // PartyBox ist eine Live-Mehrspieler-App: eine gecachte Lobby, ein
    // gecachter Spielstand oder eine gecachte Supabase-Antwort waeren nicht
    // "etwas veraltet", sondern schlicht falsch (der Mitspieler ist laengst
    // weiter). Deshalb bleibt es bei reinem Precaching statischer
    // Build-Artefakte, kein runtimeCaching: jeder Supabase-Aufruf, der
    // Realtime-WebSocket und /api/* gehen unveraendert ans Netz.
    //
    // strategy 'injectManifest' statt 'generateSW': Workbox' generateSW
    // erlaubt keine eigenen Event-Listener, push/notificationclick
    // brauchen aber genau das. src/sw.js schreibt das Precaching von Hand
    // nach (self.__WB_MANIFEST, injiziert vom Plugin) und ergaenzt push.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // Das Manifest wird von Hand in public/manifest.json gepflegt und ist
      // in index.html verlinkt; das Plugin soll kein zweites erzeugen.
      manifest: false,
      injectManifest: {
        // Gleiche Liste wie zuvor im generateSW-Workbox-Block. Bewusst OHNE
        // html: waere index.html im Precache, beantwortete der Service
        // Worker auch Navigationsanfragen aus dem Cache und die Nutzer
        // haengen nach einem Deploy auf der alten App-Huelle fest.
        globPatterns: ['**/*.{js,css,woff,woff2,png,svg,webp,ico}'],
      },
      // Im Dev-Server bleibt der Service Worker aus (Vite-Voreinstellung),
      // sonst kaeme HMR gegen den Precache nicht an. Zum Testen der
      // Installierbarkeit UND von Push: npm run build && npm run preview.
      devOptions: { enabled: false },
    }),
  ],
})
