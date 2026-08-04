import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Push-APIs erwarten den Server-Schluessel als Uint8Array, VAPID liefert
 *  ihn aber als base64url-String -- Standard-Umrechnung laut MDN. */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

/**
 * Push-Berechtigung und -Abo. Zeigt selbst nichts an -- welche Komponente
 * wann um Erlaubnis bittet, bleibt bewusst deren Entscheidung (gleiches
 * Prinzip wie useInstallPrompt.js).
 *
 * Ohne VITE_VAPID_PUBLIC_KEY (lokale Entwicklung ohne gesetzte Env-Variable)
 * bleibt `supported` false -- kein Fehler, die Einladung faellt dann einfach
 * auf den Toast/die Einladungen-Liste zurueck, ohne Push zu versuchen.
 */
export default function usePushNotifications(user) {
    const [permission, setPermission] = useState(
        typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
    );

    const supported = !!VAPID_PUBLIC_KEY
        && typeof window !== 'undefined'
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && typeof Notification !== 'undefined';

    // Nach einem Reload mit bereits erteilter Berechtigung leise nachziehen,
    // z. B. wenn der Service Worker zwischenzeitlich aktualisiert wurde und
    // ein neues Abo braucht.
    useEffect(() => {
        if (!supported || !user?.id || Notification.permission !== 'granted') return;
        (async () => {
            try {
                const reg = await navigator.serviceWorker.ready;
                const existing = await reg.pushManager.getSubscription();
                if (!existing) return;
                const json = existing.toJSON();
                await supabase.rpc('save_push_subscription', {
                    p_endpoint: json.endpoint,
                    p_p256dh: json.keys.p256dh,
                    p_auth: json.keys.auth,
                });
            } catch {
                // Kein Abo herzustellen ist kein Fehlerfall aus Nutzersicht --
                // die Einladung faellt einfach auf die Liste zurueck.
            }
        })();
    }, [supported, user?.id]);

    /** Fragt bei Bedarf nach Erlaubnis und legt das Abo an. Nur aus einer
     *  echten Nutzergeste heraus aufrufen (Browser-Vorgabe fuer den Dialog). */
    const subscribe = useCallback(async () => {
        if (!supported || !user?.id) return false;

        let perm = Notification.permission;
        if (perm === 'default') {
            perm = await Notification.requestPermission();
        }
        setPermission(perm);
        if (perm !== 'granted') return false;

        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
            });
        }

        const json = sub.toJSON();
        const { error } = await supabase.rpc('save_push_subscription', {
            p_endpoint: json.endpoint,
            p_p256dh: json.keys.p256dh,
            p_auth: json.keys.auth,
        });
        return !error;
    }, [supported, user?.id]);

    return { supported, permission, subscribe };
}
