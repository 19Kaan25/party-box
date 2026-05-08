import React from 'react';
import { db } from '../utils/firebase';

import WelcomeScreen from './lobby/WelcomeScreen';
import LobbyWaitingScreen from './lobby/LobbyWaitingScreen';

import CodenamesEngine from '../games/CodenamesEngine';
import StadtLandFlussEngine from '../games/StadtLandFlussEngine';
import WerwolfEngine from '../games/WerwolfEngine';
import WerBinIchEngine from '../games/WerBinIchEngine';

export default function GameRouter({ authLogic, lobbyLogic, uiProps }) {
    const { user } = authLogic;
    const {
        currentLobby,
        playerName,
        setPlayerName,
        errorMsg,
        isHost,
        handleCreateLobby,
        handleJoinLobby,
        leaveLobby,
        updateLobbyStatus,
        kickPlayer,
        promotePlayer
    } = lobbyLogic;

    const { setShowProfileModal, copied, handleCopy } = uiProps;

    if (!currentLobby) {
        return (
            <WelcomeScreen
                authLogic={authLogic}
                onOpenProfile={() => setShowProfileModal(true)}
                errorMsg={errorMsg}
                playerName={playerName}
                setPlayerName={setPlayerName}
                handleCreateLobby={handleCreateLobby}
                handleJoinLobby={handleJoinLobby}
            />
        );
    }

    if (currentLobby.status === 'LOBBY_WAITING') {
        return (
            <LobbyWaitingScreen
                authLogic={authLogic}
                onOpenProfile={() => setShowProfileModal(true)}
                currentLobby={currentLobby}
                copied={copied}
                copyToClipboard={handleCopy}
                leaveLobby={leaveLobby}
                user={user}
                isHost={isHost}
                promotePlayer={promotePlayer}
                kickPlayer={kickPlayer}
                updateLobbyStatus={updateLobbyStatus}
            />
        );
    }

    const engineProps = {
        lobby: currentLobby,
        user,
        isHost,
        db,
        updateLobbyStatus,
        leaveLobby
    };

    switch(currentLobby.currentGame) {
        case 'STADT_LAND_FLUSS': return <StadtLandFlussEngine {...engineProps} />;
        case 'CODENAMES': return <CodenamesEngine {...engineProps} />;
        case 'WERWOLF': return <WerwolfEngine {...engineProps} />;
        case 'WER_BIN_ICH': return <WerBinIchEngine {...engineProps} />;
        default: return <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade Spiel...</div>;
    }
}