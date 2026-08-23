import React, { useState } from 'react';
import { ArrowRight, Copy, DoorOpen, Gamepad2, LogOut, Users } from 'lucide-react';

const GAME_NAMES = {
    STADT_LAND_FLUSS: 'Stadt Land Fluss',
    CODENAMES: 'Codenames',
    WERWOLF: 'Werwolf',
    WER_BIN_ICH: 'Wer bin ich?',
    IMPOSTER: 'Imposter',
    SPRUECHE_KLOPFER: 'Sprücheklopfer',
};

export default function GamePausedScreen({ lobby, user, onResume, onLeaveLobby }) {
    const [copied, setCopied] = useState(false);
    const optedOut = lobby.gameState?.optedOut || {};
    const isPlaying = (player) => !optedOut[player.id] || player.id === lobby.hostId;
    const activeCount = lobby.players.filter(isPlaying).length;

    const copyCode = () => {
        if (!navigator.clipboard) return;
        navigator.clipboard.writeText(lobby.id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
    };

    const leave = () => {
        if (window.confirm('Lobby verlassen und zum Hauptmenü zurückkehren?')) onLeaveLobby();
    };

    return (
        <div className="min-h-screen bg-slate-950 p-4 text-white sm:p-8">
            <div className="mx-auto max-w-3xl pt-8 sm:pt-16">
                <div className="rounded-3xl border border-purple-500/30 bg-slate-900 p-6 shadow-2xl sm:p-8">
                    <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <p className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-400">
                                <DoorOpen size={17} /> Lobbyansicht
                            </p>
                            <h1 className="text-3xl font-black">Du pausierst dieses Spiel</h1>
                            <p className="mt-2 text-slate-400">
                                {GAME_NAMES[lobby.currentGame] || 'Das Spiel'} läuft für die anderen weiter.
                                Du bleibst Mitglied der Lobby und kannst jederzeit wieder einsteigen.
                            </p>
                        </div>

                        <button
                            type="button"
                            onClick={copyCode}
                            className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 font-mono font-bold text-purple-300 hover:bg-slate-700"
                        >
                            <Copy size={16} /> {copied ? 'Kopiert' : lobby.id}
                        </button>
                    </div>

                    <div className="mb-7 rounded-2xl border border-slate-700 bg-slate-800/60 p-5">
                        <h2 className="mb-4 flex items-center gap-2 font-bold text-slate-200">
                            <Users size={18} className="text-indigo-400" /> Lobbyspieler
                        </h2>
                        <div className="space-y-2">
                            {lobby.players.map((player) => {
                                const playing = isPlaying(player);
                                return (
                                    <div key={player.id} className="flex items-center justify-between gap-3 rounded-xl bg-slate-900/70 px-4 py-3">
                                        <span className="min-w-0 font-bold [overflow-wrap:anywhere]">
                                            {player.name} {player.id === user.uid && <span className="text-slate-500">(Du)</span>}
                                        </span>
                                        <span className={`shrink-0 text-xs font-bold ${playing ? 'text-emerald-400' : 'text-slate-500'}`}>
                                            {playing ? 'im Spiel' : 'in der Lobby'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <p className="mt-4 text-xs text-slate-500">{activeCount} Spieler aktuell im Spiel</p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <button
                            type="button"
                            onClick={onResume}
                            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-4 font-bold shadow-lg hover:from-purple-500 hover:to-indigo-500"
                        >
                            <Gamepad2 size={20} /> Zurück ins Spiel <ArrowRight size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={leave}
                            className="flex items-center justify-center gap-2 rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 font-bold text-red-300 hover:bg-red-500/20"
                        >
                            <LogOut size={20} /> Zum Hauptmenü
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
