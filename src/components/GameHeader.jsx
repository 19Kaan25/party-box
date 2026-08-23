import React, { createContext, useContext, useState } from 'react';
import { Home, LogOut, Menu, RotateCcw, X } from 'lucide-react';

const GlobalGameHeaderContext = createContext(false);

/** Unterdrueckt die alten, phasenweise eingebauten Header der Engines. */
export function GlobalGameHeaderProvider({ children }) {
    return (
        <GlobalGameHeaderContext.Provider value={true}>
            {children}
        </GlobalGameHeaderContext.Provider>
    );
}

const GameHeader = ({
    isHost,
    leaveLobby,
    updateLobbyStatus,
    global = false,
    onReturnToLobby,
    onRestart,
}) => {
    const globallyManaged = useContext(GlobalGameHeaderContext);
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);

    // Die Engines enthalten noch viele historische GameHeader-Aufrufe. Sobald
    // GameRouter den globalen Header bereitstellt, duerfen sie nichts doppeln.
    if (globallyManaged && !global) return null;

    const run = async (action) => {
        setBusy(true);
        try {
            await action?.();
            setOpen(false);
        } finally {
            setBusy(false);
        }
    };

    const handleReturnToLobby = () => {
        const message = isHost
            ? 'Spiel für alle beenden und zur Lobby zurückkehren? Nicht verteilte Punkte gehen verloren.'
            : 'Zur Lobbyansicht zurückkehren? Das Spiel läuft für die anderen weiter und du kannst wieder einsteigen.';
        if (window.confirm(message)) run(onReturnToLobby || (() => (
            isHost
                ? updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })
                : leaveLobby()
        )));
    };

    const handleRestart = () => {
        if (!window.confirm('Laufende Runde verwerfen und für alle zu den Spieleinstellungen zurückkehren? Nicht verteilte Punkte gehen verloren.')) return;
        run(onRestart);
    };

    const handleMainMenu = () => {
        const hostNote = isHost
            ? ' Ein anderer Spieler wird automatisch Partyleiter und kann das laufende Spiel fortsetzen.'
            : '';
        if (!window.confirm(`Lobby verlassen und zum Hauptmenü zurückkehren?${hostNote}`)) return;
        run(leaveLobby);
    };

    // Rueckfall fuer eine Engine, die ausserhalb des Routers gerendert wuerde.
    if (!global) {
        return (
            <div className="fixed right-4 top-4 z-[80]">
                <button
                    onClick={isHost ? handleReturnToLobby : handleMainMenu}
                    className="flex items-center gap-1 rounded-lg border border-red-500/20 bg-slate-900/90 px-3 py-1.5 text-sm text-red-400 shadow-lg backdrop-blur-sm hover:text-red-300"
                >
                    {isHost ? <Home size={16} /> : <LogOut size={16} />}
                    {isHost ? 'Zur Lobby' : 'Zum Hauptmenü'}
                </button>
            </div>
        );
    }

    return (
        <div className="fixed right-3 top-3 z-[80] sm:right-6 sm:top-6">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-900/95 px-3 py-2 text-sm font-bold text-white shadow-2xl backdrop-blur hover:bg-slate-800"
            >
                {open ? <X size={18} /> : <Menu size={18} />}
                Spielmenü
            </button>

            {open && (
                <div className="mt-2 w-[min(19rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-600 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
                    {isHost && (
                        <button
                            type="button"
                            disabled={busy}
                            onClick={handleRestart}
                            className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        >
                            <RotateCcw size={19} className="mt-0.5 shrink-0 text-amber-400" />
                            <span>
                                <span className="block font-bold">Zu den Spieleinstellungen</span>
                                <span className="block text-xs text-slate-500">Runde für alle neu aufsetzen</span>
                            </span>
                        </button>
                    )}

                    <button
                        type="button"
                        disabled={busy}
                        onClick={handleReturnToLobby}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                    >
                        <Home size={19} className="mt-0.5 shrink-0 text-purple-400" />
                        <span>
                            <span className="block font-bold">Zurück zur Lobby</span>
                            <span className="block text-xs text-slate-500">
                                {isHost ? 'Spiel für alle beenden' : 'Spiel läuft für die anderen weiter'}
                            </span>
                        </span>
                    </button>

                    <button
                        type="button"
                        disabled={busy}
                        onClick={handleMainMenu}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left text-red-300 hover:bg-red-950/40 disabled:opacity-50"
                    >
                        <LogOut size={19} className="mt-0.5 shrink-0" />
                        <span>
                            <span className="block font-bold">Zum Hauptmenü</span>
                            <span className="block text-xs text-red-300/50">Lobby vollständig verlassen</span>
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default GameHeader;
