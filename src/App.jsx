import React, { useState } from 'react';

import useAuth from './hooks/useAuth';
import useLobby from './hooks/useLobby';
import useFriends from './hooks/useFriends';

import ProfileModal from './components/auth/ProfileModal';
import InviteToasts from './components/friends/InviteToasts';
import InstallBanner from './components/InstallBanner';
import GameRouter from './components/GameRouter';

const APP_VERSION = "v1.1.0";

export default function App() {
  const authLogic = useAuth();
  const { user, userData, loading: authLoading } = authLogic;

  // Initiale Orchestrierung der ausgelagerten Kern-Logik
  const lobbyLogic = useLobby(user, userData, authLogic.updateUserProfile);

  // Globale UI-States
  const [copied, setCopied] = useState(false);
  const [profileTab, setProfileTab] = useState(null);   // null = Dialog zu

  // Freunde- und Einladungen-Reiter pollen nur, solange einer von beiden
  // offen ist -- Freunde fuer den Online-Status, Einladungen dafuer, dass
  // eine inzwischen abgelaufene Einladung auch ohne Neuladen verschwindet.
  const friendsLogic = useFriends(user, lobbyLogic.lobbyId, profileTab === 'freunde' || profileTab === 'einladungen');

  // Globale Ladezustände. Der Installations-Hinweis haengt bewusst auch hier
  // dran: er soll unabhaengig von Anmeldung und Lobby erscheinen, und gerade
  // wer die Seite zum ersten Mal oeffnet, sieht diese Zwischenschirme.
  if (authLoading) {
    return (
        <>
          <div className="min-h-screen bg-slate-900 flex items-center justify-center text-slate-400 animate-pulse">
            Lade Sitzung...
          </div>
          <InstallBanner />
        </>
    );
  }

  if (!user) {
    return (
        <>
          <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">
            Lade Authentifizierung...
          </div>
          <InstallBanner />
        </>
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

  // Einladung annehmen: bewusst ueber handleJoinLobby statt join_lobby
  // direkt -- dort haengen Nickname-Pruefung, Fehlermeldungen und das
  // Nachladen des Lobby-Zustands dran.
  const acceptInvite = async (invite) => {
    const ok = await lobbyLogic.handleJoinLobby(null, invite.lobby_code);
    await friendsLogic.refresh();
    return ok;
  };

  const uiProps = {
    copied,
    handleCopy,
    openProfile: setProfileTab,
    badgeCount: friendsLogic.badgeCount,
    // Getrennt von badgeCount (der Summe): AuthMenu muss wissen, WELCHER
    // Reiter etwas Neues hat, um dorthin statt blind zu "Freunde" zu oeffnen.
    friendRequestCount: friendsLogic.incoming.length,
    inviteCount: friendsLogic.invites.length + friendsLogic.joinRequests.length,
  };

  return (
      <>
        {/* Globales Profil-Overlay */}
        {profileTab && (
            <ProfileModal
                authLogic={authLogic}
                friendsLogic={friendsLogic}
                inLobby={!!lobbyLogic.lobbyId}
                lobbyCode={lobbyLogic.lobbyCode}
                initialTab={profileTab}
                onClose={() => setProfileTab(null)}
                onAcceptInvite={async (invite) => {
                  // Angenommen -> die Lobby wechselt, das Modal soll den Blick
                  // darauf nicht verstellen.
                  if (await acceptInvite(invite)) setProfileTab(null);
                }}
            />
        )}

        {/* Zentrales Routing für Lobby und Minispiele */}
        <GameRouter
            authLogic={authLogic}
            lobbyLogic={lobbyLogic}
            friendsLogic={friendsLogic}
            uiProps={uiProps}
        />

        <InviteToasts
            invites={friendsLogic.invites}
            onAccept={acceptInvite}
            onDecline={friendsLogic.declineInvite}
        />

        <InstallBanner />

        {/* Globale App-Version */}
        <div className="fixed bottom-2 right-2 text-[10px] text-slate-600/50 font-mono z-[60] pointer-events-none">
          {APP_VERSION}
        </div>
      </>
  );
}