import React from 'react';
import { db } from '../lib/firestoreBridge';
import { createRestartGameState } from '../constants/gameSetup';

import WelcomeScreen from './lobby/WelcomeScreen';
import LobbyWaitingScreen from './lobby/LobbyWaitingScreen';
import GamePausedScreen from './lobby/GamePausedScreen';
import GameHeader, { GlobalGameHeaderProvider } from './GameHeader';

import CodenamesEngine from '../games/CodenamesEngine';
import StadtLandFlussEngine from '../games/StadtLandFlussEngine';
import WerwolfEngine from '../games/WerwolfEngine';
import WerBinIchEngine from '../games/WerBinIchEngine';
import ImposterEngine from '../games/ImposterEngine';
import SpruecheklopferEngine from '../games/SpruecheklopferEngine';

export default function GameRouter({ authLogic, lobbyLogic, friendsLogic, uiProps }) {
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

    const { openProfile, badgeCount, friendRequestCount, inviteCount, copied, handleCopy } = uiProps;

    if (!currentLobby) {
        return (
            <WelcomeScreen
                authLogic={authLogic}
                onOpenProfile={openProfile}
                badgeCount={badgeCount}
                friendRequestCount={friendRequestCount}
                inviteCount={inviteCount}
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
                onOpenProfile={openProfile}
                badgeCount={badgeCount}
                friendRequestCount={friendRequestCount}
                inviteCount={inviteCount}
                friendsLogic={friendsLogic}
                currentLobby={currentLobby}
                onlineIds={lobbyLogic.onlineIds}
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

    const optedOut = currentLobby.gameState?.optedOut || {};
    const paused = !!optedOut[user.uid] && !isHost;

    const setOwnParticipation = async (playing) => {
        await updateLobbyStatus(null, null, {
            [`gameState.optedOut.${user.uid}`]: !playing,
        });
    };

    if (paused) {
        return (
            <GamePausedScreen
                lobby={currentLobby}
                user={user}
                onResume={() => setOwnParticipation(true)}
                onLeaveLobby={leaveLobby}
            />
        );
    }

    // Spieler in der Lobbyansicht bleiben Lobby-Mitglieder, zaehlen aber fuer
    // laufende Runden nicht mit. Der Host gilt nach einer Uebernahme immer als
    // aktiv, selbst wenn er vorher pausiert hatte.
    const activePlayers = currentLobby.players.filter(
        (player) => !optedOut[player.id] || player.id === currentLobby.hostId
    );
    const engineLobby = { ...currentLobby, players: activePlayers };

    const engineProps = {
        lobby: engineLobby,
        user,
        isHost,
        db,
        updateLobbyStatus,
        leaveLobby
    };

    let engine;
    switch(currentLobby.currentGame) {
        case 'STADT_LAND_FLUSS': engine = <StadtLandFlussEngine {...engineProps} />; break;
        case 'CODENAMES': engine = <CodenamesEngine {...engineProps} />; break;
        case 'WERWOLF': engine = <WerwolfEngine {...engineProps} />; break;
        case 'WER_BIN_ICH': engine = <WerBinIchEngine {...engineProps} />; break;
        case 'IMPOSTER': engine = <ImposterEngine {...engineProps} />; break;
        case 'SPRUECHE_KLOPFER': engine = <SpruecheklopferEngine {...engineProps} />; break;
        default: engine = <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">Lade Spiel...</div>;
    }

    const returnToLobby = () => isHost
        ? updateLobbyStatus('LOBBY_WAITING', null, { gameState: {} })
        : setOwnParticipation(false);

    const restartGame = () => updateLobbyStatus('GAME_IN_PROGRESS', currentLobby.currentGame, {
        gameState: createRestartGameState(currentLobby.currentGame, currentLobby.gameState),
    });

    return (
        <GlobalGameHeaderProvider>
            <GameHeader
                global
                isHost={isHost}
                leaveLobby={leaveLobby}
                updateLobbyStatus={updateLobbyStatus}
                onReturnToLobby={returnToLobby}
                onRestart={restartGame}
            />
            <React.Fragment key={`${currentLobby.currentGame}-${currentLobby.gameState?.restartVersion || 0}`}>
                {engine}
            </React.Fragment>
        </GlobalGameHeaderProvider>
    );
}
