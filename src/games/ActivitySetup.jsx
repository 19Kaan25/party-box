import React from 'react';
import { Settings, Shuffle, ArrowRight, Users } from 'lucide-react';
import { TEAM_KEYS, MIN_PLAYERS, FIELDS_PER_AREA, dealTeams } from './activityLogic';
import { TEAM_INFO, CATEGORY_NAMES, effectiveSetup } from './activityUi';
import { TeamToken } from './ActivityBoard';

const WATCHER_OPTIONS = [
    ['NONE', 'Am Tisch', 'Nur der Darsteller sieht die Karte, Gegner schauen über die Schulter.'],
    ['OPPONENTS', 'Alle Gegner', 'Alle außerhalb des Darsteller-Teams sehen die Karte live.'],
    ['ONE_TEAM', 'Ein Gegnerteam', 'Reihum sieht genau ein anderes Team die Karte.'],
    ['ONE_PLAYER', 'Ein Aufpasser', 'Reihum sieht genau eine Person aus den Gegnern die Karte.'],
];
const THREE_WATCHER_OPTIONS = [
    ['NONE', 'Aus', 'Bei Erklären raten beide, geprüft wird nicht (Ehrensache).'],
    ['ONE_PLAYER', 'An', 'Bei Erklären ist einer Rater, der andere Aufpasser — reihum.'],
];
const REFEREE_OPTIONS = [
    ['HOST', 'Host entscheidet', 'Der Host korrigiert Fehler und entscheidet Einsprüche direkt.'],
    ['VOTE', 'Gruppe stimmt ab', 'Korrekturen und Einsprüche gelten erst mit Mehrheit.'],
    ['OFF', 'Kein Schiedsrichter', 'Der Darsteller entscheidet Meldungen endgültig.'],
];
const SKIP_OPTIONS = [[0, '0'], [2, '2'], [5, '5'], [-1, '∞']];
const LENGTH_OPTIONS = [[3, 'Kurz'], [4, 'Mittel'], [6, 'Lang']];
const SECOND_OPTIONS = [45, 60, 90];

function Chips({ options, value, onChange }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(([key, label]) => (
                <button
                    key={String(key)}
                    onClick={() => onChange(key)}
                    className={`px-4 py-2 rounded-xl border text-sm transition-all ${value === key
                        ? 'bg-orange-600 border-orange-500 text-white shadow-lg'
                        : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

function Section({ title, hint, children }) {
    return (
        <div className="bg-slate-900/50 p-4 rounded-xl border border-slate-700 mb-4">
            <label className="block text-sm font-medium text-slate-300 mb-2">{title}</label>
            {children}
            {hint && <p className="text-xs text-slate-500 mt-2">{hint}</p>}
        </div>
    );
}

export default function ActivitySetup({ players, setup: rawSetup, isHost, updateSetup, onStart }) {
    const three = players.length === MIN_PLAYERS;
    const setup = effectiveSetup(rawSetup, three);
    const ids = players.map((p) => p.id);
    const nameOf = (id) => players.find((p) => p.id === id)?.name || '?';
    const maxTeams = Math.max(2, Math.min(4, Math.floor(players.length / 2)));
    const teamCount = Math.min(setup.teamCount, maxTeams);
    const teamKeys = TEAM_KEYS.slice(0, teamCount);
    // Weggegangene IDs fallen raus; wer in keinem Team steckt, ist "offen".
    const teams = Object.fromEntries(teamKeys.map((k) => [k, (setup.teams[k] || []).filter((id) => ids.includes(id))]));
    const assigned = new Set(Object.values(teams).flat());
    const unassigned = ids.filter((id) => !assigned.has(id));

    const reshuffle = (count = teamCount) => updateSetup('teams', dealTeams(ids, count));
    const moveToNext = (id) => {
        if (!isHost) return;
        const from = teamKeys.find((k) => teams[k].includes(id));
        const to = teamKeys[(teamKeys.indexOf(from) + 1) % teamKeys.length];
        const next = Object.fromEntries(teamKeys.map((k) => [k, teams[k].filter((x) => x !== id)]));
        next[to] = [...next[to], id];
        updateSetup('teams', next);
    };

    let blockReason = null;
    if (players.length < MIN_PLAYERS) blockReason = `Ihr braucht mindestens ${MIN_PLAYERS} Spieler.`;
    else if (setup.categories.length === 0) blockReason = 'Wähle mindestens eine Kategorie.';
    else if (!three && unassigned.length > 0) blockReason = `Noch nicht in einem Team: ${unassigned.map(nameOf).join(', ')} — „Neu mischen" oder antippen.`;
    else if (!three && teamKeys.some((k) => teams[k].length < 2)) blockReason = 'Jedes Team braucht mindestens 2 Personen.';

    const watcherOptions = three ? THREE_WATCHER_OPTIONS : WATCHER_OPTIONS;
    const watcherValue = three ? (setup.watcher === 'NONE' ? 'NONE' : 'ONE_PLAYER') : setup.watcher;

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
            <h2 className="text-4xl font-bold mb-2 text-orange-400 mt-12 text-center">Activity</h2>
            <p className="text-slate-400 mb-6 text-center max-w-md">
                Zeichnen, Pantomime, Erklären — wer bringt seinem Team die meisten Begriffe bei?
            </p>

            {!isHost && <p className="text-slate-500 text-sm mb-4">Live-Ansicht – der Host nimmt die Einstellungen vor.</p>}
            <fieldset disabled={!isHost} className={`w-full max-w-2xl ${!isHost ? 'opacity-60' : ''}`}>
                <div className="w-full bg-slate-800 rounded-3xl p-5 sm:p-6 border border-slate-700 shadow-xl">
                    <h3 className="text-xl font-bold mb-5 flex items-center gap-2">
                        <Settings size={20} className="text-orange-400" /> Spieleinstellungen
                    </h3>

                    {three ? (
                        <Section title="Drei-Spieler-Modus" hint="Jeder spielt für sich. Wer zuerst richtig rät, bekommt die Stufe, der Darsteller eins weniger.">
                            <div className="flex flex-wrap gap-2">
                                {players.map((p) => <span key={p.id} className="px-3 py-1.5 rounded-xl bg-slate-800 text-sm">{p.name}</span>)}
                            </div>
                        </Section>
                    ) : (
                        <Section title={<span className="flex items-center gap-2"><Users size={16} /> Teams</span>} hint="Spieler antippen, um ihn ins nächste Team zu schieben.">
                            <div className="flex items-center gap-2 mb-3 flex-wrap">
                                {[2, 3, 4].filter((n) => n <= maxTeams).map((n) => (
                                    <button
                                        key={n}
                                        onClick={() => { updateSetup('teamCount', n); reshuffle(n); }}
                                        className={`px-3 py-1.5 rounded-xl border text-sm ${teamCount === n ? 'bg-orange-600 border-orange-500' : 'bg-slate-900 border-slate-700 text-slate-300'}`}
                                    >
                                        {n} Teams
                                    </button>
                                ))}
                                <button onClick={() => reshuffle()} className="ml-auto px-3 py-1.5 rounded-xl border border-slate-600 bg-slate-800 text-sm flex items-center gap-1.5">
                                    <Shuffle size={14} /> Neu mischen
                                </button>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {teamKeys.map((k) => (
                                    <div key={k} className={`rounded-xl border-2 ${TEAM_INFO[k].ring} bg-slate-800/60 p-3`}>
                                        <p className={`font-bold mb-2 flex items-center gap-2 ${TEAM_INFO[k].text}`}>
                                            <TeamToken team={k} size={16} /> Team {TEAM_INFO[k].label}
                                            <span className="text-xs text-slate-500 font-normal">({teams[k].length})</span>
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {teams[k].map((id) => (
                                                <button key={id} onClick={() => moveToNext(id)} className="px-2.5 py-1 rounded-lg bg-slate-900 text-sm hover:bg-slate-700">
                                                    {nameOf(id)}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {unassigned.length > 0 && (
                                <div className="mt-3 flex flex-wrap gap-1.5 items-center">
                                    <span className="text-xs text-amber-400">Ohne Team:</span>
                                    {unassigned.map((id) => (
                                        <button key={id} onClick={() => moveToNext(id)} className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/40 text-sm">
                                            {nameOf(id)}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Section>
                    )}

                    <Section title={`Kategorien (${setup.categories.length} gewählt)`}>
                        <div className="flex flex-wrap gap-2">
                            {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
                                <button
                                    key={key}
                                    onClick={() => updateSetup('categories', setup.categories.includes(key)
                                        ? setup.categories.filter((c) => c !== key)
                                        : [...setup.categories, key])}
                                    className={`px-4 py-2 rounded-xl border text-sm ${setup.categories.includes(key)
                                        ? 'bg-orange-600 border-orange-500 text-white'
                                        : 'bg-slate-900 border-slate-700 text-slate-300'}`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                    </Section>

                    <Section title="Spiellänge" hint={`${setup.length} Bereiche à ${FIELDS_PER_AREA} Felder = ${setup.length * FIELDS_PER_AREA} Felder. Lang dauert grob 45–60 Minuten.`}>
                        <Chips options={LENGTH_OPTIONS} value={setup.length} onChange={(v) => updateSetup('length', v)} />
                    </Section>

                    <Section title="Zeit pro Versuch">
                        <Chips options={SECOND_OPTIONS.map((s) => [s, `${s} s`])} value={setup.seconds} onChange={(v) => updateSetup('seconds', v)} />
                    </Section>

                    <Section title="Aufpasser — wer sieht die Karte mit?" hint={watcherOptions.find(([k]) => k === watcherValue)?.[2]}>
                        <Chips options={watcherOptions} value={watcherValue} onChange={(v) => updateSetup('watcher', v)} />
                    </Section>

                    <Section title="Begriff tauschen (pro Team, ganze Partie)">
                        <Chips options={SKIP_OPTIONS} value={setup.skips} onChange={(v) => updateSetup('skips', v)} />
                    </Section>

                    <Section title="Schiedsrichter" hint={REFEREE_OPTIONS.find(([k]) => k === setup.referee)?.[2]}>
                        <Chips options={REFEREE_OPTIONS} value={setup.referee} onChange={(v) => updateSetup('referee', v)} />
                    </Section>

                    {blockReason && <p className="text-sm text-amber-400 mb-4">{blockReason}</p>}

                    <button
                        onClick={() => onStart({ ...setup, teamCount, teams })}
                        disabled={!!blockReason}
                        className="w-full bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                        <ArrowRight size={18} /> Spiel starten
                    </button>
                </div>
            </fieldset>
        </div>
    );
}
