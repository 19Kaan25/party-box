import React, { useState } from 'react';
import { UserPlus, Check, X, Loader2, Send, Trash2, Users, LogIn, BellRing } from 'lucide-react';
import { relativeTimeDe } from '../../utils/helpers';
import { sendInvitePush } from '../../lib/sendInvitePush';
import Avatar from './Avatar';

/** Vorbelegung fuer die Push-Nachricht -- wird nur verschickt, wenn das
 *  Feld beim Absenden leer geblieben ist. server-seitig identisch als
 *  Fallback hinterlegt (api/send-invite-push.js), diese Variante hier ist
 *  nur die sichtbare Vorschau im Eingabefeld. */
const standardPushMessage = (lobbyCode) => `Du wurdest in eine Lobby eingeladen (${lobbyCode}).`;

/** Kleiner Statuspunkt. Die drei Zustaende kommen direkt aus list_friends():
 *  online + in_lobby, nur online, oder offline mit last_seen_at. */
function StatusDot({ online, inLobby }) {
    const color = inLobby ? 'bg-purple-400' : online ? 'bg-green-400' : 'bg-slate-600';
    return <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />;
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

export default function FriendsPanel({ friendsLogic, ownHandle, inLobby, lobbyCode }) {
    const {
        friends, incoming, outgoing, error, setError, busy,
        sendRequest, respond, removeFriend, inviteToLobby, inviteErrors, requestToJoin,
    } = friendsLogic;

    const [input, setInput] = useState('');
    // Wer offline ist, bekommt statt eines sofortigen Klicks diese Box:
    // Standardtext oder eigene Nachricht, BEVOR die Einladung + der
    // Push-Versand ausgeloest werden. composeFor haelt die Freund-ID, fuer
    // die die Box gerade offen ist -- nie mehr als eine gleichzeitig.
    const [composeFor, setComposeFor] = useState(null);
    const [messageDraft, setMessageDraft] = useState('');
    const [sendingPushFor, setSendingPushFor] = useState(null);

    const submit = async () => {
        const ok = await sendRequest(input);
        if (ok) setInput('');
    };

    const openInvite = (p) => {
        if (p.online) { inviteToLobby(p.id); return; }
        setComposeFor((prev) => (prev === p.id ? null : p.id));
        setMessageDraft('');
    };

    const sendOfflineInvite = async (p) => {
        setSendingPushFor(p.id);
        try {
            const ok = await inviteToLobby(p.id);
            // Die Einladung gilt auch, wenn der Push-Versand scheitert (kein
            // Abo, Endpunkt nicht erreichbar) -- deshalb kein await auf einen
            // Erfolg hier, sendInvitePush wirft ohnehin nie.
            if (ok) await sendInvitePush({ toUserId: p.id, lobbyCode, message: messageDraft });
            setComposeFor(null);
        } finally {
            setSendingPushFor(null);
        }
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
                            <div key={p.id} className="bg-slate-900/60 rounded-xl p-2.5 border border-slate-700/50">
                                <div className="flex items-center gap-3">
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
                                        {/* Auch fuer Freunde, die gerade woanders sitzen:
                                            join_lobby verlaesst die alte Lobby beim
                                            Annehmen. Ist die Person schon in DIESER
                                            Lobby, meldet die RPC das verstaendlich. */}
                                        {inLobby && (
                                            <button onClick={() => openInvite(p)} disabled={busy}
                                                className={`p-1.5 rounded-lg transition-colors ${composeFor === p.id ? 'text-indigo-300 bg-slate-700' : 'text-slate-400 hover:text-indigo-300 hover:bg-slate-700'}`}
                                                title={p.online ? 'In meine Lobby einladen' : 'In meine Lobby einladen (per Push, ist offline)'}>
                                                <UserPlus size={18} />
                                            </button>
                                        )}
                                        {/* Umgekehrte Richtung: der Freund sitzt schon in
                                            einer Lobby, ich frage nach statt einzuladen.
                                            Unabhaengig davon, ob ich selbst gerade in
                                            einer Lobby bin -- ein Beitritt verlaesst sie
                                            ohnehin automatisch. */}
                                        {p.in_lobby && (
                                            <button onClick={() => requestToJoin(p.id)} disabled={busy}
                                                className="p-1.5 rounded-lg text-slate-400 hover:text-purple-300 hover:bg-slate-700 transition-colors"
                                                title="Beitrittsanfrage senden">
                                                <LogIn size={18} />
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
                                {/* Rueckmeldung zur Lobby-Einladung nur hier, direkt am
                                    betroffenen Freund -- verschwindet von selbst nach 4s
                                    (INVITE_ERROR_MS in useFriends.js). */}
                                {inviteErrors?.[p.id] && (
                                    <p className="text-xs text-amber-400 mt-2 pl-12">{inviteErrors[p.id]}</p>
                                )}

                                {composeFor === p.id && (
                                    <div className="mt-2.5 pl-12 pr-1">
                                        <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                                            <BellRing size={12} /> Ist offline — Einladung kommt als Push-Benachrichtigung an
                                        </div>
                                        <textarea
                                            value={messageDraft}
                                            onChange={(e) => setMessageDraft(e.target.value)}
                                            placeholder={standardPushMessage(lobbyCode)}
                                            maxLength={140}
                                            rows={2}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white resize-none focus:outline-none focus:border-indigo-500 mb-2"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => sendOfflineInvite(p)}
                                                disabled={busy || sendingPushFor === p.id}
                                                className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1.5"
                                            >
                                                {sendingPushFor === p.id
                                                    ? <Loader2 size={13} className="animate-spin" />
                                                    : <Send size={13} />}
                                                {messageDraft.trim() ? 'Eigene Nachricht senden' : 'Standardnachricht senden'}
                                            </button>
                                            <button
                                                onClick={() => setComposeFor(null)}
                                                disabled={sendingPushFor === p.id}
                                                className="px-3 text-slate-400 hover:text-white text-xs rounded-lg transition-colors"
                                            >
                                                Abbrechen
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
