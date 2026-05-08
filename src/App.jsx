import React, { useState } from 'react';

import useAuth from './hooks/useAuth';
import useLobby from './hooks/useLobby';

import ProfileModal from './components/auth/ProfileModal';
import GameRouter from './components/GameRouter';

const APP_VERSION = "v1.1.0";

export default function App() {
  const authLogic = useAuth();
  const { user, userData, loading: authLoading } = authLogic;

  // Initiale Orchestrierung der ausgelagerten Kern-Logik
  const lobbyLogic = useLobby(user, userData, authLogic.updateUserProfile);

  // Globale UI-States
  const [copied, setCopied] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // Globale Ladezustände
  if (authLoading) {
    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 animate-pulse">
          Lade Sitzung...
        </div>
    );
  }

  if (!user) {
    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
          Lade Authentifizierung...
        </div>
    );
  }

  // Globale UI-Handler
  const handleCopy = () => {
    if (navigator.clipboard && lobbyLogic.lobbyCode) {
      navigator.clipboard.writeText(lobbyLogic.lobbyCode).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const uiProps = {
    copied,
    handleCopy,
    setShowProfileModal
  };

  return (
      <>
        {/* Globales Profil-Overlay */}
        {showProfileModal && (
            <ProfileModal
                authLogic={authLogic}
                onClose={() => setShowProfileModal(false)}
            />
        )}

        {/* Zentrales Routing für Lobby und Minispiele */}
        <GameRouter
            authLogic={authLogic}
            lobbyLogic={lobbyLogic}
            uiProps={uiProps}
        />

        {/* Globale App-Version */}
        <div className="fixed bottom-2 right-2 text-[10px] text-slate-600/50 font-mono z-[60] pointer-events-none">
          {APP_VERSION}
        </div>
      </>
  );
}