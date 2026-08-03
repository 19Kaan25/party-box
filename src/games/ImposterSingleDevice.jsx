/* =====================================================================
 *  Imposter auf EINEM Handy ("pass the phone").
 *
 *  Der komplette Rundenablauf laeuft auf dem Geraet des Hosts. Alle anderen
 *  Lobby-Mitglieder sehen nur "Spiel laeuft...".
 *
 *  WICHTIG -- warum so wenig auf dem Server liegt:
 *  Wort, Rollenverteilung, Aufdeck-Fortschritt und Votum bleiben im lokalen
 *  React-State. Sie gehen NICHT ueber die Bridge, weil
 *    a) sonst jeder Client das Geheimwort im Speicher haette, obwohl niemand
 *       ausser dem Host ueberhaupt mitspielt, und
 *    b) jedes Umblaettern sonst ein RPC + Realtime-Refetch waere -- auf einem
 *       weitergereichten Handy spuerbar traege.
 *
 *  Auf dem Server landen nur die nicht geheimen Daten, und zwar in genau
 *  vier Schreibvorgaengen:
 *    1. Runde starten        -> gameState.phase = 'SINGLE_RUNNING' + roster
 *    2. Ergebnis             -> usedImposterWords + players (Punkte)
 *    3. Einstellungen aendern-> gameState.phase = 'SETUP' + roster
 *    4. Zurueck zur Lobby    -> updateLobbyStatus('LOBBY_WAITING', ...)
 *
 *  Ein Patch mit status 'LOBBY_WAITING' beendet die games-Zeile und wirft
 *  gameState weg -- deshalb fassen "Naechste Runde" und "Einstellungen
 *  aendern" die Lobby nie an, damit die Mitspielerliste erhalten bleibt.
 * ===================================================================== */

import React, { useState, useRef } from 'react';
import {
    VenetianMask, Ghost, Shield, Users, Settings, Plus, X,
    GripVertical, ChevronUp, ChevronDown, Crown, Trophy, Check, Smartphone
} from 'lucide-react';

import { doc, updateDoc, arrayUnion } from '../lib/firestoreBridge';
import GameHeader from '../components/GameHeader';
import { CategoryPicker, CustomWordManager } from './ImposterSetupPanels';
import { buildWordPool, categoryNameOfWord } from './imposterWords';
import { shuffleArray } from '../utils/helpers';

const MAX_ROSTER = 20;
const NAME_MAX = 20;

/** Gespeicherte Liste bevorzugen, sonst alle Lobby-Mitglieder in Beitrittsreihenfolge. */
const seedRoster = (saved, lobbyPlayers) => {
    if (Array.isArray(saved) && saved.length > 0) {
        return saved.map(r => ({ key: r.key, name: r.name, userId: r.userId ?? null }));
    }
    return lobbyPlayers.map(p => ({ key: p.id, name: p.name, userId: p.id }));
};

const newGuestKey = () =>
    (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? `guest-${crypto.randomUUID()}`
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/* ---------------------------------------------------------------------
 * Sortierbare Mitspielerliste.
 *
 * Pointer Events statt HTML5-Drag-and-Drop: mobile Browser feuern kein
 * dragstart, und dieses Feature ist ausdruecklich handy-first. Die
 * Chevron-Buttons bleiben als robuster Zweitweg (Touch, kleine Displays).
 * ------------------------------------------------------------------- */
function RosterEditor({ items, myUserId, onReorder, onRemove }) {
    const [dragKey, setDragKey] = useState(null);
    const [dragOffset, setDragOffset] = useState(0);
    const listRef = useRef(null);
    const dragInfo = useRef({ startY: 0, index: 0, rowHeight: 0 });

    // Zeilenabstand exakt messen: Abstand der ersten beiden Zeilen inklusive
    // Gap. Nur mit der reinen Zeilenhoehe wuerde das Ziel nach ein paar
    // Zeilen auseinanderlaufen.
    const measureRowHeight = () => {
        const rows = listRef.current?.children;
        if (!rows || rows.length === 0) return 56;
        if (rows.length > 1) {
            return rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
        }
        return rows[0].getBoundingClientRect().height;
    };

    const handlePointerDown = (e, index) => {
        dragInfo.current = { startY: e.clientY, index, rowHeight: measureRowHeight() };
        setDragKey(items[index].key);
        setDragOffset(0);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        if (!dragKey) return;
        const { index, rowHeight, startY } = dragInfo.current;
        const dy = e.clientY - startY;
        const steps = rowHeight > 0 ? Math.round(dy / rowHeight) : 0;
        const target = Math.max(0, Math.min(items.length - 1, index + steps));

        if (target !== index) {
            // Basislinie mitziehen, damit die Zeile unter dem Finger bleibt.
            const nextStartY = startY + (target - index) * rowHeight;
            dragInfo.current = { startY: nextStartY, index: target, rowHeight };
            onReorder(index, target);
            setDragOffset(e.clientY - nextStartY);
        } else {
            setDragOffset(dy);
        }
    };

    const endDrag = (e) => {
        if (!dragKey) return;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragKey(null);
        setDragOffset(0);
    };

    return (
        <div ref={listRef} className="space-y-2">
            {items.map((item, index) => {
                const isDragging = item.key === dragKey;
                return (
                    <div
                        key={item.key}
                        style={isDragging ? { transform: `translateY(${dragOffset}px)`, position: 'relative', zIndex: 20 } : undefined}
                        className={`flex items-center gap-2 p-2 sm:p-3 rounded-xl border transition-colors ${
                            isDragging
                                ? 'border-emerald-500 bg-slate-800 shadow-xl shadow-black/40'
                                : 'border-slate-700 bg-slate-900/60'
                        }`}
                    >
                        <span
                            onPointerDown={(e) => handlePointerDown(e, index)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            style={{ touchAction: 'none' }}
                            title="Zum Sortieren ziehen"
                            className="shrink-0 text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing p-1"
                        >
                            <GripVertical size={18} />
                        </span>

                        <span className="shrink-0 w-6 text-center text-xs font-bold text-slate-500">{index + 1}</span>

                        <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-xs text-white">
                            {(item.name || '?').charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-slate-200 [overflow-wrap:anywhere]">
                                {item.name}
                                {item.userId === myUserId && <span className="text-slate-400 font-medium"> (Du)</span>}
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">
                                {item.userId ? 'Lobby' : 'Gast'}
                            </p>
                        </div>

                        <div className="flex items-center shrink-0">
                            <button
                                onClick={() => onReorder(index, index - 1)}
                                disabled={index === 0}
                                title="Nach oben"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                                <ChevronUp size={16} />
                            </button>
                            <button
                                onClick={() => onReorder(index, index + 1)}
                                disabled={index === items.length - 1}
                                title="Nach unten"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                                <ChevronDown size={16} />
                            </button>
                            <button
                                onClick={() => onRemove(item.key)}
                                title="Spielt nicht mit"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                );
            })}
            {items.length === 0 && (
                <p className="text-sm text-slate-500 italic py-4 text-center">Niemand ausgewählt.</p>
            )}
        </div>
    );
}

export default function ImposterSingleDevice({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode, customImposterWords = [], usedImposterWords = [] } = lobby;
    const settings = gameState.settings || {};

    // Alle Hooks ganz oben -- die Phasen sind bedingte Returns (Engine-Konvention).
    const [step, setStep] = useState('SETUP');
    const [roster, setRoster] = useState(() => seedRoster(gameState.roster, players));
    const [guestInput, setGuestInput] = useState('');
    const [round, setRound] = useState(null);
    const [revealIndex, setRevealIndex] = useState(0);
    const [revealStage, setRevealStage] = useState('HANDOFF');
    const [votedOutKey, setVotedOutKey] = useState(null);
    const [guessed, setGuessed] = useState({});
    const [sessionUsed, setSessionUsed] = useState([]);
    const [summary, setSummary] = useState(null);

    // ---------------------------------------------------------
    // NICHT-HOST: das Spiel laeuft woanders
    // ---------------------------------------------------------
    if (!isHost) {
        const list = gameState.roster || [];
        const running = gameState.phase === 'SINGLE_RUNNING';
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={false} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-12 bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-xl text-center">
                    <VenetianMask size={56} className="mx-auto text-emerald-400 mb-4" />
                    <h2 className="text-2xl font-bold">{running ? 'Spiel läuft...' : 'Der Host richtet ein...'}</h2>
                    <p className="text-slate-400 text-sm mt-3">
                        Imposter läuft diese Runde auf einem einzigen Handy. Schau auf das Gerät des Hosts.
                    </p>
                    <div className="flex justify-center gap-1.5 mt-6">
                        {[0, 1, 2].map(i => (
                            <span
                                key={i}
                                className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"
                                style={{ animationDelay: `${i * 150}ms` }}
                            />
                        ))}
                    </div>

                    {list.length > 0 && (
                        <div className="mt-8 bg-slate-900 rounded-2xl p-4 border border-slate-700 text-left">
                            <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-3">Mitspieler</p>
                            <ol className="space-y-1.5">
                                {list.map((r, i) => (
                                    <li key={r.key} className="text-sm text-slate-300 flex gap-2">
                                        <span className="text-slate-600 w-4 text-right shrink-0">{i + 1}.</span>
                                        <span className="[overflow-wrap:anywhere]">{r.name}</span>
                                    </li>
                                ))}
                            </ol>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // ABGELEITETE WERTE
    // ---------------------------------------------------------
    const selectedCategories = settings.selectedCategories || [];
    const wordPool = buildWordPool(selectedCategories, customImposterWords);
    // Imposter duerfen nie in der Ueberzahl sein.
    const maxImposters = Math.min(3, Math.max(1, Math.floor((roster.length - 1) / 2)));
    const imposterCount = Math.min(settings.imposterCount || 1, maxImposters);
    const scoringOn = !!lobby.settings?.globalLeaderboard;
    const isLobbyMember = (userId) => !!userId && players.some(p => p.id === userId);
    const nameOf = (key) => roster.find(r => r.key === key)?.name || 'Unbekannt';

    // ---------------------------------------------------------
    // EINSTELLUNGEN (Server) -- nur waehrend SETUP
    // ---------------------------------------------------------
    const updateSetupSettings = async (newSettings) => {
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.settings': { ...settings, ...newSettings }
        });
    };

    const toggleCategory = (catId) => {
        const next = selectedCategories.includes(catId)
            ? selectedCategories.filter(id => id !== catId)
            : [...selectedCategories, catId];
        updateSetupSettings({ selectedCategories: next });
    };

    // Zurueck auf Mehrgeraete. Die Phase muss mit zurueckgesetzt werden: nach
    // einem Reload waehrend der Runde steht dort noch 'SINGLE_RUNNING', und
    // darauf greift auch die Weiche in ImposterEngine.jsx.
    const switchToMultiDevice = async () => {
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.settings': { ...settings, mode: 'MULTI' },
            'gameState.phase': 'SETUP'
        });
    };

    // ---------------------------------------------------------
    // MITSPIELERLISTE (nur lokal, wird erst beim Rundenstart persistiert)
    // ---------------------------------------------------------
    const moveRosterItem = (from, to) => {
        if (to < 0 || to >= roster.length || from === to) return;
        setRoster(prev => {
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    };

    const removeFromRoster = (key) => setRoster(prev => prev.filter(r => r.key !== key));

    const addLobbyMember = (player) => {
        if (roster.length >= MAX_ROSTER) return;
        setRoster(prev => [...prev, { key: player.id, name: player.name, userId: player.id }]);
    };

    const addGuest = () => {
        const name = guestInput.trim().slice(0, NAME_MAX);
        if (!name || roster.length >= MAX_ROSTER) return;
        setRoster(prev => [...prev, { key: newGuestKey(), name, userId: null }]);
        setGuestInput('');
    };

    const missingMembers = players.filter(p => !roster.some(r => r.userId === p.id));

    // ---------------------------------------------------------
    // RUNDENSTART
    // ---------------------------------------------------------
    const startRound = async () => {
        if (roster.length < 3 || wordPool.length === 0) return;

        // Bereits gespielte Woerter meiden -- lobbyweit und innerhalb dieser Sitzung.
        const blocked = [...usedImposterWords, ...sessionUsed];
        const fresh = wordPool.filter(w => !blocked.includes(w));
        const poolToUse = fresh.length > 0 ? fresh : wordPool;
        const word = poolToUse[Math.floor(Math.random() * poolToUse.length)];

        const count = Math.min(imposterCount, Math.max(1, Math.floor((roster.length - 1) / 2)));
        const imposterKeys = shuffleArray(roster.map(r => r.key)).slice(0, count);

        setRound({
            word,
            categoryName: categoryNameOfWord(word, selectedCategories),
            imposterKeys,
            startIndex: Math.floor(Math.random() * roster.length)   // wer anfaengt, ist jede Runde neu ausgewuerfelt
        });
        setSessionUsed(prev => [...prev, word]);
        setRevealIndex(0);
        setRevealStage('HANDOFF');
        setVotedOutKey(null);
        setGuessed({});
        setSummary(null);
        setStep('REVEAL');

        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.phase': 'SINGLE_RUNNING',
            'gameState.roster': roster
        });
    };

    // ---------------------------------------------------------
    // ERGEBNIS: Punkte verteilen (nur hier, nie in einem Effekt --
    // sonst koennte eine Neuberechnung doppelt gutschreiben)
    // ---------------------------------------------------------
    const finishRound = async () => {
        const caught = !!votedOutKey && round.imposterKeys.includes(votedOutKey);
        const delta = new Map();

        if (scoringOn) {
            if (caught) {
                // +1 fuer jedes mitspielende Lobby-Mitglied ausser den Impostern.
                roster.forEach(r => {
                    if (isLobbyMember(r.userId) && !round.imposterKeys.includes(r.key)) {
                        delta.set(r.userId, (delta.get(r.userId) ?? 0) + 1);
                    }
                });
            }
            // +3 fuer jeden Imposter, der das Wort erraten hat. Gaeste ohne
            // Account bekommen nichts -- sie haben keinen Punktestand.
            round.imposterKeys.forEach(key => {
                const entry = roster.find(r => r.key === key);
                if (entry && isLobbyMember(entry.userId) && guessed[key]) {
                    delta.set(entry.userId, (delta.get(entry.userId) ?? 0) + 3);
                }
            });
        }

        const patch = { usedImposterWords: arrayUnion(round.word) };
        if (delta.size > 0) {
            // Der Server spiegelt players[].globalScore absolut nach
            // lobby_members.score -- wie in den anderen vier Engines.
            patch.players = players.map(p => ({
                ...p,
                globalScore: (p.globalScore ?? 0) + (delta.get(p.id) ?? 0)
            }));
        }

        setSummary({
            caught,
            entries: roster
                .filter(r => delta.has(r.userId))
                .map(r => ({ key: r.key, name: r.name, points: delta.get(r.userId) }))
        });
        setStep('RESULT');

        await updateDoc(doc(db, 'lobbies', lobbyCode), patch);
    };

    const backToSetup = async () => {
        setStep('SETUP');
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.phase': 'SETUP',
            'gameState.roster': roster
        });
    };

    // ---------------------------------------------------------
    // RENDERING: SETUP
    // ---------------------------------------------------------
    if (step === 'SETUP') {
        const blockReason = roster.length < 3
            ? 'Mindestens 3 Mitspieler nötig.'
            : (wordPool.length === 0 ? 'Keine Wörter im Pool – wähle eine Kategorie oder lege eigene Wörter an.' : null);

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-4xl mx-auto mt-8">
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-bold text-emerald-400 flex items-center justify-center gap-2">
                            <VenetianMask size={32} /> Imposter Setup
                        </h2>
                        <p className="text-slate-400 mt-2">Ein Handy für alle – wird reihum weitergegeben</p>
                    </div>

                    {/* Modus-Umschalter */}
                    <div className="bg-slate-800 rounded-3xl p-4 border border-slate-700 shadow-xl mb-6">
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                onClick={switchToMultiDevice}
                                className="p-3 rounded-xl border-2 border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500 transition-all"
                            >
                                <span className="block font-bold text-sm">Jeder sein Handy</span>
                                <span className="text-[10px] opacity-60">Alle in der Lobby spielen mit</span>
                            </button>
                            <button
                                className="p-3 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-white transition-all"
                            >
                                <span className="font-bold text-sm flex items-center gap-1.5"><Smartphone size={14} /> Ein Handy</span>
                                <span className="text-[10px] opacity-60">Karten reihum aufdecken</span>
                            </button>
                        </div>
                    </div>

                    {/* Mitspieler */}
                    <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl mb-6">
                        <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
                            <Users className="text-indigo-400" size={20} /> Mitspieler ({roster.length})
                        </h3>
                        <p className="text-xs text-slate-500 mb-4">
                            In dieser Reihenfolge wird das Handy weitergegeben. Zum Sortieren am Griff ziehen.
                        </p>

                        <RosterEditor
                            items={roster}
                            myUserId={user.uid}
                            onReorder={moveRosterItem}
                            onRemove={removeFromRoster}
                        />

                        {missingMembers.length > 0 && (
                            <div className="mt-5 pt-4 border-t border-slate-700">
                                <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2">Nicht dabei</p>
                                <div className="flex flex-wrap gap-2">
                                    {missingMembers.map(p => (
                                        <button
                                            key={p.id}
                                            onClick={() => addLobbyMember(p)}
                                            className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 hover:border-emerald-500 px-3 py-1.5 rounded-lg text-xs transition-colors"
                                        >
                                            <Plus size={12} className="text-emerald-400" />
                                            <span className="[overflow-wrap:anywhere]">{p.name}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-5 pt-4 border-t border-slate-700">
                            <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2">Gast hinzufügen</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={guestInput}
                                    maxLength={NAME_MAX}
                                    onChange={(e) => setGuestInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') addGuest(); }}
                                    placeholder="Name ohne Account..."
                                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                                />
                                <button
                                    onClick={addGuest}
                                    disabled={!guestInput.trim() || roster.length >= MAX_ROSTER}
                                    className="bg-emerald-600 p-2 rounded-lg hover:bg-emerald-500 disabled:opacity-40 transition-colors"
                                >
                                    <Plus size={20} />
                                </button>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-2">
                                Gäste spielen mit, bekommen aber keine globalen Punkte.
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Kategorien */}
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Shield className="text-blue-400" size={20} /> Kategorien
                            </h3>
                            <CategoryPicker
                                selected={selectedCategories}
                                onToggle={toggleCategory}
                                customWordCount={customImposterWords.length}
                            />
                        </div>

                        <div className="space-y-6">
                            {/* Regeln */}
                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Settings className="text-orange-400" size={20} /> Spielregeln
                                </h3>
                                <div className="space-y-5">
                                    <div>
                                        <label className="text-sm text-slate-400 flex justify-between">
                                            <span>Anzahl Imposter</span>
                                            <span className="font-bold text-white">{imposterCount}</span>
                                        </label>
                                        <input
                                            type="range" min="1" max={maxImposters} step="1"
                                            value={imposterCount}
                                            onChange={(e) => updateSetupSettings({ imposterCount: parseInt(e.target.value) })}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 mt-2"
                                        />
                                        <p className="text-[10px] text-slate-500 mt-1">Höchstens {maxImposters} bei {roster.length} Mitspielern.</p>
                                    </div>

                                    <div>
                                        <p className="text-sm text-slate-400 mb-2">Der Imposter sieht...</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            {[
                                                { id: 'none', label: 'Nichts', hint: 'Nur "Imposter"' },
                                                { id: 'category', label: 'Kategorie', hint: 'Leichter zu bluffen' }
                                            ].map(opt => {
                                                const active = (settings.imposterHint || 'none') === opt.id;
                                                return (
                                                    <button
                                                        key={opt.id}
                                                        onClick={() => updateSetupSettings({ imposterHint: opt.id })}
                                                        className={`p-3 rounded-xl border-2 transition-all text-left ${
                                                            active
                                                                ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                                                : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'
                                                        }`}
                                                    >
                                                        <span className="block font-bold text-sm">{opt.label}</span>
                                                        <span className="text-[10px] opacity-60">{opt.hint}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Eigene Woerter */}
                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Plus className="text-purple-400" size={20} /> Eigene Wörter
                                </h3>
                                <CustomWordManager lobbyCode={lobbyCode} words={customImposterWords} isHost={isHost} />
                            </div>
                        </div>
                    </div>

                    {blockReason && (
                        <p className="text-center text-sm text-amber-400 mt-6">{blockReason}</p>
                    )}

                    <button
                        onClick={startRound}
                        disabled={!!blockReason}
                        className="w-full mt-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-95"
                    >
                        Runde starten
                    </button>
                </div>
            </div>
        );
    }

    // Ohne Runde gibt es nichts zu rendern (z.B. nach einem Reload mitten im Spiel).
    if (!round) {
        return (
            <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 text-center">
                    <Ghost size={48} className="mx-auto text-slate-500 mb-4" />
                    <p className="text-slate-300 mb-6">Die Runde ist nicht mehr verfügbar.</p>
                    <button onClick={backToSetup} className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl hover:bg-slate-200 transition-all">
                        Zurück zum Setup
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: KARTEN AUFDECKEN (Handy wandert)
    // ---------------------------------------------------------
    if (step === 'REVEAL') {
        const current = roster[revealIndex];
        const isLast = revealIndex === roster.length - 1;
        const isImposter = current ? round.imposterKeys.includes(current.key) : false;

        if (!current) {
            return (
                <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-6">
                    <button onClick={() => setStep('ORDER')} className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl">
                        Weiter
                    </button>
                </div>
            );
        }

        // Bildschirm 1: Uebergabe. Hier steht nichts Geheimes.
        if (revealStage === 'HANDOFF') {
            return (
                <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
                    <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                        <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-6">
                            Spieler {revealIndex + 1} von {roster.length}
                        </p>
                        <Smartphone size={56} className="mx-auto text-emerald-400 mb-4 animate-bounce" />
                        <p className="text-slate-400">Gib das Handy weiter an</p>
                        <h2 className="text-4xl font-black text-white mt-2 mb-8 [overflow-wrap:anywhere]">{current.name}</h2>

                        <button
                            onClick={() => setRevealStage('HIDDEN')}
                            className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                        >
                            Ich bin {current.name}
                        </button>
                        <p className="text-xs text-slate-500 mt-6 italic">Achte darauf, dass niemand mitschaut!</p>
                    </div>
                </div>
            );
        }

        // Bildschirm 2: die Karte. Imposter- und Unschuldig-Karte haben exakt
        // dasselbe Layout, damit ein Blick von der Seite nichts verraet.
        const shown = revealStage === 'SHOWN';
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-6 text-white [overflow-wrap:anywhere]">{current.name}</h2>

                    <div
                        onClick={() => { if (!shown) setRevealStage('SHOWN'); }}
                        className={`aspect-square rounded-2xl flex flex-col items-center justify-center p-4 transition-all duration-500 transform border-4 border-dashed ${
                            shown
                                ? (isImposter ? 'bg-red-500/20 border-red-500' : 'bg-emerald-500/20 border-emerald-500')
                                : 'bg-slate-700 border-slate-600 cursor-pointer'
                        }`}
                    >
                        {!shown ? (
                            <>
                                <Ghost size={64} className="text-slate-500 mb-4 animate-bounce" />
                                <p className="font-bold text-slate-400">Tippen zum Aufdecken</p>
                            </>
                        ) : (
                            <div className="animate-in zoom-in-50">
                                {isImposter ? (
                                    <>
                                        <VenetianMask size={72} className="text-red-500 mb-3 mx-auto" />
                                        <h3 className="text-4xl font-black text-red-500 uppercase tracking-tighter">IMPOSTER</h3>
                                        {(settings.imposterHint || 'none') === 'category' ? (
                                            <>
                                                <p className="text-slate-400 text-sm mt-4">Kategorie:</p>
                                                <div className="text-xl font-black text-white mt-1 bg-slate-900 px-4 py-2 rounded-xl border border-red-500/30">
                                                    {round.categoryName}
                                                </div>
                                            </>
                                        ) : (
                                            <p className="text-slate-300 mt-4 px-2 text-sm font-medium">
                                                Tu so, als kenntest du das Wort!
                                            </p>
                                        )}
                                    </>
                                ) : (
                                    <>
                                        <Shield size={72} className="text-emerald-500 mb-3 mx-auto" />
                                        <h3 className="text-2xl font-bold text-emerald-400 mb-2">UNSCHULDIG</h3>
                                        <p className="text-slate-400 text-sm">Das Geheimwort lautet:</p>
                                        <div className="text-2xl font-black text-white mt-1 bg-slate-900 px-4 py-2 rounded-xl border border-emerald-500/30 [overflow-wrap:anywhere]">
                                            {round.word}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <button
                        onClick={() => {
                            if (isLast) {
                                setStep('ORDER');
                            } else {
                                setRevealIndex(revealIndex + 1);
                            }
                            setRevealStage('HANDOFF');
                        }}
                        disabled={!shown}
                        className="w-full mt-8 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-white py-4 rounded-2xl font-bold transition-all active:scale-95"
                    >
                        {isLast ? 'Gesehen – alle sind fertig' : 'Gesehen – weitergeben'}
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: REIHENFOLGE & STARTSPIELER
    // ---------------------------------------------------------
    if (step === 'ORDER') {
        const starter = roster[round.startIndex] || roster[0];
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-8 bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl">
                    <div className="text-center mb-8">
                        <Crown size={48} className="mx-auto text-yellow-400 mb-3" />
                        <p className="text-slate-400 text-sm">Es beginnt</p>
                        <h2 className="text-3xl font-black text-white [overflow-wrap:anywhere]">{starter.name}</h2>
                        <p className="text-slate-400 text-sm mt-3">
                            Jeder sagt reihum ein Wort, das zum Geheimwort passt – ohne es zu verraten.
                        </p>
                    </div>

                    <div className="space-y-2">
                        {roster.map((r, i) => {
                            const isStarter = i === round.startIndex;
                            return (
                                <div
                                    key={r.key}
                                    className={`flex items-center gap-3 p-3 rounded-xl border ${
                                        isStarter ? 'border-yellow-500 bg-yellow-500/10' : 'border-slate-700 bg-slate-900/60'
                                    }`}
                                >
                                    <span className="w-6 text-center text-xs font-bold text-slate-500">{i + 1}</span>
                                    <span className="flex-1 font-bold text-sm text-slate-200 [overflow-wrap:anywhere]">{r.name}</span>
                                    {isStarter && (
                                        <span className="flex items-center gap-1 text-[10px] uppercase font-bold tracking-wider text-yellow-400 whitespace-nowrap">
                                            <Crown size={12} /> beginnt
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => setStep('VOTE')}
                        className="w-full mt-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                    >
                        Weiter zur Abstimmung
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: ABSTIMMUNG (der Host traegt das Ergebnis ein)
    // ---------------------------------------------------------
    if (step === 'VOTE') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-8 bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl">
                    <h2 className="text-2xl font-bold text-center mb-1">Wer wurde rausgewählt?</h2>
                    <p className="text-slate-400 text-sm text-center mb-6">
                        Zählt gemeinsam bis drei, zeigt auf einen Verdächtigen und tippt ihn hier an.
                    </p>

                    <div className="space-y-2">
                        {roster.map(r => {
                            const selected = votedOutKey === r.key;
                            return (
                                <button
                                    key={r.key}
                                    onClick={() => setVotedOutKey(r.key)}
                                    className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                                        selected
                                            ? 'border-emerald-500 bg-emerald-500/10'
                                            : 'border-slate-700 bg-slate-900/60 hover:border-slate-500'
                                    }`}
                                >
                                    <div className="w-9 h-9 shrink-0 rounded-full bg-slate-700 flex items-center justify-center font-bold text-sm">
                                        {(r.name || '?').charAt(0).toUpperCase()}
                                    </div>
                                    <span className="flex-1 font-bold text-slate-200 [overflow-wrap:anywhere]">{r.name}</span>
                                    {selected && <Check size={20} className="text-emerald-500 shrink-0" />}
                                </button>
                            );
                        })}
                    </div>

                    <button
                        onClick={() => setStep('RESOLVE')}
                        disabled={!votedOutKey}
                        className="w-full mt-8 bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed py-4 rounded-2xl text-white font-bold shadow-lg transition-all active:scale-95"
                    >
                        Auflösen
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: AUFLOESUNG DER ABSTIMMUNG
    // Das Geheimwort bleibt hier noch verdeckt -- der Imposter soll erst
    // raten, bevor es auf dem Schirm steht.
    // ---------------------------------------------------------
    if (step === 'RESOLVE') {
        const caught = round.imposterKeys.includes(votedOutKey);
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex items-center justify-center">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <div className={`w-24 h-24 mx-auto rounded-full flex items-center justify-center mb-6 border-2 ${
                        caught ? 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/20' : 'bg-emerald-500/20 border-emerald-500'
                    }`}>
                        {caught ? <VenetianMask size={44} className="text-red-500" /> : <Shield size={44} className="text-emerald-500" />}
                    </div>

                    <h2 className="text-2xl font-bold [overflow-wrap:anywhere]">{nameOf(votedOutKey)}</h2>
                    <p className={`text-3xl font-black uppercase tracking-tighter mt-2 ${caught ? 'text-red-500' : 'text-emerald-400'}`}>
                        {caught ? 'war Imposter' : 'war unschuldig'}
                    </p>

                    <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700 mt-8 text-left">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2">
                            {round.imposterKeys.length > 1 ? 'Die Imposter waren' : 'Der Imposter war'}
                        </p>
                        {round.imposterKeys.map(key => (
                            <p key={key} className="font-bold text-red-400 [overflow-wrap:anywhere]">{nameOf(key)}</p>
                        ))}
                    </div>

                    <p className="text-slate-400 text-sm mt-6">
                        Letzte Chance: {round.imposterKeys.length > 1 ? 'die Imposter sagen' : 'der Imposter sagt'} jetzt laut, welches Wort gesucht war.
                    </p>

                    <button
                        onClick={() => setStep('GUESS')}
                        className="w-full mt-6 bg-slate-700 hover:bg-slate-600 text-white py-4 rounded-2xl font-bold transition-all active:scale-95"
                    >
                        Weiter
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: HAT DER IMPOSTER DAS WORT ERRATEN?
    // ---------------------------------------------------------
    if (step === 'GUESS') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-6 flex items-center justify-center">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl">
                    <h2 className="text-2xl font-bold text-center mb-2">Wort erraten?</h2>
                    <p className="text-slate-400 text-sm text-center mb-8">
                        Wer richtig geraten hat, bekommt 3 Punkte.
                    </p>

                    <div className="space-y-4">
                        {round.imposterKeys.map(key => {
                            const yes = !!guessed[key];
                            return (
                                <div key={key} className="bg-slate-900 rounded-2xl p-4 border border-slate-700">
                                    <p className="font-bold mb-3 [overflow-wrap:anywhere]">
                                        Hat <span className="text-red-400">{nameOf(key)}</span> das Wort erraten?
                                    </p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <button
                                            onClick={() => setGuessed(prev => ({ ...prev, [key]: true }))}
                                            className={`py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                                                yes ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500'
                                            }`}
                                        >
                                            Ja
                                        </button>
                                        <button
                                            onClick={() => setGuessed(prev => ({ ...prev, [key]: false }))}
                                            className={`py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                                                !yes ? 'border-slate-400 bg-slate-700/40 text-white' : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500'
                                            }`}
                                        >
                                            Nein
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        onClick={finishRound}
                        className="w-full mt-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                    >
                        Ergebnis anzeigen
                    </button>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: ERGEBNIS
    // ---------------------------------------------------------
    if (step === 'RESULT') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-4 bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl">
                    <h2 className="text-4xl font-black text-center mb-6 text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
                        AUFLÖSUNG
                    </h2>

                    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 text-center">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-1">Das geheime Wort war</p>
                        <p className="text-3xl font-black text-emerald-400 tracking-tight [overflow-wrap:anywhere]">{round.word}</p>
                        <p className="text-xs text-slate-500 mt-2">{round.categoryName}</p>
                    </div>

                    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 mt-4">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2">
                            {round.imposterKeys.length > 1 ? 'Die Imposter' : 'Der Imposter'}
                        </p>
                        {round.imposterKeys.map(key => (
                            <div key={key} className="flex items-center justify-between gap-2 py-1">
                                <span className="font-bold text-red-400 [overflow-wrap:anywhere]">{nameOf(key)}</span>
                                <span className={`text-xs font-bold whitespace-nowrap ${guessed[key] ? 'text-emerald-400' : 'text-slate-500'}`}>
                                    {guessed[key] ? 'Wort erraten' : 'nicht erraten'}
                                </span>
                            </div>
                        ))}
                        <div className="border-t border-slate-700 mt-3 pt-3 text-sm">
                            <span className="text-slate-400">Rausgewählt: </span>
                            <span className="font-bold [overflow-wrap:anywhere]">{nameOf(votedOutKey)}</span>
                            <span className={`ml-2 text-xs font-bold ${summary?.caught ? 'text-emerald-400' : 'text-red-400'}`}>
                                {summary?.caught ? 'richtig' : 'daneben'}
                            </span>
                        </div>
                    </div>

                    <div className="bg-slate-900 rounded-2xl p-5 border border-slate-700 mt-4">
                        <p className="text-xs text-slate-500 uppercase font-bold tracking-widest mb-2 flex items-center gap-1.5">
                            <Trophy size={12} className="text-yellow-500" /> Globale Punkte
                        </p>
                        {!scoringOn ? (
                            <p className="text-sm text-slate-500 italic">Globales Scoring ist aus.</p>
                        ) : summary && summary.entries.length > 0 ? (
                            <div className="space-y-1">
                                {summary.entries.map(entry => (
                                    <div key={entry.key} className="flex items-center justify-between gap-2 text-sm">
                                        <span className="text-slate-300 [overflow-wrap:anywhere]">{entry.name}</span>
                                        <span className="font-bold text-yellow-400 whitespace-nowrap">+{entry.points}</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-sm text-slate-500 italic">Diese Runde gab es keine Punkte.</p>
                        )}
                    </div>

                    <button
                        onClick={startRound}
                        className="w-full mt-6 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold py-4 rounded-2xl shadow-lg transition-all active:scale-95"
                    >
                        Nächste Runde
                    </button>
                    <button
                        onClick={backToSetup}
                        className="w-full mt-3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-2xl transition-all active:scale-95"
                    >
                        Einstellungen ändern
                    </button>
                    <button
                        onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })}
                        className="w-full mt-3 text-slate-400 hover:text-white text-sm py-2 transition-colors"
                    >
                        Zurück zur Lobby
                    </button>
                </div>
            </div>
        );
    }

    return null;
}
