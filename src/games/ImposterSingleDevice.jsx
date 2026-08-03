/* =====================================================================
 *  Imposter auf EINEM Handy ("pass the phone").
 *
 *  Der komplette Rundenablauf laeuft auf dem Geraet des Hosts. Alle anderen
 *  Lobby-Mitglieder sehen nur "Spiel laeuft...".
 *
 *  Zustandshaltung: lokaler State ZUERST, Server hinterher.
 *  Jeder Schritt setzt sofort den React-State (damit ein weitergereichtes
 *  Handy nicht auf einen Roundtrip wartet) und spiegelt ihn danach nach
 *  gameState.sd. Beim Mounten wird der lokale State aus gameState.sd
 *  vorbelegt -- laedt der Host mitten in der Runde neu, geht es genau dort
 *  weiter. Der Host bleibt waehrend der Runde die Wahrheit; die Serverkopie
 *  ist reine Wiederherstellung.
 *
 *  gameState.sd = { step, roster, round, revealIndex, revealStage,
 *                   votedOutKey, guessed, sessionUsed, summary }
 *  gameState.phase = 'SETUP' | 'SINGLE_RUNNING'  -- daran haengt der
 *  Nicht-Host-Schirm und die Weiche in ImposterEngine.jsx.
 *
 *  Dass damit auch das Geheimwort bei allen Clients liegt, ist bewusst in
 *  Kauf genommen (Freundes-/Familienkreis) -- genau wie im Mehrgeraete-Modus.
 *
 *  FALLE: Ein Patch mit status 'LOBBY_WAITING' beendet die games-Zeile und
 *  wirft gameState weg -- deshalb fassen "Naechste Runde" und "Einstellungen
 *  aendern" die Lobby nie an, damit die Mitspielerliste erhalten bleibt.
 * ===================================================================== */

import React, { useState } from 'react';
import {
    VenetianMask, Ghost, Shield, Settings, Plus, Crown, Trophy, Check, Smartphone
} from 'lucide-react';

import { doc, updateDoc, arrayUnion } from '../lib/firestoreBridge';
import GameHeader from '../components/GameHeader';
import RosterPanel from '../components/RosterPanel';
import { CategoryPicker, CustomWordManager } from './ImposterSetupPanels';
import { buildWordPool, categoryNameOfWord } from './imposterWords';
import { shuffleArray } from '../utils/helpers';
import { seedRoster } from '../utils/roster';

export default function ImposterSingleDevice({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode, customImposterWords = [], usedImposterWords = [] } = lobby;
    const settings = gameState.settings || {};
    // Gespiegelter Fortschritt. Wird NUR beim Mounten gelesen (Wiederherstellung
    // nach einem Reload) -- waehrend der Runde fuehrt der lokale State.
    const saved = gameState.sd || {};

    // Alle Hooks ganz oben -- die Phasen sind bedingte Returns (Engine-Konvention).
    const [step, setStep] = useState(saved.step || 'SETUP');
    const [roster, setRoster] = useState(() => seedRoster(saved.roster, players));
    const [round, setRound] = useState(saved.round || null);
    const [revealIndex, setRevealIndex] = useState(saved.revealIndex || 0);
    const [revealStage, setRevealStage] = useState(saved.revealStage || 'HANDOFF');
    const [votedOutKey, setVotedOutKey] = useState(saved.votedOutKey || null);
    const [guessed, setGuessed] = useState(saved.guessed || {});
    const [sessionUsed, setSessionUsed] = useState(saved.sessionUsed || []);
    const [summary, setSummary] = useState(saved.summary || null);

    // ---------------------------------------------------------
    // NICHT-HOST: das Spiel laeuft woanders
    // ---------------------------------------------------------
    if (!isHost) {
        const list = saved.roster || [];
        const running = gameState.phase === 'SINGLE_RUNNING';
        const statusText = {
            REVEAL: `Karten werden aufgedeckt (${Math.min((saved.revealIndex || 0) + 1, list.length || 1)} von ${list.length})`,
            ORDER: 'Die Reihenfolge steht – die Diskussion läuft',
            VOTE: 'Es wird abgestimmt',
            RESOLVE: 'Die Auflösung läuft',
            GUESS: 'Der Imposter darf raten',
            RESULT: 'Runde vorbei – der Host macht weiter'
        }[saved.step];
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={false} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-md mx-auto mt-12 bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-xl text-center">
                    <VenetianMask size={56} className="mx-auto text-emerald-400 mb-4" />
                    <h2 className="text-2xl font-bold">{running ? 'Spiel läuft...' : 'Der Host richtet ein...'}</h2>
                    <p className="text-slate-400 text-sm mt-3">
                        Imposter läuft diese Runde auf einem einzigen Handy. Schau auf das Gerät des Hosts.
                    </p>
                    {running && statusText && (
                        <p className="text-emerald-400 text-sm font-bold mt-4">{statusText}</p>
                    )}
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

    /**
     * Fortschritt nach gameState.sd spiegeln. Wird immer NACH dem lokalen
     * setState aufgerufen -- die Anzeige wartet nie auf den Roundtrip.
     * `extra` nimmt Keys ausserhalb von sd auf (phase, players, ...).
     */
    const persist = async (fields, extra = {}) => {
        const patch = { ...extra };
        Object.entries(fields).forEach(([key, value]) => {
            patch[`gameState.sd.${key}`] = value;
        });
        await updateDoc(doc(db, 'lobbies', lobbyCode), patch);
    };

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
    // MITSPIELERLISTE
    // ---------------------------------------------------------
    const applyRoster = (next, save = true) => {
        setRoster(next);
        if (save) persist({ roster: next });
    };

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
        const nextRound = {
            word,
            categoryName: categoryNameOfWord(word, selectedCategories),
            imposterKeys,
            startIndex: Math.floor(Math.random() * roster.length)   // wer anfaengt, ist jede Runde neu ausgewuerfelt
        };
        const nextUsed = [...sessionUsed, word];

        setRound(nextRound);
        setSessionUsed(nextUsed);
        setRevealIndex(0);
        setRevealStage('HANDOFF');
        setVotedOutKey(null);
        setGuessed({});
        setSummary(null);
        setStep('REVEAL');

        await persist(
            {
                step: 'REVEAL',
                roster,
                round: nextRound,
                revealIndex: 0,
                revealStage: 'HANDOFF',
                votedOutKey: null,
                guessed: {},
                sessionUsed: nextUsed,
                summary: null
            },
            { 'gameState.phase': 'SINGLE_RUNNING' }
        );
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

        const extra = { usedImposterWords: arrayUnion(round.word) };
        if (delta.size > 0) {
            // Der Server spiegelt players[].globalScore absolut nach
            // lobby_members.score -- wie in den anderen vier Engines.
            extra.players = players.map(p => ({
                ...p,
                globalScore: (p.globalScore ?? 0) + (delta.get(p.id) ?? 0)
            }));
        }

        const nextSummary = {
            caught,
            entries: roster
                .filter(r => delta.has(r.userId))
                .map(r => ({ key: r.key, name: r.name, points: delta.get(r.userId) }))
        };
        setSummary(nextSummary);
        setStep('RESULT');

        await persist({ step: 'RESULT', summary: nextSummary }, extra);
    };

    const backToSetup = async () => {
        setStep('SETUP');
        await persist({ step: 'SETUP', roster }, { 'gameState.phase': 'SETUP' });
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

                    <div className="mb-6">
                        <RosterPanel
                            roster={roster}
                            players={players}
                            myUserId={user.uid}
                            onChange={applyRoster}
                            hint="In dieser Reihenfolge wird das Handy weitergegeben. Zum Sortieren am Griff ziehen."
                        />
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
                    <button onClick={() => { setStep('ORDER'); persist({ step: 'ORDER' }); }} className="bg-white text-slate-900 font-bold px-6 py-3 rounded-xl">
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
                            onClick={() => { setRevealStage('HIDDEN'); persist({ revealStage: 'HIDDEN' }); }}
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
                        onClick={() => { if (!shown) { setRevealStage('SHOWN'); persist({ revealStage: 'SHOWN' }); } }}
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
                            const nextIndex = isLast ? revealIndex : revealIndex + 1;
                            const nextStep = isLast ? 'ORDER' : 'REVEAL';
                            if (isLast) setStep('ORDER'); else setRevealIndex(nextIndex);
                            setRevealStage('HANDOFF');
                            persist({ step: nextStep, revealIndex: nextIndex, revealStage: 'HANDOFF' });
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
                        onClick={() => { setStep('VOTE'); persist({ step: 'VOTE' }); }}
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
                                    onClick={() => { setVotedOutKey(r.key); persist({ votedOutKey: r.key }); }}
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
                        onClick={() => { setStep('RESOLVE'); persist({ step: 'RESOLVE' }); }}
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
                        onClick={() => { setStep('GUESS'); persist({ step: 'GUESS' }); }}
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
                                            onClick={() => { const next = { ...guessed, [key]: true }; setGuessed(next); persist({ guessed: next }); }}
                                            className={`py-3 rounded-xl border-2 font-bold text-sm transition-all ${
                                                yes ? 'border-emerald-500 bg-emerald-500/10 text-white' : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-500'
                                            }`}
                                        >
                                            Ja
                                        </button>
                                        <button
                                            onClick={() => { const next = { ...guessed, [key]: false }; setGuessed(next); persist({ guessed: next }); }}
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
