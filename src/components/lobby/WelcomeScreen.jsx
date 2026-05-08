import React from 'react';
import { Play, AlertCircle } from 'lucide-react';
import AuthMenu from '../auth/AuthMenu';

export default function WelcomeScreen({
                                          authLogic,
                                          onOpenProfile,
                                          errorMsg,
                                          playerName,
                                          setPlayerName,
                                          handleCreateLobby,
                                          handleJoinLobby
                                      }) {
    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6 flex flex-col items-center justify-center relative">
            <AuthMenu authLogic={authLogic} onOpenProfile={onOpenProfile} />

            <div className="max-w-md w-full bg-slate-800 rounded-3xl p-8 shadow-2xl border border-slate-700 mt-20 sm:mt-16">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500 mb-2">
                        Party Box
                    </h1>
                    <p className="text-slate-400">Multiplayer Minigames für Freunde</p>
                </div>

                {errorMsg && (
                    <div className="mb-4 p-3 bg-red-900/50 border border-red-500/50 rounded-lg flex items-center gap-2 text-red-200 text-sm">
                        <AlertCircle size={16} /> {errorMsg}
                    </div>
                )}

                <div className="space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Dein Nickname</label>
                        <input
                            type="text"
                            value={playerName}
                            onChange={(e) => setPlayerName(e.target.value)}
                            placeholder="z.B. PlayerOne"
                            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                        />
                    </div>

                    <div className="pt-4 border-t border-slate-700 space-y-4">
                        <button
                            onClick={handleCreateLobby}
                            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-95 shadow-lg shadow-purple-900/20"
                        >
                            <Play size={20} /> Neue Lobby erstellen
                        </button>

                        <div className="relative flex items-center py-2">
                            <div className="flex-grow border-t border-slate-700"></div>
                            <span className="flex-shrink-0 mx-4 text-slate-500 text-sm">ODER</span>
                            <div className="flex-grow border-t border-slate-700"></div>
                        </div>

                        <form
                            onSubmit={(e) => {
                                const code = e.target.elements.code.value;
                                handleJoinLobby(e, code);
                            }}
                            className="flex gap-2"
                        >
                            <input
                                name="code"
                                type="text"
                                placeholder="Lobby Code"
                                maxLength={4}
                                className="w-2/3 uppercase bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-pink-500 transition-all"
                            />
                            <button
                                type="submit"
                                className="w-1/3 bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center transition-all active:scale-95"
                            >
                                Beitreten
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </div>
    );
}