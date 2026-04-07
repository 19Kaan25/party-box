import React from 'react';
import { X, LogOut } from 'lucide-react';

const GameHeader = ({ isHost, leaveLobby, updateLobbyStatus, absolute = false, maxWidthClass = "max-w-2xl", hideHostButton = false }) => {
  
  const handleEndGame = () => {
    if (window.confirm("Bist du sicher, dass du das Spiel für ALLE beenden möchtest?")) {
      updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} });
    }
  };

  const handleLeaveGame = () => {
    if (window.confirm("Bist du sicher, dass du das Spiel verlassen möchtest?")) {
      leaveLobby();
    }
  };

  const content = (
    <>
      {isHost && !hideHostButton ? (
        <button onClick={handleEndGame} className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm bg-red-400/10 px-3 py-1.5 rounded-lg transition-colors border border-red-500/20 backdrop-blur-sm shadow-lg">
          <X size={16} /> Spiel beenden
        </button>
      ) : (
        <button onClick={handleLeaveGame} className="flex items-center gap-1 text-red-400 hover:text-red-300 text-sm bg-red-400/10 px-3 py-1.5 rounded-lg transition-colors border border-red-500/20 backdrop-blur-sm shadow-lg">
          <LogOut size={16} /> Spiel verlassen
        </button>
      )}
    </>
  );

  if (absolute) return <div className="absolute top-4 right-4 sm:top-8 sm:right-8 z-50">{content}</div>;
  return <div className={`w-full ${maxWidthClass} mx-auto flex justify-end mb-4 z-50`}>{content}</div>;
};

export default GameHeader;