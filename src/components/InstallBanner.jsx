import React, { useState } from 'react';
import { Download, Share, SquarePlus, MoreVertical, X } from 'lucide-react';

import useInstallPrompt from '../hooks/useInstallPrompt';

const DISMISS_KEY = 'install-banner-dismissed';

/** localStorage kann werfen (Safari im privaten Modus). Ein fehlgeschlagenes
 *  Merken darf den Hinweis nicht mitreissen. */
function readDismissed() {
    try {
        return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
        return false;
    }
}

/**
 * Hinweis "PartyBox zum Startbildschirm hinzufuegen".
 *
 * Drei Faelle, weil die Browser drei verschiedene Dinge koennen:
 *   1. Chromium hat `beforeinstallprompt` -- ein Knopf, fertig.
 *   2. Safari auf iOS kann das nicht, dort bleibt nur die Anleitung
 *      "Teilen -> Zum Home-Bildschirm".
 *   3. Alles andere (Firefox, In-App-Browser von Instagram/WhatsApp)
 *      bekommt den Menue-Hinweis als Notnagel.
 *
 * Einmal weggeklickt bleibt der Hinweis dauerhaft weg -- eine App, die immer
 * wieder ums Installieren bettelt, ist genau die Sorte Banner, die man
 * wegklickt, ohne sie zu lesen.
 */
export default function InstallBanner() {
    const { isStandalone, isIOS, isAndroid, canPrompt, promptInstall } = useInstallPrompt();
    const [dismissed, setDismissed] = useState(readDismissed);

    // Laeuft schon als App: nichts zu tun.
    if (isStandalone || dismissed) return null;
    // Am Rechner ohne Installationsdialog waere die Anleitung nur Rauschen.
    if (!isIOS && !isAndroid && !canPrompt) return null;

    const dismiss = () => {
        setDismissed(true);
        try {
            localStorage.setItem(DISMISS_KEY, '1');
        } catch {
            // Dann eben nur fuer diese Sitzung.
        }
    };

    const install = async () => {
        const accepted = await promptInstall();
        // Bei Zustimmung blendet `appinstalled` den Hinweis von selbst aus.
        // Nach einer Ablehnung verschwindet er ebenfalls: ein zweites Mal
        // fragen darf der Browser sowieso erst nach laengerer Zeit wieder.
        if (!accepted) dismiss();
    };

    return (
        <div className="fixed bottom-4 left-4 right-4 sm:right-auto sm:w-80 z-[80] max-w-[calc(100vw-2rem)]">
            <div className="bg-slate-800 border border-purple-500/40 rounded-2xl p-4 shadow-2xl">
                <div className="flex items-start gap-3">
                    <img
                        src="/icon-192.png"
                        alt=""
                        className="w-10 h-10 rounded-xl shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-white">PartyBox installieren</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                            Als App auf dem Startbildschirm — ohne Browser-Leiste.
                        </p>
                    </div>
                    <button
                        onClick={dismiss}
                        className="text-slate-500 hover:text-slate-300 transition-colors shrink-0 -mt-1 -mr-1 p-1"
                        title="Nicht mehr anzeigen"
                        aria-label="Hinweis schließen"
                    >
                        <X size={16} />
                    </button>
                </div>

                {canPrompt && (
                    <button
                        onClick={install}
                        className="mt-3 w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white text-sm font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                        <Download size={16} /> Installieren
                    </button>
                )}

                {!canPrompt && isIOS && (
                    <ol className="mt-3 space-y-2 text-xs text-slate-300">
                        <li className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                                1
                            </span>
                            <span className="flex items-center gap-1.5">
                                Unten in der Browser-Leiste auf
                                <Share size={15} className="text-sky-400 shrink-0" />
                                tippen
                            </span>
                        </li>
                        <li className="flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-slate-700 text-slate-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                                2
                            </span>
                            <span className="flex items-center gap-1.5">
                                <SquarePlus size={15} className="text-sky-400 shrink-0" />
                                „Zum Home-Bildschirm“ wählen
                            </span>
                        </li>
                    </ol>
                )}

                {!canPrompt && !isIOS && (
                    <p className="mt-3 text-xs text-slate-300 flex items-start gap-1.5">
                        <MoreVertical size={15} className="text-sky-400 shrink-0 mt-px" />
                        <span>
                            Browser-Menü öffnen und „App installieren“ bzw.
                            „Zum Startbildschirm hinzufügen“ wählen.
                        </span>
                    </p>
                )}
            </div>
        </div>
    );
}
