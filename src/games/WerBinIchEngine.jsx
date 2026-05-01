import React, { useState, useEffect, useMemo } from 'react';
import { doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Settings, Dices, Users, Play, CheckCircle, Skull, Trophy, Home, Search, Edit3, BookOpen, User, Crown, PartyPopper, ArrowRight } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { shuffleArray } from '../utils/helpers';

// Die VIP-Datenbank für schnelle Ideen
const VIP_LIST = [
    "Angela Merkel", "Albert Einstein", "Cristiano Ronaldo", "Harry Potter",
    "Spongebob", "Leonardo DiCaprio", "Taylor Swift", "Michael Jackson",
    "Barack Obama", "Donald Trump", "Elon Musk", "Mickey Mouse", "Batman",
    "Spider-Man", "Homer Simpson", "Darth Vader", "Super Mario", "Pikachu",
    "Thomas Müller", "Heidi Klum", "Helene Fischer", "Olaf Scholz", "Bill Gates",
    "Katy Perry", "Ed Sheeran", "Lionel Messi", "Kylie Jenner", "Kim Kardashian",
    "Zendaya", "Tom Holland", "Angela Bassett", "Dieter Bohlen", "Otto Waalkes",
    "Mark Forster", "Manuel Neuer", "Jürgen Klopp", "Götz George", "Chuck Norris",
    "Shakira", "Rihanna", "Eminem", "Snoop Dogg", "Gordon Ramsay", "Mr. Bean",
    "Sherlock Holmes", "James Bond", "Indiana Jones", "Lara Croft", "Pippi Langstrumpf"
];

export default function WerBinIchEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
    const { gameState, players, id: lobbyCode } = lobby;

    // ==========================================
    // HOOKS (Müssen zwingend GANZ OBEN stehen!)
    // ==========================================

    const [setupMode, setSetupMode] = useState('POOL');
    const [assignments, setAssignments] = useState({});

    const [searchTerm, setSearchTerm] = useState('');
    const [inputOne, setInputOne] = useState('');
    const [inputTwo, setInputTwo] = useState('');
    const [localSubmitted, setLocalSubmitted] = useState(false);

    const [notes, setNotes] = useState('');

    useEffect(() => {
        if (gameState.phase === 'SETUP' || gameState.phase === 'INPUT') {
            setNotes('');
            setInputOne('');
            setInputTwo('');
            setLocalSubmitted(false);
        }
    }, [gameState.phase]);

    useEffect(() => {
        if (gameState.phase === 'SETUP' && players.length > 1 && Object.keys(assignments).length === 0) {
            const shuffled = shuffleArray([...players]);
            const newAssignments = {};
            for (let i = 0; i < shuffled.length; i++) {
                newAssignments[shuffled[i].id] = shuffled[(i + 1) % shuffled.length].id;
            }
            setAssignments(newAssignments);
        }
    }, [players, assignments, gameState.phase]);

    const filteredVIPs = useMemo(() => {
        if (!searchTerm) return VIP_LIST;
        return VIP_LIST.filter(vip => vip.toLowerCase().includes(searchTerm.toLowerCase()));
    }, [searchTerm]);

    // ==========================================
    // GLOBALE VARIABLEN & FUNKTIONEN
    // ==========================================
    const mode = gameState.mode || 'POOL';
    const myTargetId = mode === 'TARGETED' ? gameState.assignments?.[user.uid] : null;
    const myTargetName = myTargetId ? players.find(p => p.id === myTargetId)?.name : '';

    const inputArray = gameState.inputArray || [];
    const hasSubmitted = localSubmitted || inputArray.some(item => item.userId === user.uid);
    const readyCount = inputArray.length;
    const allReady = readyCount > 0 && readyCount === players.length;

    const handleSwapTarget = (writerId, newTargetId) => {
        if (writerId === newTargetId) return;
        const currentTargetOfWriter = assignments[writerId];
        if (newTargetId === currentTargetOfWriter) return;

        const otherWriterId = Object.keys(assignments).find(k => assignments[k] === newTargetId);

        setAssignments(prev => ({
            ...prev,
            [writerId]: newTargetId,
            [otherWriterId]: currentTargetOfWriter
        }));
    };

    const startInputPhase = async () => {
        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.phase': 'INPUT',
            'gameState.mode': setupMode,
            'gameState.assignments': setupMode === 'TARGETED' ? assignments : null,
            'gameState.inputArray': []
        });
    };

    const submitWords = async () => {
        if (!inputOne.trim() || (mode === 'POOL' && !inputTwo.trim())) return;

        setLocalSubmitted(true);
        try {
            const lobbyRef = doc(db, 'lobbies', lobbyCode);
            const myInputs = mode === 'POOL' ? [inputOne.trim(), inputTwo.trim()] : [inputOne.trim()];

            await updateDoc(lobbyRef, {
                'gameState.inputArray': arrayUnion({
                    userId: user.uid,
                    words: myInputs
                })
            });

        } catch (err) {
            console.error("Fehler beim Senden:", err);
            setLocalSubmitted(false);
            alert("Fehler beim Senden. Bitte versuche es erneut!");
        }
    };

    const beginGame = async () => {
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        const playerState = {};

        const inputsMap = {};
        (gameState.inputArray || []).forEach(item => {
            inputsMap[item.userId] = item.words;
        });

        if (mode === 'TARGETED') {
            players.forEach(p => {
                const writerId = Object.keys(gameState.assignments).find(w => gameState.assignments[w] === p.id);
                const word = inputsMap[writerId]?.[0] || 'Unbekannt';
                playerState[p.id] = { word, guessed: false, rank: null };
            });
        } else {
            let allWords = [];
            Object.values(inputsMap).forEach(wordsArr => { allWords.push(...wordsArr); });
            allWords = shuffleArray(allWords);

            players.forEach((p, idx) => {
                playerState[p.id] = { word: allWords[idx] || 'Ein Niemand', guessed: false, rank: null };
            });
        }

        await updateDoc(lobbyRef, {
            'gameState.phase': 'PLAYING',
            'gameState.playerState': playerState,
            'gameState.nextRank': 1,
            'gameState.activeTurnId': players[0].id // Erster Spieler ist automatisch dran
        });
    };

    // Nächsten Spieler ermitteln
    const nextTurn = async () => {
        if (!isHost) return;

        const currentIdx = players.findIndex(p => p.id === gameState.activeTurnId);
        let nextIdx = (currentIdx + 1) % players.length;

        // Überspringe Spieler, die schon erraten wurden
        let loopCount = 0;
        while (gameState.playerState[players[nextIdx].id]?.guessed && loopCount < players.length) {
            nextIdx = (nextIdx + 1) % players.length;
            loopCount++;
        }

        await updateDoc(doc(db, 'lobbies', lobbyCode), {
            'gameState.activeTurnId': players[nextIdx].id
        });
    };

    const handleGuessed = async (targetId) => {
        if (!isHost) return;

        const newPlayerState = { ...gameState.playerState };
        newPlayerState[targetId].guessed = true;
        newPlayerState[targetId].rank = gameState.nextRank;

        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        const remainingUnGuessed = Object.values(newPlayerState).filter(s => !s.guessed).length;

        if (remainingUnGuessed <= 1) {
            await updateDoc(lobbyRef, {
                'gameState.playerState': newPlayerState,
                'gameState.phase': 'FINAL_RESULTS'
            });
        } else {
            // Falls derjenige erraten wurde, der gerade dran war, springt der Zug automatisch weiter
            let nextActiveId = gameState.activeTurnId;
            if (targetId === gameState.activeTurnId) {
                const currentIdx = players.findIndex(p => p.id === gameState.activeTurnId);
                let nextIdx = (currentIdx + 1) % players.length;
                let loopCount = 0;
                while (newPlayerState[players[nextIdx].id]?.guessed && loopCount < players.length) {
                    nextIdx = (nextIdx + 1) % players.length;
                    loopCount++;
                }
                nextActiveId = players[nextIdx].id;
            }

            await updateDoc(lobbyRef, {
                'gameState.playerState': newPlayerState,
                'gameState.nextRank': gameState.nextRank + 1,
                'gameState.activeTurnId': nextActiveId
            });
        }
    };

    const distributePointsAndReturnToLobby = async () => {
        if (!isHost) return;
        const lobbyRef = doc(db, 'lobbies', lobbyCode);
        const { playerState } = gameState;

        const rankedPlayers = players.map(p => ({
            ...p,
            rank: playerState[p.id].rank || 999,
            guessed: playerState[p.id].guessed
        }));

        if (lobby.settings.globalLeaderboard) {
            let newPlayers = [...players].map(p => {
                const r = rankedPlayers.find(rp => rp.id === p.id);
                let addedPoints = 0;
                if (r.rank === 1) addedPoints = 5;
                else if (r.rank === 2) addedPoints = 3;
                else if (r.rank === 3) addedPoints = 1;

                return { ...p, globalScore: (p.globalScore || 0) + addedPoints };
            });
            await updateDoc(lobbyRef, { status: 'LOBBY_WAITING', players: newPlayers, 'gameState': {} });
        } else {
            await updateDoc(lobbyRef, { status: 'LOBBY_WAITING', 'gameState': {} });
        }
    };

    // ==========================================
    // PHASE 1: SETUP RENDER
    // ==========================================
    if (gameState.phase === 'SETUP') {
        if (!isHost) {
            return (
                <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-8 relative">
                    <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
                    <div className="flex flex-col items-center gap-4 text-center">
                        <User size={64} className="text-purple-500 animate-pulse" />
                        <h2 className="text-2xl font-bold text-slate-300">Warten auf Host...</h2>
                        <p className="text-slate-500">Der Host wählt gerade den Spielmodus aus.</p>
                    </div>
                </div>
            );
        }

        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <div className="max-w-4xl mx-auto w-full mt-6">
                    <div className="text-center mb-8">
                        <h2 className="text-4xl font-black tracking-widest text-purple-400 uppercase">Wer bin ich?</h2>
                        <p className="text-slate-400 mt-2">Wähle, wie die Zettel auf die Stirn kommen.</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                        <div
                            onClick={() => setSetupMode('POOL')}
                            className={`p-6 rounded-3xl border-2 cursor-pointer transition-all ${setupMode === 'POOL' ? 'bg-purple-900/20 border-purple-500 shadow-[0_0_20px_rgba(168,85,247,0.2)]' : 'bg-slate-800 border-slate-700 hover:border-slate-500'}`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <Dices size={28} className={setupMode === 'POOL' ? 'text-purple-400' : 'text-slate-400'} />
                                <h3 className="text-xl font-bold">Zufälliger Pool</h3>
                            </div>
                            <p className="text-sm text-slate-400">Jeder Spieler wirft 2 Begriffe in einen unsichtbaren Topf. Das System verteilt sie beim Start zufällig auf alle Köpfe.</p>
                        </div>

                        <div
                            onClick={() => setSetupMode('TARGETED')}
                            className={`p-6 rounded-3xl border-2 cursor-pointer transition-all ${setupMode === 'TARGETED' ? 'bg-indigo-900/20 border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.2)]' : 'bg-slate-800 border-slate-700 hover:border-slate-500'}`}
                        >
                            <div className="flex items-center gap-3 mb-3">
                                <Users size={28} className={setupMode === 'TARGETED' ? 'text-indigo-400' : 'text-slate-400'} />
                                <h3 className="text-xl font-bold">Gezielte Zuweisung</h3>
                            </div>
                            <p className="text-sm text-slate-400">Jeder Spieler schreibt heimlich einen Begriff für eine ganz bestimmte Person. Die Zuweisung ist fair im Kreis generiert.</p>
                        </div>
                    </div>

                    {setupMode === 'TARGETED' && (
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl mb-8 animate-in slide-in-from-top-4">
                            <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Edit3 size={20} className="text-indigo-400" /> Wichtel-Übersicht (Nur für dich sichtbar)</h3>
                            <div className="space-y-3">
                                {players.map(p => (
                                    <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between bg-slate-900 p-3 rounded-xl border border-slate-700">
                                        <span className="font-bold mb-2 sm:mb-0">{p.name} <span className="text-slate-500 font-normal">schreibt für...</span></span>
                                        <select
                                            value={assignments[p.id] || ''}
                                            onChange={(e) => handleSwapTarget(p.id, e.target.value)}
                                            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500 text-sm"
                                        >
                                            {players.filter(target => target.id !== p.id).map(target => (
                                                <option key={target.id} value={target.id}>{target.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-4">
                        <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 text-lg">Zurück</button>
                        <button onClick={startInputPhase} className="w-2/3 bg-purple-600 hover:bg-purple-500 text-white px-8 py-4 rounded-2xl font-bold shadow-lg transition-all text-xl active:scale-95">Zur Eingabe-Phase</button>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // PHASE 2: INPUT RENDER
    // ==========================================
    if (gameState.phase === 'INPUT') {
        return (
            <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />

                <div className="max-w-4xl mx-auto w-full mt-6">
                    <div className="text-center mb-8">
                        <h2 className="text-3xl font-black text-purple-400 uppercase">Begriffe wählen</h2>
                        <p className="text-slate-400 mt-2">
                            {mode === 'POOL' ? 'Wirf 2 berühmte Figuren oder Personen in den Topf.' : `Überlege dir eine Person/Figur für ${myTargetName}.`}
                        </p>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            {!hasSubmitted ? (
                                <div className="space-y-6 animate-in slide-in-from-left">
                                    <div className="space-y-4">
                                        <div>
                                            <label className="block text-sm font-bold text-slate-400 mb-2">
                                                {mode === 'POOL' ? 'Begriff 1' : `Begriff für ${myTargetName}`}
                                            </label>
                                            <input
                                                type="text" value={inputOne} onChange={e => setInputOne(e.target.value)}
                                                placeholder="z.B. Angela Merkel"
                                                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                                            />
                                        </div>
                                        {mode === 'POOL' && (
                                            <div>
                                                <label className="block text-sm font-bold text-slate-400 mb-2">Begriff 2</label>
                                                <input
                                                    type="text" value={inputTwo} onChange={e => setInputTwo(e.target.value)}
                                                    placeholder="z.B. Batman"
                                                    className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-purple-500 outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>
                                    <button
                                        onClick={submitWords}
                                        disabled={!inputOne.trim() || (mode === 'POOL' && !inputTwo.trim())}
                                        className="w-full bg-purple-600 hover:bg-purple-500 disabled:bg-slate-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg active:scale-95"
                                    >
                                        Abschicken & Bereit
                                    </button>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center p-8">
                                    <CheckCircle size={64} className="text-green-500 mb-4 animate-in zoom-in" />
                                    <h3 className="text-2xl font-bold text-white mb-2">Alles klar!</h3>
                                    <p className="text-slate-400">Dein Begriff wurde sicher gespeichert. Warte auf die anderen...</p>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-6">
                            {!hasSubmitted && (
                                <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl flex-grow flex flex-col max-h-[40vh] lg:max-h-full">
                                    <h3 className="font-bold text-slate-300 mb-4 flex items-center gap-2"><BookOpen size={18}/> VIP Datenbank</h3>
                                    <div className="relative mb-4">
                                        <Search size={18} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-500" />
                                        <input
                                            type="text" placeholder="Suchen..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:border-purple-500 outline-none"
                                        />
                                    </div>
                                    <div className="flex flex-wrap gap-2 overflow-y-auto pr-2 flex-grow content-start">
                                        {filteredVIPs.slice(0, 30).map(vip => (
                                            <button
                                                key={vip}
                                                onClick={() => {
                                                    if (!inputOne) setInputOne(vip);
                                                    else if (mode === 'POOL' && !inputTwo) setInputTwo(vip);
                                                }}
                                                className="bg-slate-900 border border-slate-700 hover:border-purple-500 hover:text-purple-300 px-3 py-1.5 rounded-lg text-sm text-slate-300 transition-colors"
                                            >
                                                {vip}
                                            </button>
                                        ))}
                                        {filteredVIPs.length > 30 && <span className="text-xs text-slate-500 self-center">...und weitere</span>}
                                    </div>
                                </div>
                            )}

                            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                                <h3 className="font-bold text-slate-300 mb-4 flex items-center gap-2"><Users size={18}/> Status ({readyCount}/{players.length})</h3>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {players.map(p => {
                                        const ready = inputArray.some(item => item.userId === p.id);
                                        return (
                                            <span key={p.id} className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${ready ? 'bg-green-900/30 border-green-500/50 text-green-400' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>
                                            {p.name} {ready && '✓'}
                                        </span>
                                        );
                                    })}
                                </div>

                                {isHost && (
                                    <button
                                        onClick={beginGame}
                                        disabled={!allReady}
                                        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 text-white font-bold py-3 rounded-xl transition-all flex justify-center items-center gap-2 active:scale-95"
                                    >
                                        <Play size={18} /> {allReady ? 'Spiel starten!' : 'Warten auf alle...'}
                                    </button>
                                )}
                                {!isHost && allReady && <p className="text-green-400 text-sm font-bold text-center">Alle bereit! Warte auf Host-Start...</p>}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ==========================================
    // PHASE 3: PLAYING RENDER
    // ==========================================
    if (gameState.phase === 'PLAYING') {
        const { playerState, activeTurnId } = gameState;
        const myState = playerState[user.uid];

        if (!myState) return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade...</div>;

        const isMyTurn = activeTurnId === user.uid && !myState.guessed;

        return (
            <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 flex flex-col relative">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />

                <div className="max-w-6xl mx-auto w-full mt-10 grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Links: Du & Notizen */}
                    <div className="lg:col-span-1 flex flex-col gap-6">
                        <div className={`p-8 rounded-3xl border shadow-xl text-center relative overflow-hidden transition-all duration-1000 ${myState.guessed ? 'bg-green-900/20 border-green-500 shadow-[0_0_40px_rgba(34,197,94,0.3)]' : (isMyTurn ? 'bg-green-900/30 border-green-500 shadow-[0_0_30px_rgba(34,197,94,0.4)] ring-2 ring-green-400' : 'bg-slate-800 border-slate-700')}`}>

                            {/* DEIN ZUG INDICATOR */}
                            {isMyTurn && <div className="absolute top-0 left-0 w-full bg-green-500 text-white font-black text-xs py-1.5 uppercase tracking-widest animate-pulse">Du bist dran!</div>}

                            {myState.guessed && <PartyPopper size={120} className="absolute -top-4 -right-4 text-green-500/20" />}
                            <p className={`font-bold uppercase tracking-widest text-sm mb-4 ${isMyTurn ? 'text-green-300 mt-4' : 'text-slate-400'}`}>Dein Zettel auf der Stirn</p>

                            {myState.guessed ? (
                                <div className="animate-in zoom-in duration-500">
                                    <h3 className="text-4xl sm:text-5xl font-black text-green-400 mb-2">{myState.word}</h3>
                                    <p className="text-slate-300 font-bold">Richtig! Platz #{myState.rank}</p>
                                </div>
                            ) : (
                                <div>
                                    <h3 className={`text-5xl sm:text-6xl font-black mb-2 ${isMyTurn ? 'text-slate-300' : 'text-slate-600'}`}>???</h3>
                                    <p className={isMyTurn ? 'text-green-300 font-bold' : 'text-slate-500 text-sm'}>Frag die anderen!</p>
                                </div>
                            )}
                        </div>

                        <div className="bg-amber-900/10 rounded-3xl p-6 border border-amber-500/30 shadow-xl flex-grow flex flex-col">
                            <h3 className="font-bold text-amber-500 mb-3 flex items-center gap-2"><Edit3 size={18}/> Deine Notizen</h3>
                            <textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Z.B. Männlich, tot, Schauspieler..."
                                className="w-full flex-grow bg-slate-900/50 border border-slate-700 rounded-xl p-4 text-slate-300 focus:outline-none focus:border-amber-500 resize-none font-sans"
                                style={{ minHeight: '150px' }}
                            />
                        </div>
                    </div>

                    {/* Rechts: Die Anderen */}
                    <div className="lg:col-span-2 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 border-b border-slate-700 pb-4 gap-4">
                            <h3 className="text-2xl font-bold flex items-center gap-2"><Users className="text-purple-400" /> Die Anderen</h3>

                            {/* Host Controls: Nächster & Abbrechen */}
                            {isHost && (
                                <div className="flex items-center gap-2 w-full sm:w-auto">
                                    <button onClick={nextTurn} className="flex-1 sm:flex-none bg-green-600 hover:bg-green-500 text-white px-5 py-2 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-900/20 active:scale-95 border border-green-500">
                                        Nächster <ArrowRight size={18} />
                                    </button>
                                    <button onClick={() => { if(window.confirm('Abbrechen?')) updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} }); }} className="text-sm bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl transition-colors text-slate-300 font-bold border border-slate-600">
                                        Abbrechen
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {players.map(p => {
                                if (p.id === user.uid) return null;
                                const s = playerState[p.id];
                                const isThisPlayersTurn = p.id === activeTurnId && !s.guessed;

                                return (
                                    <div key={p.id} className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${s.guessed ? 'bg-slate-900/50 border-green-500/30' : (isThisPlayersTurn ? 'bg-slate-800 border-green-500 ring-1 ring-green-500 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 'bg-slate-900 border-slate-700')}`}>
                                        <div>
                                            <div className="flex justify-between items-start mb-2">
                                                <span className={`font-bold text-lg ${s.guessed ? 'text-slate-400' : 'text-white'}`}>{p.name}</span>
                                                {s.guessed && <span className="bg-green-900/30 text-green-400 text-xs px-2 py-1 rounded font-bold">Platz #{s.rank}</span>}

                                                {/* IST DRAN BADGE */}
                                                {isThisPlayersTurn && <span className="bg-green-500 text-white text-xs px-3 py-1 rounded-full font-bold animate-pulse shadow-lg">Ist dran!</span>}
                                            </div>
                                            <div className={`border rounded-xl p-4 text-center mt-2 relative overflow-hidden ${isThisPlayersTurn ? 'bg-slate-900 border-slate-700' : 'bg-slate-800 border-slate-700'}`}>
                                                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-pink-500"></div>
                                                <span className={`font-black text-xl sm:text-2xl ${s.guessed ? 'text-slate-500 line-through' : 'text-purple-300'}`}>{s.word}</span>
                                            </div>
                                        </div>

                                        {isHost && !s.guessed && (
                                            <button
                                                onClick={() => handleGuessed(p.id)}
                                                className={`w-full mt-4 py-2 rounded-lg font-bold transition-all text-sm flex items-center justify-center gap-2 ${isThisPlayersTurn ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-green-900/30 hover:bg-green-800/50 text-green-400 border border-green-500/30'}`}
                                            >
                                                <CheckCircle size={16} /> Hat es erraten!
                                            </button>
                                        )}
                                    </div>
                                );
                            })}

                            {isHost && !myState.guessed && (
                                <div className={`p-5 rounded-2xl border flex flex-col justify-center items-center text-center ${isMyTurn ? 'bg-slate-800 border-green-500 ring-1 ring-green-500 shadow-lg' : 'border-dashed border-slate-600 bg-slate-900/30'}`}>
                                    <span className={`text-sm mb-2 font-bold ${isMyTurn ? 'text-green-400' : 'text-slate-500'}`}>Host-Aktion für dich selbst:</span>
                                    <button
                                        onClick={() => handleGuessed(user.uid)}
                                        className={`w-full py-2 rounded-lg font-bold transition-all text-sm flex items-center justify-center gap-2 ${isMyTurn ? 'bg-green-600 hover:bg-green-500 text-white' : 'bg-green-900/30 hover:bg-green-800/50 text-green-400 border border-green-500/30'}`}
                                    >
                                        <CheckCircle size={16} /> Ich habe es erraten!
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        );
    }

    // ==========================================
    // PHASE 4: FINAL RESULTS RENDER
    // ==========================================
    if (gameState.phase === 'FINAL_RESULTS') {
        const { playerState } = gameState;

        const rankedPlayers = players.map(p => ({
            ...p,
            rank: playerState[p.id].rank || 999,
            word: playerState[p.id].word,
            guessed: playerState[p.id].guessed
        })).sort((a, b) => a.rank - b.rank);

        return (
            <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 relative flex flex-col items-center">
                <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />

                <div className="max-w-3xl w-full mx-auto mt-16 text-center">
                    <div className="mb-10 animate-in zoom-in duration-500">
                        <Crown size={64} className="mx-auto mb-4 text-yellow-400" />
                        <h2 className="text-5xl sm:text-6xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500">Ergebnisse</h2>
                        <p className="text-slate-400 mt-3 text-xl">Wer war wer?</p>
                    </div>

                    <div className="bg-slate-800 rounded-3xl p-6 sm:p-8 border border-slate-700 shadow-2xl mb-10 text-left">
                        <div className="space-y-4">
                            {rankedPlayers.map((p, index) => {
                                // Wenn nicht erraten, nimm einfach die Position in der Liste (index + 1)
                                let rankDisplay = p.guessed ? `#${p.rank}` : `#${index + 1}`;
                                let rowBg = 'bg-slate-900 border-slate-700 text-slate-300';
                                let pts = 0;

                                if (!p.guessed) {
                                    rowBg = 'bg-slate-950 border-red-900/30 text-slate-500 opacity-80';
                                } else if (p.rank === 1) {
                                    rowBg = 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.2)]';
                                    pts = 5;
                                } else if (p.rank === 2) {
                                    rowBg = 'bg-slate-300/20 border-slate-300/50 text-slate-200';
                                    pts = 3;
                                } else if (p.rank === 3) {
                                    rowBg = 'bg-orange-600/20 border-orange-600/50 text-orange-300';
                                    pts = 1;
                                }

                                return (
                                    <div key={p.id} className={`flex flex-col sm:flex-row justify-between sm:items-center p-5 rounded-2xl border transition-all ${rowBg}`}>
                                        <div className="flex items-center gap-4 mb-2 sm:mb-0">
                                            <span className="text-2xl font-black opacity-80 w-12">{rankDisplay}</span>
                                            <div>
                                                <span className="text-xl font-bold">{p.name} {p.id === user.uid && '(Du)'}</span>
                                                <p className="text-sm opacity-80 mt-1">war <span className="font-bold underline">{p.word}</span></p>
                                            </div>
                                        </div>
                                        {lobby.settings.globalLeaderboard && pts > 0 && (
                                            <span className="text-green-400 font-bold text-lg bg-green-500/10 px-3 py-1.5 rounded">+{pts} Pkt</span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {isHost ? (
                        <button onClick={distributePointsAndReturnToLobby} className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-10 py-4 rounded-2xl font-bold text-xl shadow-xl transition-all active:scale-95 flex items-center justify-center gap-2 mx-auto">
                            <Home size={24} /> Punkte verteilen & Zurück zur Lobby
                        </button>
                    ) : (
                        <p className="text-slate-500 italic text-lg text-center bg-slate-900 p-4 rounded-xl border border-slate-800">
                            Warte auf den Host für die Rückkehr zur Lobby...
                        </p>
                    )}
                </div>
            </div>
        );
    }

    return null;
}