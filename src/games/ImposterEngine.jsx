import React, { useState } from 'react';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import {
    Settings, Shield, Ghost, Timer,
    CheckCircle, VenetianMask, Plus, Trash2
} from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { IMPOSTER_CATEGORIES } from '../constants/gameData';
import { shuffleArray } from '../utils/helpers';

export default function ImposterEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode, customImposterWords = [], usedImposterWords = [] } = lobby;
    const [showRole, setShowRole] = useState(false);
    const [customInput, setCustomInput] = useState('');

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

    const addCustomWord = async () => {
        if (!customInput.trim()) return;
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        await updateDoc(lobbyRef, {
            customImposterWords: arrayUnion(customInput.trim())
        });
        setCustomInput('');
    };

    const removeCustomWord = async (word) => {
        const newList = customImposterWords.filter(w => w !== word);
        await updateDoc(doc(db, 'lobbies', lobbyCode), { customImposterWords: newList });
    };

    // ---------------------------------------------------------
    // SPIELSTART: ROLLEN & WORT VERTEILEN
    // ---------------------------------------------------------
    const startGame = async () => {
        const settings = gameState.settings;
        let fullPool = [];

        // Pool aus gewählten Kategorien zusammenstellen
        settings.selectedCategories.forEach(catId => {
            if (catId === 'custom') {
                fullPool = [...fullPool, ...customImposterWords];
            } else {
                fullPool = [...fullPool, ...IMPOSTER_CATEGORIES[catId].words];
            }
        });

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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Linke Seite: Kategorien */}
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                                <Shield className="text-blue-400" size={20} /> Kategorien
                            </h3>
                            <div className="grid grid-cols-2 gap-3">
                                {Object.values(IMPOSTER_CATEGORIES).map(cat => {
                                    const isSelected = gameState.settings?.selectedCategories?.includes(cat.id);
                                    return (
                                        <button
                                            key={cat.id}
                                            disabled={!isHost}
                                            onClick={() => toggleCategory(cat.id)}
                                            className={`p-3 rounded-xl border-2 transition-all text-left ${
                                                isSelected
                                                    ? 'border-emerald-500 bg-emerald-500/10 text-white'
                                                    : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'
                                            } ${!isHost && 'cursor-default'}`}
                                        >
                                            <span className="block font-bold text-sm">{cat.name}</span>
                                            <span className="text-[10px] opacity-60">{cat.words.length} Wörter</span>
                                        </button>
                                    );
                                })}
                                {/* Custom Category Button */}
                                <button
                                    disabled={!isHost}
                                    onClick={() => toggleCategory('custom')}
                                    className={`p-3 rounded-xl border-2 transition-all text-left ${
                                        gameState.settings?.selectedCategories?.includes('custom')
                                            ? 'border-purple-500 bg-purple-500/10 text-white'
                                            : 'border-slate-700 bg-slate-900/50 text-slate-500 hover:border-slate-500'
                                    } ${!isHost && 'cursor-default'}`}
                                >
                                    <span className="block font-bold text-sm">Eigene Wörter</span>
                                    <span className="text-[10px] opacity-60">{customImposterWords.length} hinterlegt</span>
                                </button>
                            </div>
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
                                {isHost && (
                                    <div className="flex gap-2 mb-4">
                                        <input
                                            type="text" value={customInput} onChange={(e) => setCustomInput(e.target.value)}
                                            placeholder="Wort hinzufügen..."
                                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-purple-500"
                                        />
                                        <button onClick={addCustomWord} className="bg-purple-600 p-2 rounded-lg hover:bg-purple-500 transition-colors">
                                            <Plus size={20} />
                                        </button>
                                    </div>
                                )}
                                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-2">
                                    {customImposterWords.map((word, idx) => (
                                        <span key={idx} className="bg-slate-900 border border-slate-700 px-2 py-1 rounded text-xs flex items-center gap-2">
                      {word}
                                            {isHost && <Trash2 size={12} className="text-red-400 cursor-pointer hover:text-red-300" onClick={() => removeCustomWord(word)} />}
                    </span>
                                    ))}
                                    {customImposterWords.length === 0 && <p className="text-xs text-slate-500 italic">Noch keine eigenen Wörter hinterlegt.</p>}
                                </div>
                            </div>
                        </div>
                    </div>

                    {isHost && (
                        <button
                            onClick={startGame}
                            disabled={(gameState.settings?.selectedCategories || []).length === 0}
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