import React, { useState } from 'react';
import { UserPlus, Check, X, Loader2, Send, Trash2, Users } from 'lucide-react';
import { avatarUrl } from '../../hooks/useAuth';
import { relativeTimeDe } from '../../utils/helpers';

/** Kleiner Statuspunkt. Die drei Zustaende kommen direkt aus list_friends():
 *  online + in_lobby, nur online, oder offline mit last_seen_at. */
function StatusDot({ online, inLobby }) {
    const color = inLobby ? 'bg-purple-400' : online ? 'bg-green-400' : 'bg-slate-600';
    return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
}

function Avatar({ person, size = 'w-9 h-9' }) {
    const url = avatarUrl(person.avatar_path);
    const initial = (person.username || person.display_name || 'S').charAt(0).toUpperCase();
    return url ? (
        <img src={url} alt="" className={`${size} rounded-full object-cover border border-slate-600 shrink-0`} />
    ) : (
        <div className={`${size} rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm text-white shrink-0`}>
            {initial}
        </div>
    );
}

/** Eine Person mit Handle. Der Anzeigename steht daneben, weil er in der
 *  Lobby auftaucht — der Handle allein hilft beim Wiedererkennen nicht. */
function PersonLine({ person }) {
    const handle = person.username ? `${person.username}#${person.discriminator}` : '—';
    // 'Spieler' ist der unberuehrte Default aus handle_new_user -- als
    // "zuletzt als Spieler" waere das eine Falschaussage, kein Hinweis.
    const lastName = person.display_name && person.display_name !== 'Spieler'
        ? person.display_name : null;
    return (
        <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-200 text-sm truncate">{handle}</p>
            {lastName && (
                <p className="text-xs text-slate-500 truncate">zuletzt als „{lastName}"</p>
            )}
        </div>
    );
}

export default function FriendsPanel({ friendsLogic, ownHandle, inLobby }) {
    const {
        friends, incoming, outgoing, error, setError, busy,
        sendRequest, respond, removeFriend, inviteToLobby,
    } = friendsLogic;

    const [input, setInput] = useState('');

    const submit = async () => {
        const ok = await sendRequest(input);
        if (ok) setInput('');
    };

    if (!ownHandle) {
        return (
            <div className="text-center py-8">
                <Users size={32} className="mx-auto text-slate-600 mb-3" />
                <p className="text-sm text-slate-400">
                    Lege zuerst im Reiter <span className="font-bold text-slate-300">Profil</span> deinen
                    Benutzernamen fest. Erst damit können dich andere hinzufügen.
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-5">
            <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                    Freund hinzufügen
                </label>
                <div className="flex gap-2">
                    <input
                        value={input}
                        onChange={(e) => { setInput(e.target.value); setError(''); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                        placeholder="Name#1234"
                        maxLength={25}
                        className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                    />
                    <button
                        onClick={submit}
                        disabled={busy || !input.trim()}
                        className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 rounded-lg transition-colors shrink-0"
                        title="Anfrage senden"
                    >
                        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    </button>
                </div>
                <p className="text-xs text-slate-500 mt-1.5">
                    Dein Name: <span className="font-mono text-slate-400">{ownHandle}</span>
                </p>
                {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
            </div>

            {incoming.length > 0 && (
                <section>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Anfragen an dich ({incoming.length})
                    </h4>
                    <div className="space-y-2">
                        {incoming.map((p) => (
                            <div key={p.id} className="flex items-center gap-3 bg-slate-900/60 rounded-xl p-2.5 border border-indigo-500/30">
                                <Avatar person={p} />
                                <PersonLine person={p} />
                                <div className="flex gap-1 shrink-0">
                                    <button onClick={() => respond(p.id, true)} disabled={busy}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-slate-700 transition-colors"
                                        title="Annehmen">
                                        <Check size={18} />
                                    </button>
                                    <button onClick={() => respond(p.id, false)} disabled={busy}
                                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                                        title="Ablehnen">
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            {outgoing.length > 0 && (
                <section>
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                        Gesendet ({outgoing.length})
                    </h4>
                    <div className="space-y-2">
                        {outgoing.map((p) => (
                            <div key={p.id} className="flex items-center gap-3 bg-slate-900/40 rounded-xl p-2.5 border border-slate-700/50">
                                <Avatar person={p} />
                                <PersonLine person={p} />
                                <button onClick={() => removeFriend(p.id)} disabled={busy}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors shrink-0"
                                    title="Anfrage zurückziehen">
                                    <X size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                </section>
            )}

            <section>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">
                    Freunde ({friends.length})
                </h4>
                {friends.length === 0 ? (
                    <p className="text-sm text-slate-500 py-3 text-center">
                        Noch niemand. Frag nach dem <span className="font-mono">Name#1234</span> deiner Freunde.
                    </p>
                ) : (
                    <div className="space-y-2">
                        {friends.map((p) => (
                            <div key={p.id} className="flex items-center gap-3 bg-slate-900/60 rounded-xl p-2.5 border border-slate-700/50">
                                <Avatar person={p} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <StatusDot online={p.online} inLobby={p.in_lobby} />
                                        <p className="font-bold text-slate-200 text-sm truncate">
                                            {p.username}#{p.discriminator}
                                        </p>
                                    </div>
                                    <p className="text-xs text-slate-500 truncate pl-4.5">
                                        {p.in_lobby ? 'in einer Lobby'
                                            : p.online ? 'online'
                                            : relativeTimeDe(p.last_seen_at)}
                                    </p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    {inLobby && !p.in_lobby && (
                                        <button onClick={() => inviteToLobby(p.id)} disabled={busy}
                                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-700 transition-colors"
                                            title="In meine Lobby einladen">
                                            <UserPlus size={18} />
                                        </button>
                                    )}
                                    <button onClick={() => {
                                        if (window.confirm(`${p.username}#${p.discriminator} wirklich entfernen?`)) removeFriend(p.id);
                                    }} disabled={busy}
                                        className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-slate-700 transition-colors"
                                        title="Freund entfernen">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
