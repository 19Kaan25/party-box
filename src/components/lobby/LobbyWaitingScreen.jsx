import React from 'react';
import { Users, LogOut, Check, Copy, Trophy, Crown, UserMinus, Play, Settings, ArrowRight } from 'lucide-react';
import AuthMenu from '../auth/AuthMenu';

export default function LobbyWaitingScreen({
                                               authLogic,
                                               onOpenProfile,
                                               currentLobby,
                                               copyToClipboard,
                                               copied,
                                               leaveLobby,
                                               user,
                                               isHost,
                                               promotePlayer,
                                               kickPlayer,
                                               updateLobbyStatus
                                           }) {
    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-4 sm:p-8 relative">
            <AuthMenu authLogic={authLogic} onOpenProfile={onOpenProfile} />

            <div className="max-w-4xl mx-auto mt-20 sm:mt-16">
                <div className="flex justify-between items-center mb-8 bg-slate-800 p-4 rounded-2xl border border-slate-700">
                    <div>
                        <p className="text-slate-400 text-sm font-medium">Lobby Code</p>
                        <div className="flex items-center gap-3">
                            <h2 className="text-3xl font-mono font-bold tracking-widest text-purple-400">{currentLobby.id}</h2>
                            <button onClick={copyToClipboard} className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-300" title="Code kopieren">
                                {copied ? <Check size={20} className="text-green-400" /> : <Copy size={20} />}
                            </button>
                        </div>
                    </div>
                    <button
                        onClick={() => { if(window.confirm('Willst du die Lobby wirklich verlassen?')) leaveLobby(); }}
                        className="text-red-400 hover:text-red-300 flex items-center gap-2 text-sm font-medium bg-red-400/10 px-4 py-2 rounded-lg transition-colors"
                    >
                        <LogOut size={16} /> Verlassen
                    </button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Spielerliste */}
                    <div className="lg:col-span-1 bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold flex items-center gap-2">
                                <Users className="text-indigo-400" /> Spieler ({currentLobby.players.length})
                            </h3>
                        </div>
                        <div className="space-y-3">
                            {currentLobby.players.map((p) => {
                                const safeName = p.name || 'Player';
                                return (
                                    <div key={p.id} className={`p-3 sm:p-4 rounded-xl flex items-center justify-between gap-2 sm:gap-4 ${p.id === user.uid ? 'bg-indigo-600/20 border border-indigo-500/30' : 'bg-slate-900/50'}`}>
                                        <div className="flex items-center gap-3 min-w-0 flex-1">
                                            {p.photoURL && p.photoURL !== '/default-avatar.png' ? (
                                                <img src={p.photoURL} alt={safeName} className="w-9 h-9 rounded-full object-cover border border-slate-600 shrink-0 shadow-sm" />
                                            ) : (
                                                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-sm shrink-0 shadow-sm text-white">
                                                    {safeName.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div className="truncate flex items-baseline gap-1.5">
                                                <span className="font-bold text-slate-200 truncate">{safeName}</span>
                                                {p.id === user.uid && <span className="text-xs font-medium text-slate-400 whitespace-nowrap">(Du)</span>}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                                            {currentLobby.settings?.globalLeaderboard && (
                                                <span className="text-xs sm:text-sm font-bold text-yellow-400 bg-yellow-500/10 px-2.5 py-1 rounded-lg whitespace-nowrap border border-yellow-500/20">
                          {p.globalScore} Pkt
                        </span>
                                            )}
                                            {p.isHost && <Trophy size={18} className="text-yellow-500 shrink-0 drop-shadow-md" title="Host" />}

                                            {isHost && p.id !== user.uid && (
                                                <div className="flex items-center gap-0.5 ml-1 sm:ml-2 border-l border-slate-700 pl-1.5 sm:pl-2 shrink-0">
                                                    <button onClick={() => promotePlayer(p.id)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-yellow-400 transition-colors" title="Zum Partyleiter ernennen">
                                                        <Crown size={18} />
                                                    </button>
                                                    <button onClick={() => kickPlayer(p.id)} className="p-1.5 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-red-400 transition-colors" title="Spieler rauswerfen">
                                                        <UserMinus size={18} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>

                    {/* Spielekatalog */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                                <h3 className="text-xl font-bold flex items-center gap-2"><Play className="text-pink-400" /> Spielekatalog</h3>
                                {isHost ? (
                                    <button
                                        onClick={() => updateLobbyStatus(currentLobby.status, null, { settings: { ...currentLobby.settings, globalLeaderboard: !currentLobby.settings.globalLeaderboard } })}
                                        className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border transition-colors ${currentLobby.settings?.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10 hover:bg-green-500/20' : 'text-slate-400 border-slate-700 bg-slate-900 hover:bg-slate-800'}`}
                                    >
                                        <Settings size={14} /> <span>Globales Scoring {currentLobby.settings?.globalLeaderboard ? 'an' : 'aus'}</span>
                                    </button>
                                ) : (
                                    <div className={`flex w-full sm:w-auto items-center justify-center gap-2 text-sm px-3 py-2 rounded-lg border ${currentLobby.settings?.globalLeaderboard ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-slate-400 border-slate-700 bg-slate-900'}`}>
                                        <Trophy size={14} /> <span>Globales Scoring {currentLobby.settings?.globalLeaderboard ? 'an' : 'aus'}</span>
                                    </div>
                                )}
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <GameCard
                                    title="Stadt Land Fluss"
                                    desc="Der Klassiker. Teste dein Wissen unter Zeitdruck!"
                                    color="purple"
                                    isHost={isHost}
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'STADT_LAND_FLUSS', { gameState: { phase: 'SETUP', letter: '', answers: {}, readyPlayers: [], gameScores: {} } })}
                                />
                                <GameCard
                                    title="Codenames"
                                    desc="Top-Secret! Finde alle deine Agenten."
                                    color="red"
                                    isHost={isHost}
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'CODENAMES', { gameState: { phase: 'TEAM_SETUP', teams: { red: [], blue: [] }, spymasters: { red: null, blue: null } } })}
                                />
                                <GameCard
                                    title="Werwolf"
                                    desc="Das Dorf schläft ein... Finde die Verräter!"
                                    color="indigo"
                                    isHost={isHost}
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'WERWOLF', { gameState: { phase: 'SETUP' } })}
                                />
                                <GameCard
                                    title="Wer bin ich?"
                                    desc="Der Party-Klassiker. Finde heraus, wer du bist!"
                                    color="yellow"
                                    isHost={isHost}
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'WER_BIN_ICH', { gameState: { phase: 'SETUP' } })}
                                />
                                <GameCard
                                    title="Imposter"
                                    desc="Entlarve den Verräter, bevor er dein Geheimnis erfährt!"
                                    color="emerald"
                                    isHost={isHost}
                                    onClick={() => updateLobbyStatus('GAME_IN_PROGRESS', 'IMPOSTER', {
                                        gameState: {
                                            phase: 'SETUP',
                                            settings: {
                                                imposterCount: 1,
                                                timerDuration: 180,
                                                selectedCategories: ['orte']
                                            }
                                        }
                                    })}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// Hilfskomponente für die Spiele-Karten
function GameCard({ title, desc, color, isHost, onClick }) {
    const colorMap = {
        purple: 'text-purple-300 hover:border-purple-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900',
        red: 'text-red-400 hover:border-red-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900',
        indigo: 'text-indigo-400 hover:border-indigo-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900',
        yellow: 'text-yellow-400 hover:border-yellow-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900',
        emerald: 'text-emerald-400 hover:border-emerald-500 border-slate-700 bg-slate-900/50 hover:bg-slate-900'
    };

    return (
        <div
            className={`p-5 rounded-2xl border-2 transition-all ${isHost ? 'cursor-pointer ' + colorMap[color] : 'border-slate-700 bg-slate-900/30 opacity-70'}`}
            onClick={isHost ? onClick : undefined}
        >
            <h4 className={`font-bold text-lg mb-1 ${colorMap[color].split(' ')[0]}`}>{title}</h4>
            <p className="text-sm text-slate-400 mb-4">{desc}</p>
            {isHost ? (
                <span className={`text-xs font-bold uppercase flex items-center gap-1 ${colorMap[color].split(' ')[0]}`}>
          Starten <ArrowRight size={14} />
        </span>
            ) : (
                <span className="text-xs text-slate-500">Warten auf Host...</span>
            )}
        </div>
    );
}