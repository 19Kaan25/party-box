import React, { useState } from 'react';
import { Mail, Check, X, Loader2, LogIn } from 'lucide-react';
import { relativeTimeDe } from '../../utils/helpers';
import Avatar from './Avatar';

const INVITE_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** "läuft in 3 Std. ab" -- Gegenstueck zu relativeTimeDe(created_at). Rein
 *  kosmetisch: massgeblich fuer das tatsaechliche Verschwinden ist
 *  list_my_invites() auf dem Server (24-Stunden-Filter) plus der stuendliche
 *  Aufraeum-Job, nicht diese Anzeige. */
function expiresInDe(createdAt) {
    const remainingMs = new Date(createdAt).getTime() + INVITE_LIFETIME_MS - Date.now();
    if (Number.isNaN(remainingMs) || remainingMs <= 0) return 'läuft gleich ab';
    const min = Math.round(remainingMs / 60000);
    if (min < 60) return `läuft in ${min} Min. ab`;
    const std = Math.round(min / 60);
    return std === 1 ? 'läuft in 1 Std. ab' : `läuft in ${std} Std. ab`;
}

/**
 * Offene Lobby-Einladungen UND eingehende Beitrittsanfragen. Zwei
 * unterschiedliche Dinge, die zufällig densselben Reiter teilen:
 *   - Einladung: jemand in einer Lobby hat DICH eingeladen -- annehmen
 *     bringt DICH in seine Lobby (onAccept -> handleJoinLobby).
 *   - Beitrittsanfrage: jemand OHNE Lobby fragt, ob er in DEINE darf --
 *     annehmen erzeugt im Hintergrund eine normale Einladung an ihn
 *     (respond_join_request), du selbst bewegst dich nicht.
 */
export default function InvitesPanel({ friendsLogic, onAccept }) {
    const { invites, joinRequests, busy, declineInvite, respondJoinRequest } = friendsLogic;
    const [acceptingId, setAcceptingId] = useState(null);

    const accept = async (invite) => {
        setAcceptingId(invite.id);
        try {
            await onAccept?.(invite);
        } finally {
            setAcceptingId(null);
        }
    };

    if (invites.length === 0 && joinRequests.length === 0) {
        return (
            <div className="text-center py-8">
                <Mail size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">Keine offenen Einladungen.</p>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {joinRequests.length > 0 && (
                <section>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Beitrittsanfragen ({joinRequests.length})
                    </h4>
                    <div className="space-y-2">
                        {joinRequests.map((req) => (
                            <div key={req.id} className="bg-slate-900/60 rounded-xl p-2.5 border border-purple-500/30">
                                <div className="flex items-center gap-3">
                                    <Avatar person={req} />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-slate-200 text-sm truncate">
                                            {req.username}#{req.discriminator}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate flex items-center gap-1">
                                            <LogIn size={11} /> möchte deiner Lobby beitreten
                                        </p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() => respondJoinRequest(req.id, true)}
                                            disabled={busy}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-slate-700 transition-colors"
                                            title="Annehmen"
                                        >
                                            <Check size={18} />
                                        </button>
                                        <button
                                            onClick={() => respondJoinRequest(req.id, false)}
                                            disabled={busy}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                                            title="Ablehnen"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {invites.length > 0 && (
                <section>
                    {joinRequests.length > 0 && (
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                            Einladungen an dich ({invites.length})
                        </h4>
                    )}
                    <div className="space-y-2">
                        {invites.map((inv) => (
                            <div key={inv.id} className="bg-slate-900/60 rounded-xl p-2.5 border border-indigo-500/30">
                                <div className="flex items-center gap-3">
                                    <Avatar person={inv} />
                                    <div className="min-w-0 flex-1">
                                        <p className="font-bold text-slate-200 text-sm truncate">
                                            {inv.username}#{inv.discriminator}
                                        </p>
                                        <p className="text-xs text-slate-500 truncate">
                                            {relativeTimeDe(inv.created_at)} · {expiresInDe(inv.created_at)}
                                        </p>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <button
                                            onClick={() => accept(inv)}
                                            disabled={busy || acceptingId === inv.id}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-slate-700 transition-colors"
                                            title="Annehmen"
                                        >
                                            {acceptingId === inv.id
                                                ? <Loader2 size={18} className="animate-spin" />
                                                : <Check size={18} />}
                                        </button>
                                        <button
                                            onClick={() => declineInvite(inv.id)}
                                            disabled={busy || acceptingId === inv.id}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                                            title="Ablehnen"
                                        >
                                            <X size={18} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}
