import { useCallback, useEffect, useState } from 'react';

/**
 * Zustand rund um "App zum Startbildschirm hinzufuegen".
 *
 * Der Hook entscheidet NICHT, ob ein Hinweis erscheint -- er liefert nur
 * Plattform und Installationszustand. Die Anzeige haengt an weiteren
 * Bedingungen (weggeklickt, Zeitpunkt), die in die Komponente gehoeren.
 *
 * Warum ueberhaupt Plattform-Erkennung: Chrome bietet mit
 * `beforeinstallprompt` einen echten Ein-Tipp-Dialog an, Safari hat dafuer
 * kein Gegenstueck. Auf iOS bleibt nur die Anleitung "Teilen -> Zum
 * Home-Bildschirm". Die beiden Faelle sehen darum voellig unterschiedlich aus.
 */

/** Erkennt iOS, Android oder "sonstiges". */
function detectPlatform() {
    if (typeof navigator === 'undefined') return 'other';
    const ua = navigator.userAgent || '';

    // Ein iPad meldet sich seit iPadOS 13 als "Macintosh" -- im User-Agent
    // ist es von einem echten Mac nicht zu unterscheiden. Verraeterisch ist
    // nur der Touchscreen: Macs melden maxTouchPoints 0.
    const iPadAsMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
    if (/iPad|iPhone|iPod/.test(ua) || iPadAsMac) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return 'other';
}

/** Laeuft die App bereits als installierte App statt im Browser-Tab? */
function detectStandalone() {
    if (typeof window === 'undefined') return false;
    // Zwei Wege noetig: Chrome/Android kennt display-mode, das aeltere
    // Safari auf iOS setzt stattdessen navigator.standalone.
    return window.matchMedia?.('(display-mode: standalone)').matches === true
        || window.navigator.standalone === true;
}

export default function useInstallPrompt() {
    const [isStandalone, setIsStandalone] = useState(detectStandalone);
    const [platform] = useState(detectPlatform);
    // Das Event-Objekt selbst ist der Schluessel zum Dialog: prompt() laesst
    // sich nur darauf aufrufen, und nur einmal.
    const [deferredPrompt, setDeferredPrompt] = useState(null);

    useEffect(() => {
        const onBeforeInstallPrompt = (event) => {
            // Ohne preventDefault zeigt Chrome je nach Version seinen eigenen
            // Mini-Infobalken -- dann haetten wir zwei Hinweise nebeneinander.
            event.preventDefault();
            setDeferredPrompt(event);
        };

        // Nach der Installation ist das Event verbraucht; der Hinweis muss weg,
        // auch wenn das Fenster noch im Browser-Tab steht.
        const onInstalled = () => {
            setDeferredPrompt(null);
            setIsStandalone(true);
        };

        window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
        window.addEventListener('appinstalled', onInstalled);

        // Beim Start aus dem Startbildschirm heraus steht display-mode schon
        // beim ersten Rendern fest; die Umschaltung greift nur, wenn jemand
        // die laufende Seite installiert.
        const media = window.matchMedia?.('(display-mode: standalone)');
        const onDisplayModeChange = (event) => setIsStandalone(event.matches);
        // Optionaler Aufruf: aeltere Safari-Versionen kennen an einer
        // MediaQueryList nur das abgekuendigte addListener().
        media?.addEventListener?.('change', onDisplayModeChange);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
            window.removeEventListener('appinstalled', onInstalled);
            media?.removeEventListener?.('change', onDisplayModeChange);
        };
    }, []);

    /**
     * Oeffnet den nativen Installationsdialog. Liefert true, wenn der Nutzer
     * zugestimmt hat. Nur aus einer echten Nutzergeste heraus aufrufen.
     */
    const promptInstall = useCallback(async () => {
        if (!deferredPrompt) return false;
        try {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            return outcome === 'accepted';
        } catch {
            // prompt() wirft, wenn das Event schon verbraucht ist.
            return false;
        } finally {
            // Nach prompt() ist das Event einmalig verbraucht. Chrome feuert
            // ein neues, falls der Nutzer abgelehnt hat und spaeter wieder
            // in Frage kommt.
            setDeferredPrompt(null);
        }
    }, [deferredPrompt]);

    return {
        isStandalone,
        platform,
        isIOS: platform === 'ios',
        isAndroid: platform === 'android',
        /** true = der Ein-Tipp-Dialog steht bereit (praktisch nur Chromium). */
        canPrompt: !!deferredPrompt,
        promptInstall,
    };
}
