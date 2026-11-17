import React, { useEffect, useState } from 'react';
import { Flag, Play } from 'lucide-react';
import { typeAt, FIELDS_PER_AREA } from './activityLogic';
import { TYPE_INFO, TEAM_INFO } from './activityUi';

export function TeamToken({ team, size = 18, letter }) {
    const fill = TEAM_INFO[team]?.fill || '#94a3b8';
    const s = size;
    const shape = {
        red: <circle cx={s / 2} cy={s / 2} r={s / 2 - 1} />,
        blue: <rect x={1.5} y={1.5} width={s - 3} height={s - 3} rx={2} />,
        green: <polygon points={`${s / 2},1 ${s - 1},${s - 1} 1,${s - 1}`} />,
        yellow: <polygon points={`${s / 2},1 ${s - 1},${s / 2} ${s / 2},${s - 1} 1,${s / 2}`} />,
    }[team];
    return (
        <svg width={s} height={s} className="shrink-0 drop-shadow" aria-hidden>
            <g fill={fill} stroke="#0f172a" strokeWidth="1.5">{shape}</g>
            {letter && (
                <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" fontSize={s * 0.5} fontWeight="900" fill="#0f172a">{letter}</text>
            )}
        </svg>
    );
}

/**
 * Figuren ziehen sichtbar Feld für Feld zur echten Position. Rein lokale
 * Anzeige; die Wahrheit steht in gameState.positions.
 */
function useSteppedPositions(positions) {
    const [shown, setShown] = useState(positions);
    useEffect(() => {
        const timer = setInterval(() => {
            setShown((prev) => {
                let changed = false;
                const next = {};
                for (const [team, target] of Object.entries(positions)) {
                    const cur = prev[team] ?? target;
                    next[team] = cur === target ? cur : cur + Math.sign(target - cur);
                    if (next[team] !== cur || prev[team] === undefined) changed = true;
                }
                if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
                return changed ? next : prev;
            });
        }, 220);
        return () => clearInterval(timer);
    }, [positions]);
    return shown;
}

/**
 * Schlangenpfad: eine Zeile pro Bereich (8 Felder), jede zweite Zeile
 * läuft zurück. Start oben, Ziel unten.
 */
export default function ActivityBoard({ positions, goal, teamOrder, letterOf, activeTeam }) {
    const shown = useSteppedPositions(positions);
    const fields = goal - 1;
    const rows = Math.ceil(fields / FIELDS_PER_AREA);

    const tokensAt = (pos) => teamOrder.filter((t) => shown[t] === pos);
    const tokens = (pos, size = 14) => (
        <div className="flex flex-wrap gap-0.5 justify-center">
            {tokensAt(pos).map((t) => (
                <span key={t} className={t === activeTeam ? 'animate-pulse' : ''}>
                    <TeamToken team={t} size={size} letter={letterOf?.(t)} />
                </span>
            ))}
        </div>
    );

    return (
        <div className="w-full">
            <div className="flex items-center gap-2 rounded-xl bg-slate-700/60 border border-slate-600 px-3 py-1.5 mb-1.5 min-h-9">
                <Play size={14} className="text-slate-300" />
                <span className="text-xs font-bold text-slate-300 uppercase">Start</span>
                <div className="ml-auto">{tokens(0, 16)}</div>
            </div>
            <div className="space-y-1.5">
                {Array.from({ length: rows }, (_, r) => {
                    const cells = Array.from({ length: FIELDS_PER_AREA }, (_, i) => r * FIELDS_PER_AREA + i + 1).filter((n) => n <= fields);
                    return (
                        <div key={r} className={`grid grid-cols-8 gap-1 ${r % 2 ? '[direction:rtl]' : ''}`}>
                            {cells.map((n) => {
                                const info = TYPE_INFO[typeAt(n)];
                                return (
                                    <div key={n} className={`[direction:ltr] relative aspect-square rounded-lg border ${info.cell} flex flex-col items-center justify-center overflow-hidden`}>
                                        <info.Icon size={11} className="absolute top-0.5 left-0.5 opacity-60" />
                                        <span className="absolute bottom-0 right-1 text-[9px] font-mono opacity-50">{n}</span>
                                        {tokens(n)}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
            <div className="flex items-center gap-2 rounded-xl bg-orange-500/20 border border-orange-400/60 px-3 py-1.5 mt-1.5 min-h-9">
                <Flag size={14} className="text-orange-300" />
                <span className="text-xs font-bold text-orange-200 uppercase">Ziel</span>
                <div className="ml-auto">{tokens(goal, 16)}</div>
            </div>
            <div className="flex flex-wrap justify-center gap-3 mt-3 text-xs">
                {Object.entries(TYPE_INFO).map(([key, info]) => (
                    <span key={key} className={`flex items-center gap-1 ${info.text}`}>
                        <info.Icon size={13} /> {info.label}
                    </span>
                ))}
            </div>
        </div>
    );
}
