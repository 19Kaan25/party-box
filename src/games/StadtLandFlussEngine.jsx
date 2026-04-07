import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Settings, Dices, List, Trash2, Plus, X, ThumbsDown, Files, Trophy } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { ALPHABET } from '../utils/helpers';

export default function StadtLandFlussEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
  const { gameState, players, id: lobbyCode } = lobby;
  const [localAnswers, setLocalAnswers] = useState({});

  // Use strings to allow empty inputs in settings
  const [setupRounds, setSetupRounds] = useState('3');
  const [setupTimer, setSetupTimer] = useState('90');
  
  const [setupCategories, setSetupCategories] = useState(['Stadt', 'Land', 'Fluss']);
  const [newCatInput, setNewCatInput] = useState('');
  const [excludedLetters, setExcludedLetters] = useState([]);
  const [showCatModal, setShowCatModal] = useState(false);
  const [modalSelectedCats, setModalSelectedCats] = useState([]);
  
  const randomCategories = ['Marke', 'Automarke', 'Beruf', 'Tiere', 'Promi', 'Sänger', 'Fußballer', 'Schauspieler', 'Film', 'Serie', 'Film/Serie', 'Vorname', 'Nachname', 'Lebensmittel', 'Getränke', 'Grund für Verspätung'];

  useEffect(() => {
    if (gameState.phase === 'STARTING') setLocalAnswers({});
  }, [gameState.phase]);

  // Synchronized Start Logic
  const [startingCountdown, setStartingCountdown] = useState(3);
  useEffect(() => {
    if (gameState.phase === 'STARTING') {
      const interval = setInterval(() => {
        const remaining = Math.ceil((gameState.startTimestamp - Date.now()) / 1000);
        if (remaining <= 0) {
          clearInterval(interval);
          if (isHost) {
            updateDoc(doc(db, 'lobbies', lobbyCode), {
              'gameState.phase': 'PLAYING',
              'gameState.playingStartTime': Date.now()
            });
          }
        } else {
          setStartingCountdown(remaining);
        }
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.startTimestamp, isHost, lobbyCode, db]);

  // Synchronized Playing Timer
  const [timeLeft, setTimeLeft] = useState(gameState.timerLimit || 90);
  useEffect(() => {
    if (gameState.phase === 'PLAYING' && gameState.playingStartTime) {
      setTimeLeft(gameState.timerLimit);
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - gameState.playingStartTime) / 1000);
        const remaining = Math.max(0, (gameState.timerLimit || 90) - elapsed);
        setTimeLeft(remaining);
        
        // Host automatically ends round when time runs out
        if (remaining <= 0 && isHost) {
          triggerRoundEnd();
        }
      }, 250);
      return () => clearInterval(interval);
    }
  }, [gameState.phase, gameState.playingStartTime, gameState.timerLimit, isHost]);

  // Submitting Phase: Everyone pushes answers automatically when phase turns to SUBMITTING
  const localAnswersRef = useRef(localAnswers);
  useEffect(() => {
    localAnswersRef.current = localAnswers;
  }, [localAnswers]);

  useEffect(() => {
    if (gameState.phase === 'SUBMITTING') {
      const lobbyRef = doc(db, 'lobbies', lobbyCode);
      // Auto-submit local data
      updateDoc(lobbyRef, {
        [`gameState.answers.${user.uid}`]: localAnswersRef.current
      });
      
      // Host waits 2.5s for everyone to sync, then moves to REVIEW
      if (isHost) {
        const timer = setTimeout(() => {
          endRound();
        }, 2500);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState.phase, isHost, lobbyCode, db, user.uid]);

  const addRandomCategory = () => {
    const available = randomCategories.filter(c => !setupCategories.includes(c));
    if (available.length === 0) return;
    setSetupCategories([...setupCategories, available[Math.floor(Math.random() * available.length)]]);
  };

  const addCategory = (e) => {
    e.preventDefault();
    const cat = newCatInput.trim();
    if (cat && !setupCategories.includes(cat)) {
      setSetupCategories([...setupCategories, cat]);
      setNewCatInput('');
    }
  };

  const removeCategory = (cat) => setSetupCategories(setupCategories.filter(c => c !== cat));

  const toggleModalCat = (cat) => {
    if (modalSelectedCats.includes(cat)) setModalSelectedCats(modalSelectedCats.filter(c => c !== cat));
    else setModalSelectedCats([...modalSelectedCats, cat]);
  };

  const confirmModalCats = () => {
    const newCats = modalSelectedCats.filter(c => !setupCategories.includes(c));
    setSetupCategories([...setupCategories, ...newCats]);
    setShowCatModal(false);
    setModalSelectedCats([]);
  };

  const toggleLetter = (letter) => {
    if (excludedLetters.includes(letter)) setExcludedLetters(excludedLetters.filter(l => l !== letter));
    else setExcludedLetters([...excludedLetters, letter]);
  };

  const getValidLetter = (excluded) => {
    const available = ALPHABET.filter(l => !excluded.includes(l));
    if (available.length === 0) return 'A';
    return available[Math.floor(Math.random() * available.length)];
  };

  const startGame = async () => {
    if (setupCategories.length === 0) return alert('Bitte wähle mindestens eine Kategorie.');
    
    let finalRounds = parseInt(setupRounds, 10);
    if (isNaN(finalRounds) || finalRounds < 1) finalRounds = 3;
    
    let finalTimer = parseInt(setupTimer, 10);
    if (isNaN(finalTimer)) finalTimer = 90;
    finalTimer = Math.max(30, Math.min(240, finalTimer));

    const letter = getValidLetter(excludedLetters);
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    
    await updateDoc(lobbyRef, {
      'gameState.categories': setupCategories,
      'gameState.maxRounds': finalRounds,
      'gameState.timerLimit': finalTimer,
      'gameState.currentRound': 1,
      'gameState.excludedLetters': excludedLetters,
      'gameState.letter': letter,
      'gameState.phase': 'STARTING',
      'gameState.startTimestamp': Date.now() + 4000,
      'gameState.answers': {},
      'gameState.votes': {}
    });
  };

  const nextRound = async () => {
    const letter = getValidLetter(gameState.excludedLetters || []);
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const { roundScores } = calculateDynamicScores();
    const updatedGameScores = { ...(gameState.gameScores || {}) };
    players.forEach(p => {
      updatedGameScores[p.id] = (updatedGameScores[p.id] || 0) + (roundScores[p.id] || 0);
    });

    await updateDoc(lobbyRef, {
      'gameState.gameScores': updatedGameScores,
      'gameState.currentRound': gameState.currentRound + 1,
      'gameState.letter': letter,
      'gameState.phase': 'STARTING',
      'gameState.startTimestamp': Date.now() + 4000,
      'gameState.answers': {},
      'gameState.votes': {}
    });
  };

  // Triggers end of round for everyone instantly
  const triggerRoundEnd = async () => {
    if (gameState.phase !== 'PLAYING') return;
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'SUBMITTING'
    });
  };

  const endRound = async () => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const initialVotes = {};
    const categories = gameState.categories || [];
    players.forEach(p => {
      initialVotes[p.id] = {};
      categories.forEach(cat => {
        initialVotes[p.id][cat] = { reject: [], duplicate: [] };
      });
    });

    await updateDoc(lobbyRef, {
      'gameState.phase': 'REVIEW',
      'gameState.votes': initialVotes
    });
  };

  const toggleVote = async (targetPid, cat, type) => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    const currentVotes = gameState.votes?.[targetPid]?.[cat]?.[type] || [];
    let newVotes = currentVotes.includes(user.uid) ? currentVotes.filter(uid => uid !== user.uid) : [...currentVotes, user.uid];
    await updateDoc(lobbyRef, { [`gameState.votes.${targetPid}.${cat}.${type}`]: newVotes });
  };

  const calculateDynamicScores = () => {
    const roundScores = {};
    const detailedScores = {};
    const threshold = Math.floor(players.length / 2) + 1;

    players.forEach(p => { roundScores[p.id] = 0; detailedScores[p.id] = {}; });

    const categories = gameState.categories || [];
    const allAnswers = gameState.answers || {};

    categories.forEach(cat => {
      const validAnswers = {};
      const explicitDuplicates = {};

      Object.entries(allAnswers).forEach(([pid, ansObj]) => {
        const word = ansObj[cat]?.trim().toLowerCase();
        const votes = gameState.votes?.[pid]?.[cat] || { reject: [], duplicate: [] };
        
        const isRejected = votes.reject.length >= threshold;
        const isExplicitDuplicate = votes.duplicate.length >= threshold;

        if (word && word.startsWith((gameState.letter || '').toLowerCase()) && !isRejected) {
          validAnswers[pid] = word;
          if (isExplicitDuplicate) explicitDuplicates[pid] = true;
        }
      });

      const validCount = Object.keys(validAnswers).length;

      Object.entries(validAnswers).forEach(([pid, word]) => {
        const sameWordCount = Object.values(validAnswers).filter(w => w === word).length;
        const isDuplicate = sameWordCount > 1 || explicitDuplicates[pid];
        let pts = isDuplicate ? 5 : (validCount === 1 ? 20 : 10);
        roundScores[pid] += pts;
        detailedScores[pid][cat] = pts;
      });
    });

    return { roundScores, detailedScores };
  };

  if (gameState.phase === 'SETUP') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4 sm:p-6 relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
        
        {showCatModal && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 p-6 rounded-3xl w-full max-w-lg border border-slate-700 shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h4 className="text-xl font-bold">Kategorien auswählen</h4>
                <button onClick={() => setShowCatModal(false)} className="text-slate-400 hover:text-white"><X size={24} /></button>
              </div>
              <div className="flex flex-wrap gap-2 mb-8 max-h-[50vh] overflow-y-auto pr-2">
                {randomCategories.map(c => (
                  <button key={c} onClick={() => toggleModalCat(c)} className={`px-4 py-2 rounded-xl border text-sm transition-all ${modalSelectedCats.includes(c) ? 'bg-purple-600 border-purple-500 text-white shadow-lg shadow-purple-900/30' : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}>{c}</button>
                ))}
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={() => setShowCatModal(false)} className="px-5 py-2.5 rounded-xl font-medium text-slate-300 hover:bg-slate-700 transition-colors">Abbrechen</button>
                <button onClick={confirmModalCats} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-2.5 rounded-xl font-bold transition-all shadow-lg">Hinzufügen</button>
              </div>
            </div>
          </div>
        )}

        <h2 className="text-4xl font-bold mb-2 text-purple-400 mt-8">Stadt Land Fluss</h2>
        
        {isHost ? (
          <div className="w-full max-w-3xl bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl mt-6">
            <h3 className="text-xl font-bold mb-4 flex items-center gap-2"><Settings size={20} className="text-indigo-400" /> Spieleinstellungen</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Anzahl der Runden</label>
                <input type="text" inputMode="numeric" value={setupRounds} onChange={(e) => setSetupRounds(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="3"/>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Timer (Sekunden)</label>
                <input type="text" inputMode="numeric" value={setupTimer} onChange={(e) => setSetupTimer(e.target.value.replace(/\D/g, ''))} className="w-full bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="90"/>
                <p className="text-xs text-slate-500 mt-1">Zwischen 30s und 240s</p>
              </div>

              <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700">
                <label className="block text-sm font-medium text-slate-400 mb-2">Ausgeschlossen ({excludedLetters.length})</label>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                  {ALPHABET.map(l => (
                    <button key={l} onClick={() => toggleLetter(l)} className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-colors ${excludedLetters.includes(l) ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}>{l}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mb-6 bg-slate-900/50 p-4 rounded-xl border border-slate-700">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end mb-4 gap-2">
                <label className="block text-sm font-medium text-slate-400">Kategorien ({setupCategories.length})</label>
                <div className="flex flex-wrap gap-2">
                  <button onClick={addRandomCategory} className="text-xs flex items-center gap-1 bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 px-3 py-1.5 rounded-lg transition-colors"><Dices size={14} /> Zufall</button>
                  <button onClick={() => setShowCatModal(true)} className="text-xs flex items-center gap-1 bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 px-3 py-1.5 rounded-lg transition-colors"><List size={14} /> Aus Liste</button>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {setupCategories.map(cat => (
                  <div key={cat} className="flex items-center gap-2 bg-slate-800 border border-slate-600 px-3 py-1.5 rounded-lg text-sm">
                    <span>{cat}</span>
                    <button onClick={() => removeCategory(cat)} className="text-red-400 hover:text-red-300"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>

              <form onSubmit={addCategory} className="flex gap-2">
                <input type="text" value={newCatInput} onChange={(e) => setNewCatInput(e.target.value)} placeholder="Neue Kategorie..." className="flex-grow bg-slate-800 border border-slate-600 rounded-xl px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"/>
                <button type="submit" className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-xl flex items-center gap-1 transition-colors"><Plus size={18} /> <span className="hidden sm:inline">Hinzufügen</span></button>
              </form>
            </div>

            <div className="flex gap-4 w-full">
              <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-4 py-4 rounded-2xl font-bold transition-all active:scale-95">Zurück</button>
              <button onClick={startGame} className="w-2/3 bg-purple-600 hover:bg-purple-500 text-white px-4 py-4 rounded-2xl font-bold text-xl shadow-lg transition-all active:scale-95">Spiel starten</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 mt-8">
            <div className="flex items-center gap-3 text-slate-400 bg-slate-800 px-6 py-4 rounded-xl border border-slate-700">
              <span className="animate-pulse">Der Host konfiguriert das Spiel...</span>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Countdown view right before the round officially starts
  if (gameState.phase === 'STARTING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <h2 className="text-3xl sm:text-4xl font-bold mb-6 text-slate-400">Runde {gameState.currentRound} startet in...</h2>
        <div className="text-8xl sm:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-br from-purple-400 to-pink-500 animate-pulse drop-shadow-[0_0_20px_rgba(168,85,247,0.5)]">
          {startingCountdown > 0 ? startingCountdown : 'LOS!'}
        </div>
      </div>
    );
  }

  // During the game (answering)
  if (gameState.phase === 'PLAYING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-2xl" />
        <div className="max-w-2xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div className="inline-block bg-slate-800 border border-slate-700 px-4 py-1.5 rounded-full text-slate-400 text-sm font-medium">
              Runde {gameState.currentRound} von {gameState.maxRounds}
            </div>
            
            {/* Countdown Timer Display */}
            <div className={`text-2xl font-black tabular-nums tracking-wider px-4 py-1.5 rounded-lg border ${timeLeft <= 10 ? 'text-red-400 border-red-500/50 bg-red-500/10 animate-pulse' : 'text-slate-200 border-slate-700 bg-slate-800'}`}>
               {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
          
          <div className="text-center mb-6">
            <p className="text-slate-400 font-medium uppercase tracking-widest text-sm mb-2">Der Buchstabe ist</p>
            <div className="w-28 h-28 sm:w-32 sm:h-32 mx-auto bg-gradient-to-br from-purple-500 to-pink-500 rounded-3xl flex items-center justify-center text-6xl sm:text-7xl font-black shadow-2xl shadow-purple-900/40">
              {gameState.letter}
            </div>
          </div>

          <div className="space-y-4 bg-slate-800 p-6 sm:p-8 rounded-3xl border border-slate-700 shadow-xl">
            {(gameState.categories || []).map((category) => (
              <div key={category}>
                <label className="block text-sm font-medium text-slate-400 mb-1 pl-1">{category}</label>
                <input 
                  type="text" 
                  value={localAnswers[category] || ''} 
                  onChange={(e) => setLocalAnswers({...localAnswers, [category]: e.target.value})} 
                  placeholder={`${gameState.letter}...`} 
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all text-lg"
                />
              </div>
            ))}
            
            <button 
              onClick={triggerRoundEnd} 
              className="w-full mt-6 bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white font-bold py-4 px-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-green-900/20"
            >
              Fertig! (Beendet Runde für alle)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Grace period to sync all answers to the server
  if (gameState.phase === 'SUBMITTING') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
        <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-purple-500 mb-6"></div>
        <h2 className="text-3xl font-bold text-slate-200 mb-2">Runde beendet!</h2>
        <p className="text-slate-400 text-center">Eingaben werden synchronisiert...<br/>Bitte warten.</p>
      </div>
    );
  }

  // Review & Voting Phase
  if (gameState.phase === 'REVIEW') {
    const { roundScores, detailedScores } = calculateDynamicScores();
    const threshold = Math.floor(players.length / 2) + 1;
    const isLastRound = gameState.currentRound >= gameState.maxRounds;

    const baseScores = gameState.gameScores || {};
    const displayScores = {};
    players.forEach(p => { displayScores[p.id] = (baseScores[p.id] || 0) + (roundScores[p.id] || 0); });
    
    // Function to calculate exact ranks with ties
    const getRankedPlayers = (scores) => {
      const sorted = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
      let currentRank = 1;
      return sorted.map((p, i) => {
        if (i > 0 && (scores[p.id] || 0) < (scores[sorted[i - 1].id] || 0)) {
          currentRank = i + 1;
        }
        return { ...p, rank: currentRank, roundScore: scores[p.id] || 0 };
      });
    };
    
    const rankedPlayers = getRankedPlayers(displayScores);

    // Host Action: Go to final results instead of directly to lobby
    const showFinalResults = async () => {
      const finalGameScores = { ...(gameState.gameScores || {}) };
      players.forEach(p => { 
        finalGameScores[p.id] = (finalGameScores[p.id] || 0) + (roundScores[p.id] || 0); 
      });

      await updateDoc(doc(db, 'lobbies', lobbyCode), {
        'gameState.phase': 'FINAL_RESULTS',
        'gameState.gameScores': finalGameScores
      });
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
         <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
         <div className="max-w-5xl mx-auto">
            <div className="text-center mb-10">
              <h2 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-2">Runden-Ergebnisse</h2>
              <p className="text-slate-400">Runde {gameState.currentRound} von {gameState.maxRounds} — <b>Abstimmungs-Phase</b> ({threshold} Votes für Mehrheit benötigt)</p>
            </div>

            <div className={`grid grid-cols-1 ${!isLastRound ? 'lg:grid-cols-3' : ''} gap-8`}>
              <div className={`${!isLastRound ? 'lg:col-span-2' : 'w-full'} bg-slate-800 rounded-3xl p-6 border border-slate-700 h-fit`}>
                <h3 className="text-xl font-bold mb-6 border-b border-slate-700 pb-2">Eingereichte Antworten & Voting</h3>
                
                <div className="space-y-8">
                  {(gameState.categories || []).map(cat => (
                    <div key={cat} className="bg-slate-900/50 p-5 rounded-2xl border border-slate-700/50 shadow-md">
                      <h4 className="text-xl font-bold text-purple-300 mb-4 pb-2 border-b border-slate-700/50 flex items-center gap-2">
                        <span className="bg-purple-500/20 text-purple-400 px-3 py-1 rounded-lg">{cat}</span>
                      </h4>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                        {players.map(p => {
                          const pId = p.id;
                          const ans = gameState.answers?.[pId] || {};
                          const word = ans[cat]?.trim();
                          const detailPts = detailedScores[pId]?.[cat] || 0;
                          
                          const votes = gameState.votes?.[pId]?.[cat] || { reject: [], duplicate: [] };
                          const isRejected = votes.reject.length >= threshold;
                          const isDuplicate = votes.duplicate.length >= threshold;
                          const myReject = votes.reject.includes(user.uid);
                          const myDupe = votes.duplicate.includes(user.uid);

                          return (
                            <div key={pId} className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/50 flex flex-col gap-2 relative">
                              <div className="flex justify-between items-center mb-1">
                                 <span className="text-xs font-medium text-slate-400">{p.name} {pId === user.uid && '(Du)'}</span>
                                 {word && <span className={`text-[11px] font-bold shrink-0 px-2 py-0.5 rounded ${detailPts > 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>{detailPts > 0 ? `+${detailPts}` : '0'}</span>}
                              </div>
                              
                              <div className="flex justify-between items-start gap-2 min-h-[1.5rem]">
                                <span className={`break-words block font-medium text-lg ${isRejected ? 'line-through text-slate-600' : isDuplicate ? 'text-orange-300' : 'text-slate-200'}`} title={word || '-'}>{word || '-'}</span>
                              </div>
                              
                              {word && (
                                <div className="flex gap-2 mt-2 border-t border-slate-700/50 pt-2">
                                  <button onClick={() => toggleVote(pId, cat, 'reject')} className={`flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${myReject ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 border border-transparent'}`} title={`${threshold} Votes nötig`}>
                                    <ThumbsDown size={14} /> {votes.reject.length > 0 && `${votes.reject.length}/${threshold}`}
                                  </button>
                                  <button onClick={() => toggleVote(pId, cat, 'duplicate')} className={`flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-colors ${myDupe ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600 border border-transparent'}`} title={`${threshold} Votes für Dopplung`}>
                                    <Files size={14} /> {votes.duplicate.length > 0 && `${votes.duplicate.length}/${threshold}`}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Hide Live Ranking on the very last round to keep tension */}
              {!isLastRound && (
                <div className="lg:col-span-1 bg-slate-800 rounded-3xl p-6 border border-slate-700 h-fit">
                  <h3 className="text-xl font-bold mb-4 border-b border-slate-700 pb-2 flex items-center gap-2"><Trophy className="text-yellow-500" /> Live-Ranking</h3>
                  <div className="space-y-2">
                    {rankedPlayers.map((p) => (
                      <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg transition-all ${p.rank === 1 ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-300' : 'bg-slate-900/50 text-slate-200'}`}>
                        <div className="flex items-center gap-3"><span className="font-bold opacity-50">#{p.rank}</span><span className="font-medium">{p.name} {p.id === user.uid && '(Du)'}</span></div>
                        <span className="font-mono font-bold text-lg">{p.roundScore} Pkt</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {isHost && (
              <div className="mt-10 flex flex-col sm:flex-row justify-center gap-4">
                <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-medium transition-colors">Spiel abbrechen</button>
                {isLastRound ? (
                  <button onClick={showFinalResults} className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95 text-lg">Zu den Endergebnissen</button>
                ) : (
                  <button onClick={nextRound} className="bg-purple-600 hover:bg-purple-500 text-white px-6 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">Nächste Runde ({gameState.currentRound + 1}/{gameState.maxRounds})</button>
                )}
              </div>
            )}
            {!isHost && <p className="mt-10 text-center text-slate-500">Warte auf Host für die nächste Aktion...</p>}
         </div>
      </div>
    );
  }

  // FINAL RESULTS (Podium) Phase
  if (gameState.phase === 'FINAL_RESULTS') {
    const finalScores = gameState.gameScores || {};
    
    // Compute exact rankings with ties
    const getFinalRankings = (scores) => {
      const sorted = [...players].sort((a, b) => (scores[b.id] || 0) - (scores[a.id] || 0));
      let currentRank = 1;
      return sorted.map((p, i) => {
        if (i > 0 && (scores[p.id] || 0) < (scores[sorted[i - 1].id] || 0)) {
          currentRank = i + 1;
        }
        return { ...p, rank: currentRank, finalScore: scores[p.id] || 0 };
      });
    };
    
    const finalRankedPlayers = getFinalRankings(finalScores);

    const distributePointsAndReturnToLobby = async () => {
      if (lobby.settings.globalLeaderboard) {
        let newPlayers = [...players].map(p => {
          const r = finalRankedPlayers.find(rp => rp.id === p.id);
          let addedPoints = 0;
          if (r) {
            if (r.rank === 1) addedPoints = 5;
            else if (r.rank === 2) addedPoints = 3;
            else if (r.rank === 3) addedPoints = 1;
          }
          return { ...p, globalScore: p.globalScore + addedPoints };
        });
        await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
      } else {
        await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
      }
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 relative">
         <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-3xl" hideHostButton={true} />
         <div className="max-w-3xl mx-auto flex flex-col items-center">
            <div className="text-center mb-10 mt-6">
              <h2 className="text-5xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-orange-500 mb-4 tracking-wider uppercase drop-shadow-md">Endergebnisse</h2>
              <p className="text-slate-400 text-lg">Das Spiel ist vorbei! Hier ist die finale Platzierung.</p>
            </div>

            <div className="w-full bg-slate-800 rounded-3xl p-6 sm:p-10 border border-slate-700 shadow-2xl mb-10 space-y-4">
              {finalRankedPlayers.map((p) => {
                let rowBg = 'bg-slate-900/50 text-slate-400 border-slate-700/50';
                if (p.rank === 1) rowBg = 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300 shadow-[0_0_15px_rgba(234,179,8,0.2)]';
                else if (p.rank === 2) rowBg = 'bg-slate-300/20 border-slate-300/50 text-slate-200';
                else if (p.rank === 3) rowBg = 'bg-orange-600/20 border-orange-600/50 text-orange-300';

                return (
                  <div key={p.id} className={`flex justify-between items-center p-5 rounded-2xl border transition-all ${rowBg}`}>
                    <div className="flex items-center gap-4">
                      <span className="text-3xl font-black opacity-80 w-10">#{p.rank}</span>
                      <span className="text-xl font-bold">{p.name} {p.id === user.uid && '(Du)'}</span>
                    </div>
                    <span className="text-2xl font-mono font-black">{p.finalScore} <span className="text-sm font-medium opacity-70">Pkt</span></span>
                  </div>
                );
              })}
            </div>

            {isHost ? (
              <button onClick={distributePointsAndReturnToLobby} className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-10 py-4 rounded-2xl font-bold text-xl shadow-xl transition-all active:scale-95">
                Punkte verteilen & Zurück zur Lobby
              </button>
            ) : (
              <p className="text-slate-500 italic text-lg">Warte auf Host für die Rückkehr zur Lobby...</p>
            )}
         </div>
      </div>
    );
  }

  return null;
}