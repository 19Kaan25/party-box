import React, { useState } from 'react';
import { doc, updateDoc, arrayUnion } from '../lib/firestoreBridge';
import {
    Settings, Shield, Ghost, Timer,
    CheckCircle, VenetianMask, Plus, Smartphone
} from 'lucide-react';

import GameHeader from '../components/GameHeader';
import ImposterSingleDevice from './ImposterSingleDevice';
import { CategoryPicker, CustomWordManager } from './ImposterSetupPanels';
import { buildWordPool } from './imposterWords';
import { shuffleArray } from '../utils/helpers';

export default function ImposterEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode, customImposterWords = [], usedImposterWords = [] } = lobby;
    const [showRole, setShowRole] = useState(false);

    // ---------------------------------------------------------
    // MODUS-WEICHE: alles auf einem Handy laeuft in einer eigenen Komponente.
    // Die Phase wird mitgeprueft, damit eine laufende Einzelgeraet-Runde auch
    // dann korrekt rendert, wenn der Modus-Flag verlorenginge.
    // ---------------------------------------------------------
    if (gameState.settings?.mode === 'SINGLE' || gameState.phase === 'SINGLE_RUNNING') {
        return (
            <ImposterSingleDevice
                lobby={lobby}
                user={user}
                isHost={isHost}
                db={db}
                updateLobbyStatus={updateLobbyStatus}
                leaveLobby={leaveLobby}
            />
        );
    }

    // ---------------------------------------------------------
    // HOST-LOGIK: EINSTELLUNGEN LIVE SYNCHRONISIEREN
    // ---------------------------------------------------------
    const updateSetupSettings = async (newSettings) => {
        if (!isHost) return;
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        await updateDoc(lobbyRef, {
            'gameState.settings': { ...gameState.settings, ...newSettings }
        });
    };

    const toggleCategory = (catId) => {
        const current = gameState.settings?.selectedCategories || [];
        const next = current.includes(catId)
            ? current.filter(id => id !== catId)
            : [...current, catId];
        updateSetupSettings({ selectedCategories: next });
    };

    // ---------------------------------------------------------
    // SPIELSTART: ROLLEN & WORT VERTEILEN
    // ---------------------------------------------------------
    const startGame = async () => {
        const settings = gameState.settings;

        // Pool aus gewählten Kategorien zusammenstellen
        const fullPool = buildWordPool(settings.selectedCategories, customImposterWords);

        // Bereits benutzte Wörter filtern
        const availableWords = fullPool.filter(w => !usedImposterWords.includes(w));

        // Falls alle Wörter verbraucht wurden, Pool zurücksetzen
        const poolToUse = availableWords.length > 0 ? availableWords : fullPool;

        // Wort und Rollen bestimmen
        const secretWord = poolToUse[Math.floor(Math.random() * poolToUse.length)];
        const shuffledPlayers = shuffleArray(players.map(p => p.id));
        const imposterIds = shuffledPlayers.slice(0, settings.imposterCount);

        // Spiel updaten
        await updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', {
            usedImposterWords: arrayUnion(secretWord),
            gameState: {
                ...gameState,
                phase: 'ROLE_REVEAL',
                word: secretWord,
                imposters: imposterIds,
                votes: {},
                startTime: Date.now()
            }
        });
    };

    // ---------------------------------------------------------
    // VOTING LOGIK
    // ---------------------------------------------------------
    const submitVote = async (targetId) => {
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        await updateDoc(lobbyRef, {
            [`gameState.votes.${user.uid}`]: targetId
        });
    };

    // ---------------------------------------------------------
    // RENDERING: SETUP PHASE
    // ---------------------------------------------------------
    if (gameState.phase === 'SETUP') {
        // Unter drei Leuten gibt es nichts zu enttarnen: der Imposter waere
        // sofort klar. Im Einzelgeraet-Modus zaehlt stattdessen die
        // Mitspielerliste, dort duerfen Gaeste ohne Account auffuellen.
        const startBlockReason =
            players.length < 3
                ? 'Für „jeder sein Handy“ braucht ihr mindestens 3 Spieler in der Lobby. Zu zweit könnt ihr auf ein Handy wechseln und Gäste ergänzen.'
                : ((gameState.settings?.selectedCategories || []).length === 0
                    ? 'Wähle mindestens eine Kategorie.'
                    : null);

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-4xl mx-auto mt-12">
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-bold text-emerald-400 flex items-center justify-center gap-2">
                            <VenetianMask size={32} /> Imposter Setup
                        </h2>
                        <p className="text-slate-400 mt-2">
                            {isHost ? "Wähle die Regeln für diese Runde" : "Der Host konfiguriert das Spiel..."}
                        </p>
                    </div>

                    {/* Modus-Umschalter: dasselbe Spiel auf einem einzigen Handy */}
                    <div className="bg-slate-800 rounded-3xl p-4 border border-slate-700 shadow-xl mb-6">
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                className="p-3 rounded-xl border-2 border-emerald-500 bg-emerald-500/10 text-white transition-all text-left"
                            >
                                <span className="block font-bold text-sm">Jeder sein Handy</span>
                                <span className="text-[10px] opacity-60">Alle in der Lobby spielen mit</span>
                            </button>
                            <button
                                disabled={!isHost}
                                onClick={() => updateSetupSettings({ mode: 'SINGLE' })}
                                className={`p-3 rounded-xl border-2 border-slate-700 bg-slate-900/50 text-slate-500 transition-all text-left ${isHost ? 'hover:border-slate-500' : 'cursor-default'}`}
                            >
                                <span className="font-bold text-sm flex items-center gap-1.5"><Smartphone size={14} /> Ein Handy</span>
                                <span className="text-[10px] opacity-60">Karten reihum aufdecken</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Linke Seite: Kategorien */}
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Shield className="text-blue-400" size={20} /> Kategorien
                            </h3>
                            <CategoryPicker
                                selected={gameState.settings?.selectedCategories || []}
                                onToggle={toggleCategory}
                                disabled={!isHost}
                                customWordCount={customImposterWords.length}
                            />
                        </div>

                        {/* Rechte Seite: Settings & Custom Words */}
                        <div className="space-y-6">
                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Settings className="text-orange-400" size={20} /> Spielregeln
                                </h3>
                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm text-slate-400 flex justify-between">
                                            <span>Anzahl Imposter</span>
                                            <span className="font-bold text-white">{gameState.settings?.imposterCount}</span>
                                        </label>
                                        <input
                                            type="range" min="1" max="3" step="1"
                                            disabled={!isHost}
                                            value={gameState.settings?.imposterCount || 1}
                                            onChange={(e) => updateSetupSettings({ imposterCount: parseInt(e.target.value) })}
                                            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-500 mt-2 disabled:opacity-50"
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Custom Word Manager */}
                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                    <Plus className="text-purple-400" size={20} /> Eigene Wörter
                                </h3>
                                <CustomWordManager lobbyCode={lobbyCode} words={customImposterWords} isHost={isHost} />
                            </div>
                        </div>
                    </div>

                    {isHost && startBlockReason && (
                        <p className="text-center text-sm text-amber-400 mt-6">{startBlockReason}</p>
                    )}

                    {isHost && (
                        <button
                            onClick={startGame}
                            disabled={!!startBlockReason}
                            className="w-full mt-8 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-95"
                        >
                            Spiel starten
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: ROLE REVEAL PHASE
    // ---------------------------------------------------------
    if (gameState.phase === 'ROLE_REVEAL') {
        const isImposter = gameState.imposters.includes(user.uid);
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 border border-slate-700 shadow-2xl text-center">
                    <h2 className="text-2xl font-bold mb-6 text-white">Deine Rolle</h2>

                    <div
                        onClick={() => setShowRole(!showRole)}
                        className={`aspect-square rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all duration-500 transform ${
                            showRole ? (isImposter ? 'bg-red-500/20 border-red-500' : 'bg-emerald-500/20 border-emerald-500') : 'bg-slate-700 border-slate-600'
                        } border-4 border-dashed`}
                    >
                        {!showRole ? (
                            <>
                                <Ghost size={64} className="text-slate-500 mb-4 animate-bounce" />
                                <p className="font-bold text-slate-400">Klicken zum Aufdecken</p>
                            </>
                        ) : (
                            <div className="animate-in zoom-in-50">
                                {isImposter ? (
                                    <>
                                        <VenetianMask size={80} className="text-red-500 mb-4 mx-auto" />
                                        <h3 className="text-4xl font-black text-red-500 uppercase tracking-tighter">IMPOSTER</h3>
                                        <p className="text-slate-300 mt-4 px-4 text-sm font-medium">Täusche die anderen und finde heraus, was das Geheimwort ist!</p>
                                    </>
                                ) : (
                                    <>
                                        <Shield size={80} className="text-emerald-500 mb-4 mx-auto" />
                                        <h3 className="text-2xl font-bold text-emerald-400 mb-2">UNSCHULDIG</h3>
                                        <p className="text-slate-400 text-sm">Das Geheimwort lautet:</p>
                                        <div className="text-3xl font-black text-white mt-2 bg-slate-900 px-4 py-2 rounded-xl border border-emerald-500/30">
                                            {gameState.word}
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <p className="text-xs text-slate-500 mt-6 italic">Achte darauf, dass niemand dein Display sieht!</p>

                    {isHost && (
                        <button
                            onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', { 'gameState.phase': 'PLAYING' })}
                            className="w-full mt-8 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-xl font-bold transition-all"
                        >
                            Diskussion starten
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: PLAYING (DISCUSSION & VOTING) PHASE
    // ---------------------------------------------------------
    if (gameState.phase === 'PLAYING') {
        const hasVoted = !!gameState.votes[user.uid];
        const imposterCount = gameState.imposters.length;

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} />

                <div className="max-w-5xl mx-auto mt-12 grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Status & Geheimwort */}
                    <div className="lg:col-span-1 space-y-6">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl text-center">
                            <Timer className="mx-auto text-emerald-400 mb-2" size={40} />
                            <h3 className="text-xl font-bold">Diskussion</h3>
                            <p className="text-slate-400 text-sm mb-4">Überführt die Verräter!</p>
                            <div className="bg-slate-900 rounded-2xl p-4 border border-slate-700">
                                <p className="text-xs text-slate-500 uppercase font-bold tracking-widest">Imposter im Spiel</p>
                                <div className="flex justify-center gap-2 mt-2">
                                    {Array.from({ length: imposterCount }).map((_, i) => (
                                        <VenetianMask key={i} className="text-red-500" size={24} />
                                    ))}
                                </div>
                            </div>
                        </div>

                        {!gameState.imposters.includes(user.uid) && (
                            <div className="bg-emerald-500/10 rounded-3xl p-6 border border-emerald-500/20 shadow-xl">
                                <p className="text-xs text-emerald-500 font-bold uppercase mb-1">Erinnerung: Dein Wort</p>
                                <p className="text-2xl font-black text-white">{gameState.word}</p>
                            </div>
                        )}
                    </div>

                    {/* Player List / Voting Grid */}
                    <div className="lg:col-span-2">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                                <CheckCircle className="text-blue-400" size={20} /> Wen verdächtigst du?
                            </h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {players.map(p => {
                                    const isMe = p.id === user.uid;
                                    const voteCount = Object.values(gameState.votes).filter(v => v === p.id).length;
                                    const targetOfMyVote = gameState.votes[user.uid] === p.id;

                                    return (
                                        <button
                                            key={p.id}
                                            disabled={hasVoted || isMe}
                                            onClick={() => submitVote(p.id)}
                                            className={`relative p-4 rounded-2xl border-2 transition-all flex items-center gap-4 ${
                                                targetOfMyVote
                                                    ? 'border-emerald-500 bg-emerald-500/10'
                                                    : (hasVoted || isMe ? 'border-slate-700 bg-slate-900/30 opacity-60' : 'border-slate-700 bg-slate-900 hover:border-slate-500')
                                            }`}
                                        >
                                            <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center font-bold">
                                                {p.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="text-left flex-1">
                                                <p className="font-bold text-white">{p.name} {isMe && "(Du)"}</p>
                                                <div className="flex gap-1 mt-1">
                                                    {Array.from({ length: voteCount }).map((_, i) => (
                                                        <div key={i} className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                                                    ))}
                                                </div>
                                            </div>
                                            {targetOfMyVote && <CheckCircle size={20} className="text-emerald-500" />}
                                        </button>
                                    );
                                })}
                            </div>

                            {isHost && (
                                <button
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', { 'gameState.phase': 'RESULT' })}
                                    className="w-full mt-8 bg-red-600 hover:bg-red-500 py-4 rounded-2xl text-white font-bold shadow-lg transition-all"
                                >
                                    Abstimmung beenden & Auflösen
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ---------------------------------------------------------
    // RENDERING: RESULT PHASE
    // ---------------------------------------------------------
    if (gameState.phase === 'RESULT') {
        const imposterPlayers = players.filter(p => gameState.imposters.includes(p.id));

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex items-center justify-center">
                <div className="max-w-2xl w-full space-y-8 text-center">
                    <div className="bg-slate-800 rounded-3xl p-10 border border-slate-700 shadow-2xl">
                        <h2 className="text-5xl font-black mb-2 text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-500">
                            AUFLÖSUNG
                        </h2>
                        <p className="text-slate-400 mb-8 uppercase tracking-widest font-bold">Die Verräter waren...</p>

                        <div className="flex flex-wrap justify-center gap-6 mb-12">
                            {imposterPlayers.map(p => (
                                <div key={p.id} className="flex flex-col items-center">
                                    <div className="w-20 h-20 rounded-full bg-red-500/20 border-2 border-red-500 flex items-center justify-center mb-2 shadow-lg shadow-red-500/20">
                                        <VenetianMask size={40} className="text-red-500" />
                                    </div>
                                    <p className="font-bold text-xl">{p.name}</p>
                                </div>
                            ))}
                        </div>

                        <div className="bg-slate-900 rounded-2xl p-6 border border-slate-700 mb-8">
                            <p className="text-sm text-slate-500 uppercase font-bold mb-1">Das geheime Wort war</p>
                            <p className="text-4xl font-black text-emerald-400 tracking-tight">{gameState.word}</p>
                        </div>

                        {isHost && (
                            <button
                                onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })}
                                className="bg-white text-slate-900 font-bold px-8 py-3 rounded-xl hover:bg-slate-200 transition-all"
                            >
                                Zurück zur Lobby
                            </button>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    return null;
}