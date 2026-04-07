import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { Settings, Search, Plus, Pin, PinOff } from 'lucide-react';

import GameHeader from '../components/GameHeader';
import { CODENAMES_WORDS } from '../constants/gameData';
import { shuffleArray } from '../utils/helpers';

export default function CodenamesEngine({ lobby, user, isHost, db, updateLobbyStatus, leaveLobby }) {
  const { gameState, players, id: lobbyCode } = lobby;
  
  const [clueWord, setClueWord] = useState('');
  const [clueCount, setClueCount] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [customWordInput, setCustomWordInput] = useState('');
  const [pinnedWords, setPinnedWords] = useState([]);
  const [customWords, setCustomWords] = useState([]);

  const joinTeam = async (teamColor, role) => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    let newTeams = { red: [...(gameState.teams?.red || [])], blue: [...(gameState.teams?.blue || [])] };
    let newSpymasters = { red: gameState.spymasters?.red, blue: gameState.spymasters?.blue };

    newTeams.red = newTeams.red.filter(id => id !== user.uid);
    newTeams.blue = newTeams.blue.filter(id => id !== user.uid);
    if (newSpymasters.red === user.uid) newSpymasters.red = null;
    if (newSpymasters.blue === user.uid) newSpymasters.blue = null;

    newTeams[teamColor].push(user.uid);
    if (role === 'SPYMASTER') {
      newSpymasters[teamColor] = user.uid;
    }

    await updateDoc(lobbyRef, {
      'gameState.teams': newTeams,
      'gameState.spymasters': newSpymasters
    });
  };

  const proceedToBoardSetup = async () => {
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'BOARD_SETUP',
      'gameState.pinnedWords': [],
      'gameState.customWords': []
    });
  };

  const togglePin = (word) => {
    if (pinnedWords.includes(word)) {
      setPinnedWords(pinnedWords.filter(w => w !== word));
    } else {
      if (pinnedWords.length >= 25) return;
      setPinnedWords([...pinnedWords, word]);
    }
  };

  const addCustomWord = (e) => {
    e.preventDefault();
    const w = customWordInput.trim().toUpperCase();
    if (w && !customWords.includes(w) && !CODENAMES_WORDS.map(x=>x.toUpperCase()).includes(w)) {
      setCustomWords([...customWords, w]);
      if (pinnedWords.length < 25) {
        setPinnedWords([...pinnedWords, w]);
      }
    }
    setCustomWordInput('');
  };

  const generateBoard = async () => {
    const startingTeam = Math.random() < 0.5 ? 'red' : 'blue';
    const otherTeam = startingTeam === 'red' ? 'blue' : 'red';
    
    const colors = [
      ...Array(9).fill(startingTeam),
      ...Array(8).fill(otherTeam),
      ...Array(7).fill('neutral'),
      'black'
    ];
    const shuffledColors = shuffleArray(colors);
    
    let allAvailable = [...CODENAMES_WORDS.map(w=>w.toUpperCase()), ...customWords].filter(w => !pinnedWords.includes(w));
    allAvailable = shuffleArray(allAvailable);
    
    let finalWords = [...pinnedWords];
    const needed = 25 - finalWords.length;
    finalWords = [...finalWords, ...allAvailable.slice(0, needed)];
    finalWords = shuffleArray(finalWords);
    
    const board = finalWords.map((word, i) => ({
      id: i,
      word: word,
      color: shuffledColors[i],
      isRevealed: false
    }));

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.phase': 'PLAYING',
      'gameState.board': board,
      'gameState.turn': `${startingTeam.toUpperCase()}_SPYMASTER`,
      'gameState.currentClue': null,
      'gameState.winner': null,
      'gameState.startingTeam': startingTeam,
      'gameState.customWords': customWords
    });
  };

  const submitClue = async () => {
    if (!clueWord.trim()) return;
    
    let parsedCount = parseInt(clueCount, 10);
    if (isNaN(parsedCount) || parsedCount < 1) parsedCount = 1;
    if (parsedCount > 9) parsedCount = 9;

    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.currentClue': { word: clueWord.trim(), count: parsedCount, guessesLeft: parsedCount + 1 },
      'gameState.turn': `${currentTeam.toUpperCase()}_OPERATIVE`
    });
    setClueWord('');
    setClueCount(1);
  };

  const endTurn = async () => {
    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const nextTeam = currentTeam === 'red' ? 'blue' : 'red';
    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.turn': `${nextTeam.toUpperCase()}_SPYMASTER`,
      'gameState.currentClue': null
    });
  };

  const guessWord = async (cardIndex) => {
    const card = gameState.board[cardIndex];
    if (card.isRevealed) return;

    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const nextTeam = currentTeam === 'red' ? 'blue' : 'red';
    
    let newBoard = [...gameState.board];
    newBoard[cardIndex] = { ...card, isRevealed: true };

    let newTurn = gameState.turn;
    let newClue = gameState.currentClue ? { ...gameState.currentClue } : null;
    let winner = null;

    if (card.color === 'black') {
      winner = nextTeam;
    } else if (card.color === currentTeam) {
      if (newClue) {
        newClue.guessesLeft -= 1;
        if (newClue.guessesLeft <= 0) {
          newTurn = `${nextTeam.toUpperCase()}_SPYMASTER`;
          newClue = null;
        }
      }
    } else {
      newTurn = `${nextTeam.toUpperCase()}_SPYMASTER`;
      newClue = null;
    }

    if (!winner) {
      const redLeft = newBoard.filter(c => c.color === 'red' && !c.isRevealed).length;
      const blueLeft = newBoard.filter(c => c.color === 'blue' && !c.isRevealed).length;
      if (redLeft === 0) winner = 'red';
      if (blueLeft === 0) winner = 'blue';
    }

    const lobbyRef = doc(db, 'lobbies', lobbyCode);
    await updateDoc(lobbyRef, {
      'gameState.board': newBoard,
      'gameState.turn': newTurn,
      'gameState.currentClue': newClue,
      ...(winner && { 'gameState.phase': 'REVIEW', 'gameState.winner': winner })
    });
  };

  const myTeam = gameState.teams?.red.includes(user.uid) ? 'red' : (gameState.teams?.blue.includes(user.uid) ? 'blue' : null);
  const myRole = (gameState.spymasters?.red === user.uid || gameState.spymasters?.blue === user.uid) ? 'SPYMASTER' : 'OPERATIVE';
  const isMyTurn = gameState.turn?.startsWith(myTeam?.toUpperCase()) && gameState.turn?.endsWith(myRole);

  if (gameState.phase === 'TEAM_SETUP') {
    const redTeamIds = gameState.teams?.red || [];
    const blueTeamIds = gameState.teams?.blue || [];
    const redSpy = gameState.spymasters?.red;
    const blueSpy = gameState.spymasters?.blue;
    const unassignedPlayers = players.filter(p => !redTeamIds.includes(p.id) && !blueTeamIds.includes(p.id));

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
        <div className="max-w-5xl mx-auto w-full flex-grow flex flex-col">
          <div className="text-center mb-8 mt-6">
            <h2 className="text-4xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-blue-500 uppercase">Codenames</h2>
            <p className="text-slate-400 mt-2">Wählt eure Teams und bestimmt die Geheimdienstchefs.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow">
            {/* Team Red */}
            <div className="bg-red-950/30 border border-red-500/30 rounded-3xl p-6 flex flex-col">
              <h3 className="text-2xl font-bold text-red-500 mb-6 flex items-center justify-between">
                Team Rot <span className="text-sm bg-red-500/20 px-3 py-1 rounded-full">{redTeamIds.length} Agenten</span>
              </h3>
              <div className="mb-6">
                <h4 className="text-sm uppercase tracking-wider text-red-400/70 mb-3">Geheimdienstchef (max. 1)</h4>
                <div className="min-h-[60px] bg-slate-900/50 rounded-xl border border-slate-800 flex items-center justify-between p-3">
                  {redSpy ? (
                    <span className="font-bold text-red-300 flex items-center gap-2">
                      <Settings size={18} /> {players.find(p => p.id === redSpy)?.name} {redSpy === user.uid && '(Du)'}
                    </span>
                  ) : <span className="text-slate-500 italic text-sm">Vakant</span>}
                  {redSpy !== user.uid && (
                    <button onClick={() => joinTeam('red', 'SPYMASTER')} className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded transition-colors">Chef werden</button>
                  )}
                </div>
              </div>
              <div className="flex-grow">
                <h4 className="text-sm uppercase tracking-wider text-red-400/70 mb-3">Ermittler</h4>
                <div className="space-y-2 mb-4">
                  {redTeamIds.filter(id => id !== redSpy).length === 0 && <p className="text-slate-500 italic text-sm">Keine Ermittler</p>}
                  {redTeamIds.filter(id => id !== redSpy).map(id => (
                    <div key={id} className="bg-slate-900/50 rounded-xl border border-slate-800 p-3 text-slate-300 font-medium">
                      {players.find(p => p.id === id)?.name} {id === user.uid && '(Du)'}
                    </div>
                  ))}
                </div>
                {!redTeamIds.includes(user.uid) || redSpy === user.uid ? (
                  <button onClick={() => joinTeam('red', 'OPERATIVE')} className="w-full border-2 border-dashed border-red-500/30 hover:border-red-500/60 text-red-400/70 hover:text-red-400 py-3 rounded-xl transition-all">+ Als Ermittler beitreten</button>
                ) : null}
              </div>
            </div>

            {/* Team Blue */}
            <div className="bg-blue-950/30 border border-blue-500/30 rounded-3xl p-6 flex flex-col">
              <h3 className="text-2xl font-bold text-blue-500 mb-6 flex items-center justify-between">
                Team Blau <span className="text-sm bg-blue-500/20 px-3 py-1 rounded-full">{blueTeamIds.length} Agenten</span>
              </h3>
              <div className="mb-6">
                <h4 className="text-sm uppercase tracking-wider text-blue-400/70 mb-3">Geheimdienstchef (max. 1)</h4>
                <div className="min-h-[60px] bg-slate-900/50 rounded-xl border border-slate-800 flex items-center justify-between p-3">
                  {blueSpy ? (
                    <span className="font-bold text-blue-300 flex items-center gap-2">
                      <Settings size={18} /> {players.find(p => p.id === blueSpy)?.name} {blueSpy === user.uid && '(Du)'}
                    </span>
                  ) : <span className="text-slate-500 italic text-sm">Vakant</span>}
                  {blueSpy !== user.uid && (
                    <button onClick={() => joinTeam('blue', 'SPYMASTER')} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded transition-colors">Chef werden</button>
                  )}
                </div>
              </div>
              <div className="flex-grow">
                <h4 className="text-sm uppercase tracking-wider text-blue-400/70 mb-3">Ermittler</h4>
                <div className="space-y-2 mb-4">
                  {blueTeamIds.filter(id => id !== blueSpy).length === 0 && <p className="text-slate-500 italic text-sm">Keine Ermittler</p>}
                  {blueTeamIds.filter(id => id !== blueSpy).map(id => (
                    <div key={id} className="bg-slate-900/50 rounded-xl border border-slate-800 p-3 text-slate-300 font-medium">
                      {players.find(p => p.id === id)?.name} {id === user.uid && '(Du)'}
                    </div>
                  ))}
                </div>
                {!blueTeamIds.includes(user.uid) || blueSpy === user.uid ? (
                  <button onClick={() => joinTeam('blue', 'OPERATIVE')} className="w-full border-2 border-dashed border-blue-500/30 hover:border-blue-500/60 text-blue-400/70 hover:text-blue-400 py-3 rounded-xl transition-all">+ Als Ermittler beitreten</button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-8 bg-slate-800 rounded-3xl p-6 border border-slate-700 flex flex-col md:flex-row items-center justify-between gap-6">
            <div>
              <h4 className="text-sm uppercase tracking-wider text-slate-400 mb-2">Zuschauer / Nicht zugewiesen</h4>
              <div className="flex flex-wrap gap-2">
                {unassignedPlayers.length === 0 && <span className="text-slate-500 text-sm">Alle Spieler sind einem Team zugewiesen.</span>}
                {unassignedPlayers.map(p => (
                  <span key={p.id} className="bg-slate-900 px-3 py-1 rounded text-sm text-slate-300 border border-slate-700">
                    {p.name} {p.id === user.uid && '(Du)'}
                  </span>
                ))}
              </div>
            </div>

            {isHost && (
              <div className="flex gap-4 w-full md:w-auto">
                <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="flex-1 md:flex-none bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-xl font-medium transition-colors">
                  Zurück
                </button>
                <button onClick={proceedToBoardSetup} className="flex-1 md:flex-none bg-gradient-to-r from-red-600 to-blue-600 hover:from-red-500 hover:to-blue-500 text-white px-8 py-3 rounded-xl font-bold shadow-lg transition-all active:scale-95">
                  Spielfeld generieren
                </button>
              </div>
            )}
            {!isHost && <p className="text-slate-500 text-sm italic">Warte auf Host...</p>}
          </div>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'BOARD_SETUP') {
    if (!isHost) {
      return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-8 relative">
           <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} />
           <div className="flex items-center gap-3 text-slate-400 bg-slate-800 px-6 py-4 rounded-xl border border-slate-700">
              <span className="animate-pulse">Der Host konfiguriert das Spielfeld...</span>
           </div>
        </div>
      );
    }

    const allCombinedWords = [...CODENAMES_WORDS.map(w => w.toUpperCase()), ...customWords];
    const filteredWords = allCombinedWords.filter(w => w.includes(searchTerm.toUpperCase()) && !pinnedWords.includes(w));

    return (
      <div className="min-h-screen bg-slate-900 text-white p-4 sm:p-8 flex flex-col items-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
        <h2 className="text-3xl font-bold text-slate-200 mb-6">Spielfeld vorbereiten</h2>
        
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow mb-8">
          {/* Left: Word Pool */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex flex-col h-[60vh]">
            <h3 className="text-xl font-bold mb-4">Wort-Katalog</h3>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-3 text-slate-500" size={18} />
              <input type="text" placeholder="Wörter suchen..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-white focus:outline-none focus:border-red-500"/>
            </div>
            <form onSubmit={addCustomWord} className="flex gap-2 mb-4">
              <input type="text" placeholder="Eigenes Wort..." value={customWordInput} onChange={e => setCustomWordInput(e.target.value)} className="flex-grow bg-slate-900 border border-slate-700 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-red-500 uppercase"/>
              <button type="submit" className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-xl transition-colors"><Plus size={20} /></button>
            </form>
            <div className="flex-grow overflow-y-auto space-y-2 pr-2">
              {filteredWords.slice(0, 50).map(word => (
                <div key={word} className="flex items-center justify-between bg-slate-900/50 p-3 rounded-xl border border-slate-700/50">
                  <span className="font-medium tracking-wider">{word}</span>
                  <button onClick={() => togglePin(word)} className="text-slate-400 hover:text-white transition-colors"><Pin size={18} /></button>
                </div>
              ))}
              {filteredWords.length === 0 && <p className="text-sm text-slate-500 text-center py-2">Keine Wörter gefunden.</p>}
            </div>
          </div>

          {/* Right: Pinned Words */}
          <div className="bg-slate-800 p-6 rounded-3xl border border-slate-700 flex flex-col h-[60vh]">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Angepinnte Wörter</h3>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${pinnedWords.length === 25 ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'}`}>
                {pinnedWords.length} / 25
              </span>
            </div>
            <p className="text-sm text-slate-400 mb-4">Diese Wörter erscheinen garantiert im nächsten Spiel.</p>
            <div className="flex-grow overflow-y-auto space-y-2 pr-2">
              {pinnedWords.map(word => (
                <div key={word} className="flex items-center justify-between bg-blue-900/20 p-3 rounded-xl border border-blue-500/30">
                  <span className="font-medium tracking-wider text-blue-100">{word}</span>
                  <button onClick={() => togglePin(word)} className="text-red-400 hover:text-red-300 transition-colors"><PinOff size={18} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex gap-4 w-full max-w-5xl">
          <button onClick={() => updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })} className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white px-6 py-4 rounded-2xl font-bold transition-all active:scale-95 text-lg">
            Abbrechen
          </button>
          <button onClick={generateBoard} className="w-2/3 bg-gradient-to-r from-red-600 to-blue-600 hover:from-red-500 hover:to-blue-500 text-white px-8 py-4 rounded-2xl font-bold shadow-lg transition-all active:scale-95 text-xl">
            Spielfeld generieren
          </button>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'PLAYING') {
    const currentTeam = gameState.turn.split('_')[0].toLowerCase();
    const currentRole = gameState.turn.split('_')[1];
    const redLeft = gameState.board?.filter(c => c.color === 'red' && !c.isRevealed).length || 0;
    const blueLeft = gameState.board?.filter(c => c.color === 'blue' && !c.isRevealed).length || 0;

    return (
      <div className="min-h-screen bg-slate-900 text-white p-2 sm:p-8 flex flex-col items-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={false} maxWidthClass="max-w-5xl" />
        
        <div className="w-full max-w-5xl flex flex-col sm:flex-row justify-between items-center gap-4 mb-6 bg-slate-800 p-4 rounded-2xl border border-slate-700 shadow-lg">
          <div className="w-full sm:w-auto flex items-center justify-center">
            <div className={`w-full sm:w-auto text-center px-4 py-2.5 rounded-xl font-bold text-sm sm:text-base shadow-inner ${currentTeam === 'red' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'}`}>
              ZUG: TEAM {currentTeam === 'red' ? 'ROT' : 'BLAU'} ({currentRole === 'SPYMASTER' ? 'GEHEIMDIENSTCHEF' : 'ERMITTLER'})
            </div>
          </div>
          <div className="w-full sm:w-auto flex justify-center gap-6 font-mono text-lg sm:text-xl font-bold bg-slate-900/60 px-6 py-2.5 rounded-xl border border-slate-700/50">
            <span className="text-red-500 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span> ROT: {redLeft}
            </span>
            <span className="text-blue-500 flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></span> BLAU: {blueLeft}
            </span>
          </div>
        </div>

        <div className="w-full max-w-5xl mb-6 bg-slate-800 p-6 rounded-2xl border border-slate-700 flex flex-col sm:flex-row items-center justify-between gap-4">
          {gameState.currentClue ? (
            <div className="flex flex-wrap items-center gap-4 w-full">
              <span className="text-slate-400 font-medium">Hinweis:</span>
              <span className="text-xl sm:text-2xl font-black tracking-widest uppercase bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">{gameState.currentClue.word}</span>
              <span className="text-xl sm:text-2xl font-black bg-slate-900 px-4 py-2 rounded-lg border border-slate-700">{gameState.currentClue.count}</span>
              <span className="ml-auto text-sm text-slate-400">Verbleibende Tipps: <b className="text-white">{gameState.currentClue.guessesLeft}</b></span>
              {isMyTurn && myRole === 'OPERATIVE' && (
                <button onClick={endTurn} className="bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg sm:ml-4 transition-colors font-medium">Zug beenden</button>
              )}
            </div>
          ) : (
            <div className="w-full flex items-center justify-center text-slate-400">
              {currentRole === 'SPYMASTER' ? 'Der Geheimdienstchef überlegt...' : 'Warte auf Hinweis...'}
            </div>
          )}

          {isMyTurn && myRole === 'SPYMASTER' && !gameState.currentClue && (
             <div className="flex flex-col gap-3 w-full sm:w-80 mt-4 sm:mt-0">
               <input type="text" value={clueWord} onChange={(e) => setClueWord(e.target.value)} placeholder="Dein Hinweiswort" className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-slate-500 w-full"/>
               <div className="flex items-center gap-3">
                 <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden shrink-0 h-12">
                   <button onClick={() => setClueCount(Math.max(1, clueCount - 1))} className="w-12 h-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-bold text-2xl">-</button>
                   <div className="w-10 font-bold text-white text-center text-lg">{clueCount}</div>
                   <button onClick={() => setClueCount(Math.min(9, clueCount + 1))} className="w-12 h-full flex items-center justify-center bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors font-bold text-2xl">+</button>
                 </div>
                 <button onClick={submitClue} className="bg-green-600 hover:bg-green-500 text-white px-4 rounded-lg font-bold transition-colors flex-grow h-12">Senden</button>
               </div>
             </div>
          )}
        </div>

        <div className="w-full max-w-5xl grid grid-cols-5 gap-2 sm:gap-4 flex-grow">
          {(gameState.board || []).map((card, idx) => {
            const isSpymaster = myRole === 'SPYMASTER';
            const isInteractive = isMyTurn && myRole === 'OPERATIVE' && !card.isRevealed && gameState.currentClue;
            let cardBg = 'bg-slate-700 hover:bg-slate-600 border-slate-600';
            let textColor = 'text-white';
            
            if (card.isRevealed) {
              if (card.color === 'red') { cardBg = 'bg-red-500 border-red-600 shadow-inner'; }
              if (card.color === 'blue') { cardBg = 'bg-blue-500 border-blue-600 shadow-inner'; }
              if (card.color === 'neutral') { cardBg = 'bg-amber-100 border-amber-200'; textColor = 'text-slate-800'; }
              if (card.color === 'black') { cardBg = 'bg-slate-950 border-black shadow-inner'; }
            } else if (isSpymaster) {
              if (card.color === 'red') { cardBg = 'bg-red-950/80 border-red-900/50'; textColor = 'text-red-200'; }
              if (card.color === 'blue') { cardBg = 'bg-blue-950/80 border-blue-900/50'; textColor = 'text-blue-200'; }
              if (card.color === 'neutral') { cardBg = 'bg-amber-900/30 border-amber-900/50'; textColor = 'text-amber-100/70'; }
              if (card.color === 'black') { cardBg = 'bg-slate-900 border-slate-700'; textColor = 'text-slate-400'; }
            }

            return (
              <button key={idx} onClick={() => isInteractive && guessWord(idx)} disabled={!isInteractive}
                className={`relative flex items-center justify-center p-2 sm:p-4 rounded-xl border-2 font-bold text-[10px] sm:text-lg uppercase tracking-wider transition-all break-words ${cardBg} ${textColor} ${isInteractive ? 'cursor-pointer hover:scale-[1.02] active:scale-95 shadow-lg shadow-white/5 border-white/30' : 'cursor-default'} ${card.isRevealed ? 'opacity-90' : ''}`}
              >
                {card.isRevealed && card.color === 'black' && <span className="absolute text-3xl sm:text-4xl opacity-50">☠️</span>}
                <span className="z-10 text-center break-words w-full overflow-hidden">{card.word}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (gameState.phase === 'REVIEW') {
    const winnerColor = gameState.winner;
    const isWin = winnerColor === myTeam;

    const returnToLobby = async () => {
      if (lobby.settings.globalLeaderboard && winnerColor) {
        const winningTeamIds = gameState.teams[winnerColor] || [];
        let newPlayers = [...players].map(p => {
          if (winningTeamIds.includes(p.id)) {
            return { ...p, globalScore: p.globalScore + 5 }; // +5 Punkte für Sieg
          }
          return p;
        });
        await updateLobbyStatus('LOBBY_WAITING', null, { players: newPlayers, gameState: {} });
      } else {
        await updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
      }
    };

    return (
      <div className="min-h-screen bg-slate-900 text-white p-8 flex flex-col items-center justify-center relative">
        <GameHeader isHost={isHost} leaveLobby={leaveLobby} updateLobbyStatus={updateLobbyStatus} absolute={true} hideHostButton={true} />
        <h2 className="text-4xl sm:text-5xl font-black mb-4 uppercase tracking-widest text-center">
          {winnerColor === 'red' ? <span className="text-red-500">Team Rot</span> : <span className="text-blue-500">Team Blau</span>} gewinnt!
        </h2>
        {myTeam && (
          <p className={`text-2xl mb-8 text-center ${isWin ? 'text-green-400' : 'text-slate-500'}`}>
            {isWin ? 'Glückwunsch, Agent!' : 'Mission gescheitert.'}
          </p>
        )}
        <div className="w-full max-w-3xl grid grid-cols-5 gap-2 mb-10 opacity-70">
          {(gameState.board || []).map((card, idx) => {
            let cardBg = 'bg-slate-700';
            if (card.color === 'red') cardBg = 'bg-red-500 text-white';
            if (card.color === 'blue') cardBg = 'bg-blue-500 text-white';
            if (card.color === 'neutral') cardBg = 'bg-amber-100 text-slate-800';
            if (card.color === 'black') cardBg = 'bg-slate-950 text-white';

            return <div key={idx} className={`flex items-center justify-center p-2 rounded-lg text-[10px] sm:text-xs font-bold uppercase text-center break-words ${cardBg}`}>{card.word}</div>;
          })}
        </div>
        {isHost && (
          <button onClick={returnToLobby} className="bg-slate-700 hover:bg-slate-600 text-white px-8 py-4 rounded-xl font-bold shadow-lg transition-all active:scale-95 text-lg">
            Zurück zur Lobby
          </button>
        )}
      </div>
    );
  }

  return null;
}