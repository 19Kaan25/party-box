import React from 'react';
import { Mail, Check, X } from 'lucide-react';

/**
 * Eingegangene Lobby-Einladungen, unten rechts. Realtime-gespeist ueber
 * useFriends -- der Empfaenger muss den Freunde-Reiter also nicht offen
 * haben.
 *
 * "Beitreten" ruft bewusst den bestehenden handleJoinLobby-Pfad aus
 * useLobby auf, statt join_lobby direkt aufzurufen: dort haengen die
 * Nickname-Pruefung, die deutschen Fehlermeldungen und das Nachladen des
 * Lobby-Zustands dran.
 */
export default function InviteToasts({ invites, onAccept, onDecline }) {
    if (!invites?.length) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[90] flex flex-col gap-2 max-w-[calc(100vw-2rem)] w-80">
            {invites.map((inv) => (
                <div
                    key={inv.id}
                    className="bg-slate-800 border border-indigo-500/40 rounded-2xl p-4 shadow-2xl animate-in slide-in-from-bottom-2"
                >
                    <div className="flex items-start gap-3">
                        <Mail size={18} className="text-indigo-400 shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                            <p className="text-sm text-slate-200">
                                <span className="font-bold font-mono">
                                    {inv.username}#{inv.discriminator}
                                </span>{' '}
                                lädt dich in eine Lobby ein.
                            </p>
                            <p className="text-xs text-slate-500 font-mono mt-0.5">{inv.lobby_code}</p>
                        </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                        <button
                            onClick={() => onAccept(inv)}
                            className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold py-2 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                        >
                            <Check size={15} /> Beitreten
                        </button>
                        <button
                            onClick={() => onDecline(inv.id)}
                            className="px-3 bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold rounded-lg transition-colors flex items-center justify-center"
                            title="Ablehnen"
                        >
                            <X size={15} />
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
