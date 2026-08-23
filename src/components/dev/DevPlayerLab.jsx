import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowRight,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Maximize2,
    Minimize2,
    MonitorSmartphone,
    RefreshCw,
    Users,
} from 'lucide-react';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

function playerName(slot) {
    return slot === 1 ? 'Host' : `Spieler ${slot}`;
}

function playerUrl(slot) {
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set('testSession', `spieler-${slot}`);
    url.searchParams.set('testName', playerName(slot));
    return url.toString();
}

export default function DevPlayerLab() {
    const [playerCount, setPlayerCount] = useState(4);
    const [focusedSlot, setFocusedSlot] = useState(null);
    const [lobbyCode, setLobbyCode] = useState('');
    const [joinResults, setJoinResults] = useState({});
    const [controlsOpen, setControlsOpen] = useState(true);
    const frameRefs = useRef(new Map());

    const players = useMemo(
        () => Array.from({ length: playerCount }, (_, index) => {
            const slot = index + 1;
            return { slot, name: playerName(slot), url: playerUrl(slot) };
        }),
        [playerCount]
    );

    const changePlayerCount = (count) => {
        setPlayerCount(count);
        if (focusedSlot && focusedSlot > count) setFocusedSlot(null);
    };

    const reloadPlayer = (slot) => {
        frameRefs.current.get(slot)?.contentWindow?.location.reload();
    };

    const reloadAll = () => {
        frameRefs.current.forEach((frame) => frame.contentWindow?.location.reload());
    };

    const moveAllPlayers = () => {
        const code = lobbyCode.toUpperCase().trim();
        if (!/^[A-Z0-9]{6}$/.test(code)) {
            setJoinResults({ error: 'Bitte gib einen gültigen sechsstelligen Lobby-Code ein.' });
            return;
        }

        const requestId = crypto.randomUUID();
        const nextResults = { requestId };
        frameRefs.current.forEach((frame, slot) => {
            nextResults[slot] = 'pending';
            frame.contentWindow?.postMessage({
                type: 'PARTYBOX_DEV_JOIN_LOBBY',
                requestId,
                lobbyCode: code,
            }, window.location.origin);
        });
        setJoinResults(nextResults);
    };

    useEffect(() => {
        const receiveResult = (event) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'PARTYBOX_DEV_JOIN_RESULT') return;

            setJoinResults((current) => {
                if (current.requestId !== event.data.requestId) return current;
                return { ...current, [event.data.slot]: event.data.ok ? 'joined' : 'failed' };
            });
        };

        window.addEventListener('message', receiveResult);
        return () => window.removeEventListener('message', receiveResult);
    }, []);

    const resultValues = Object.values(joinResults);
    const joinedCount = resultValues.filter((result) => result === 'joined').length;
    const failedCount = resultValues.filter((result) => result === 'failed').length;
    const pendingCount = resultValues.filter((result) => result === 'pending').length;

    return (
        <div className="min-h-screen bg-slate-950 text-slate-100">
            <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/95 px-4 py-4 shadow-2xl backdrop-blur sm:px-6">
                <div className="mx-auto max-w-[1800px] space-y-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                        <div>
                            <p className="mb-1 flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-purple-300">
                                <MonitorSmartphone size={17} /> Nur Entwicklung
                            </p>
                            <h1 className="text-2xl font-black sm:text-3xl">PartyBox-Spielerlabor</h1>
                            {controlsOpen && (
                                <p className="mt-1 max-w-3xl text-sm text-slate-400">
                                    Jeder Rahmen ist ein vollständiger Client mit eigener, dauerhaft isolierter Sitzung.
                                    Erstelle die Lobby beim Host und tritt mit den anderen Spielern wie auf echten Handys bei.
                                </p>
                            )}
                        </div>

                        <div className="flex shrink-0 gap-2">
                            {controlsOpen && (
                                <button
                                    type="button"
                                    onClick={reloadAll}
                                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 font-bold text-slate-200 transition-colors hover:bg-slate-700"
                                >
                                    <RefreshCw size={17} /> Alle neu laden
                                </button>
                            )}
                            <button
                                type="button"
                                onClick={() => setControlsOpen((open) => !open)}
                                aria-expanded={controlsOpen}
                                className="flex items-center justify-center gap-2 rounded-xl border border-purple-500/40 bg-purple-500/10 px-4 py-2.5 font-bold text-purple-200 transition-colors hover:bg-purple-500/20"
                            >
                                {controlsOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                {controlsOpen ? 'Steuerung zuklappen' : 'Steuerung aufklappen'}
                            </button>
                        </div>
                    </div>

                    {controlsOpen && (
                        <>
                    <div className="flex flex-col gap-3 rounded-2xl border border-slate-700 bg-slate-800/70 p-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="mr-1 flex items-center gap-2 text-sm font-bold text-slate-300">
                                <Users size={17} /> Spielerzahl
                            </span>
                            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => index + MIN_PLAYERS).map((count) => (
                                <button
                                    key={count}
                                    type="button"
                                    onClick={() => changePlayerCount(count)}
                                    className={`h-9 w-9 rounded-lg border text-sm font-black transition-colors ${
                                        playerCount === count
                                            ? 'border-purple-400 bg-purple-500 text-white'
                                            : 'border-slate-600 bg-slate-900 text-slate-300 hover:border-purple-500'
                                    }`}
                                >
                                    {count}
                                </button>
                            ))}
                        </div>

                        <p className="text-xs leading-relaxed text-amber-300/90 lg:max-w-xl lg:text-right">
                            Die lokale App verwendet die konfigurierte Supabase-Datenbank. Testlobbys und
                            anonyme Testspieler sind daher echte Datensätze und werden später automatisch aufgeräumt.
                        </p>
                    </div>

                    <div className="flex flex-col gap-3 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-3 lg:flex-row lg:items-center">
                        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                            <input
                                type="text"
                                value={lobbyCode}
                                maxLength={6}
                                onChange={(event) => setLobbyCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                                onKeyDown={(event) => { if (event.key === 'Enter') moveAllPlayers(); }}
                                placeholder="Lobby-Code"
                                aria-label="Lobby-Code der Host-Lobby"
                                className="min-w-0 flex-1 rounded-xl border border-slate-600 bg-slate-950 px-4 py-3 font-mono text-lg font-black uppercase tracking-[0.25em] text-white outline-none transition-colors placeholder:font-sans placeholder:text-sm placeholder:font-normal placeholder:tracking-normal focus:border-purple-400"
                            />
                            <button
                                type="button"
                                onClick={moveAllPlayers}
                                className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-5 py-3 font-black text-white transition-colors hover:bg-purple-500"
                            >
                                <ArrowRight size={18} /> Alle Spieler zur Lobby
                            </button>
                        </div>
                        <p className={`text-xs lg:w-64 ${failedCount || joinResults.error ? 'text-red-300' : 'text-slate-300'}`}>
                            {joinResults.error
                                || (pendingCount > 0 ? `${joinedCount} verbunden, ${pendingCount} werden verschoben…` : null)
                                || (failedCount > 0 ? `${joinedCount} verbunden, ${failedCount} fehlgeschlagen.` : null)
                                || (joinedCount > 0 ? `Alle ${joinedCount} Spieler sind in der Lobby.` : 'Auch Spieler aus anderen Lobbys wechseln automatisch hierher.')}
                        </p>
                    </div>
                        </>
                    )}
                </div>
            </header>

            <main
                className={`mx-auto grid max-w-[1800px] gap-5 p-4 sm:p-6 ${
                    focusedSlot ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fit,minmax(min(100%,390px),1fr))]'
                }`}
            >
                {players.map((player) => (
                    <section
                        key={player.slot}
                        className={`${focusedSlot && focusedSlot !== player.slot ? 'hidden' : 'flex'} min-w-0 flex-col overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl`}
                    >
                        <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-800 px-4 py-3">
                            <div className="min-w-0">
                                <p className="truncate font-black text-slate-100">{player.name}</p>
                                <p className="truncate font-mono text-[10px] text-slate-500">
                                    Sitzung spieler-{player.slot}
                                </p>
                            </div>

                            <div className="flex shrink-0 items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => reloadPlayer(player.slot)}
                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                                    title={`${player.name} neu laden`}
                                >
                                    <RefreshCw size={17} />
                                </button>
                                <a
                                    href={player.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                                    title={`${player.name} in eigenem Tab öffnen`}
                                >
                                    <ExternalLink size={17} />
                                </a>
                                <button
                                    type="button"
                                    onClick={() => setFocusedSlot((current) => current === player.slot ? null : player.slot)}
                                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                                    title={focusedSlot === player.slot ? 'Alle Spieler anzeigen' : `${player.name} vergrößern`}
                                >
                                    {focusedSlot === player.slot ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
                                </button>
                            </div>
                        </div>

                        <iframe
                            ref={(frame) => {
                                if (frame) frameRefs.current.set(player.slot, frame);
                                else frameRefs.current.delete(player.slot);
                            }}
                            src={player.url}
                            title={`PartyBox – ${player.name}`}
                            className={`w-full border-0 bg-slate-900 ${focusedSlot === player.slot
                                ? `${controlsOpen ? 'h-[calc(100vh-230px)]' : 'h-[calc(100vh-120px)]'} min-h-[700px]`
                                : 'h-[780px]'}`}
                        />
                    </section>
                ))}
            </main>
        </div>
    );
}
