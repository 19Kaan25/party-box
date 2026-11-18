import React from 'react';
import { Settings, ArrowRight, Minus, Plus } from 'lucide-react';
import { Chips, Section, TeamSection } from './ActivitySetup';
import { teamLayout } from './activityUi';
import { MIN_PLAYERS, MIN_TEAM_PLAYERS } from './tabuLogic';
import { CATEGORY_NAMES, effectiveSetup, poolFor } from './tabuUi';

const ACCENT = 'bg-cyan-600 border-cyan-500';
const MODE_OPTIONS = [['TEAMS', 'Teams'], ['SOLO', 'Jeder gegen jeden']];
const SECOND_OPTIONS = [30, 45, 60, 90, 120];
const END_OPTIONS = [['SCORE', 'Zielpunktzahl'], ['ROUNDS', 'Rundenzahl']];
const TABU_SHOWN_OPTIONS = [[5, '5'], [3, '3'], [0, 'Nur Begriff']];
const DIFFICULTIES = [[3, 'Leicht'], [4, 'Mittel'], [5, 'Schwer']];
const PENALTY_OPTIONS = [[0, '0'], [-1, '−1']];
const WATCHER_OPTIONS = [
    ['ALL', 'Alle Gegner', 'Alle Gegner sehen die Karte live und dürfen buzzern.'],
    ['ONE', 'Ein Gegner reihum', 'Pro Zug sieht genau eine Person aus den Gegnern die Karte und buzzert.'],
    ['NONE', 'Am Tisch', 'Niemand sieht die Karte auf dem eigenen Handy — Gegner schauen dem Erklärer über die Schulter und buzzern trotzdem.'],
];
const STEAL_OPTIONS = [
    [false, 'Verfällt', 'Die Karte, die bei Zeitablauf offen ist, zählt nicht.'],
    [true, 'Klauen', 'Das nächste Team darf die offene Karte einmal raten — richtig = +1 für dieses Team.'],
];

function Stepper({ value, min, max, step = 1, onChange, label }) {
    return (
        <div className="flex items-center gap-2">
            <button onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`${label} verringern`}
                className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center disabled:opacity-40">
                <Minus size={16} />
            </button>
            <span className="w-12 text-center text-xl font-bold tabular-nums">{value}</span>
            <button onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`${label} erhöhen`}
                className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center disabled:opacity-40">
                <Plus size={16} />
            </button>
        </div>
    );
}

/** Mehrfachauswahl als Chips (Kategorien, Schwierigkeit). */
function MultiChips({ options, values, onChange }) {
    return (
        <div className="flex flex-wrap gap-2">
            {options.map(([key, label]) => (
                <button
                    key={key}
                    onClick={() => onChange(values.includes(key) ? values.filter((v) => v !== key) : [...values, key])}
                    className={`px-4 py-2 rounded-xl border text-sm ${values.includes(key) ? `${ACCENT} text-white` : 'bg-slate-900 border-slate-700 text-slate-300'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    );
}

export default function TabuSetup({ players, setup: rawSetup, isHost, updateSetup, onStart }) {
    const setup = effectiveSetup(rawSetup, players.length);
    const solo = setup.mode === 'SOLO';
    const layout = teamLayout(players, setup);
    const { teamCount, teamKeys, teams, unassigned } = layout;
    const nameOf = (id) => players.find((p) => p.id === id)?.name || '?';
    const poolSize = poolFor(setup).length;

    let blockReason = null;
    if (players.length < MIN_PLAYERS) blockReason = `Ihr braucht mindestens ${MIN_PLAYERS} Spieler.`;
    else if (setup.categories.length === 0) blockReason = 'Wähle mindestens eine Kategorie.';
    else if (setup.difficulties.length === 0) blockReason = 'Wähle mindestens eine Schwierigkeit.';
    else if (!solo && unassigned.length > 0) blockReason = `Noch nicht in einem Team: ${unassigned.map(nameOf).join(', ')} — „Neu mischen" oder antippen.`;
    else if (!solo && teamKeys.some((k) => teams[k].length < 2)) blockReason = 'Jedes Team braucht mindestens 2 Personen.';

    const skipMode = setup.skips < 0 ? 'ALL' : setup.skips === 0 ? 'OFF' : 'COUNT';

    return (
        <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center p-4 sm:p-6 relative">
            <h2 className="text-4xl font-bold mb-2 text-cyan-400 mt-12 text-center">Tabu</h2>
            <p className="text-slate-400 mb-6 text-center max-w-md">
                Erklären ohne die verbotenen Wörter — so viele Karten wie möglich, bevor die Zeit abläuft.
            </p>

            {!isHost && <p className="text-slate-500 text-sm mb-4">Live-Ansicht – der Host nimmt die Einstellungen vor.</p>}
            <fieldset disabled={!isHost} className={`w-full max-w-2xl ${!isHost ? 'opacity-60' : ''}`}>
                <div className="w-full bg-slate-800 rounded-3xl p-5 sm:p-6 border border-slate-700 shadow-xl">
                    <h3 className="text-xl font-bold mb-5 flex items-center gap-2">
                        <Settings size={20} className="text-cyan-400" /> Spieleinstellungen
                    </h3>

                    <Section
                        title="Spielmodus"
                        hint={players.length < MIN_TEAM_PLAYERS
                            ? `Teams gibt es erst ab ${MIN_TEAM_PLAYERS} Spielern.`
                            : solo ? 'Alle anderen raten. Erklärer und wer es errät bekommen je einen Punkt.' : 'Pro Zug erklärt einer, das eigene Team rät laut.'}
                    >
                        {players.length >= MIN_TEAM_PLAYERS && (
                            <Chips options={MODE_OPTIONS} value={setup.mode} onChange={(v) => updateSetup('mode', v)} active={ACCENT} />
                        )}
                    </Section>

                    {solo ? (
                        <Section title="Mitspieler">
                            <div className="flex flex-wrap gap-2">
                                {players.map((p) => <span key={p.id} className="px-3 py-1.5 rounded-xl bg-slate-800 text-sm">{p.name}</span>)}
                            </div>
                        </Section>
                    ) : (
                        <TeamSection players={players} layout={layout} isHost={isHost} updateSetup={updateSetup} accent={ACCENT} />
                    )}

                    <Section title="Rundenzeit">
                        <Chips options={SECOND_OPTIONS.map((s) => [s, `${s} s`])} value={setup.seconds} onChange={(v) => updateSetup('seconds', v)} active={ACCENT} />
                    </Section>

                    <Section
                        title="Spielende"
                        hint={setup.endMode === 'SCORE'
                            ? `Wer nach einem vollen Umlauf ${setup.target} Punkte hat, gewinnt${solo ? ' (pro Person)' : ''}.`
                            : `Jeder erklärt ${setup.rounds}-mal${solo ? '' : ' (bei ungleichen Teams zählt das größte)'}.`}
                    >
                        <div className="mb-3"><Chips options={END_OPTIONS} value={setup.endMode} onChange={(v) => updateSetup('endMode', v)} active={ACCENT} /></div>
                        {setup.endMode === 'SCORE'
                            ? <Stepper label="Zielpunktzahl" value={setup.target} min={5} max={100} step={5} onChange={(v) => updateSetup('target', v)} />
                            : <Stepper label="Rundenzahl" value={setup.rounds} min={1} max={10} onChange={(v) => updateSetup('rounds', v)} />}
                    </Section>

                    <Section title="Tabu-Wörter anzeigen" hint={setup.tabuShown === 0 ? 'Nur der Begriff — gut für Anfänger und Kinder.' : null}>
                        <Chips options={TABU_SHOWN_OPTIONS} value={setup.tabuShown} onChange={(v) => updateSetup('tabuShown', v)} active={ACCENT} />
                    </Section>

                    <Section title="Schwierigkeit">
                        <MultiChips options={DIFFICULTIES} values={setup.difficulties} onChange={(v) => updateSetup('difficulties', v)} />
                    </Section>

                    <Section title={`Kategorien (${setup.categories.length} gewählt · ${poolSize} Karten)`}>
                        <MultiChips options={Object.entries(CATEGORY_NAMES)} values={setup.categories} onChange={(v) => updateSetup('categories', v)} />
                    </Section>

                    <Section title="Überspringen" hint="Zählt pro Zug.">
                        <div className="flex flex-wrap items-center gap-3">
                            <Chips
                                options={[['ALL', 'Unbegrenzt'], ['COUNT', 'Anzahl'], ['OFF', 'Aus']]}
                                value={skipMode}
                                onChange={(v) => updateSetup('skips', v === 'ALL' ? -1 : v === 'OFF' ? 0 : 3)}
                                active={ACCENT}
                            />
                            {skipMode === 'COUNT' && <Stepper label="Überspringen" value={setup.skips} min={1} max={20} onChange={(v) => updateSetup('skips', v)} />}
                        </div>
                    </Section>

                    <div className="grid sm:grid-cols-2 gap-x-4">
                        <Section title="Strafe Überspringen">
                            <Chips options={PENALTY_OPTIONS} value={setup.skipPenalty} onChange={(v) => updateSetup('skipPenalty', v)} active={ACCENT} />
                        </Section>
                        <Section title="Strafe Tabu">
                            <Chips options={PENALTY_OPTIONS} value={setup.tabuPenalty} onChange={(v) => updateSetup('tabuPenalty', v)} active={ACCENT} />
                        </Section>
                    </div>

                    {solo ? (
                        <Section title="Aufpasser" hint={'Alle anderen raten mit und dürfen „Tabu!" drücken — die Karte sieht nur der Erklärer.'} />
                    ) : (
                        <>
                            <Section title="Aufpasser — wer sieht die Karte und darf buzzern?" hint={WATCHER_OPTIONS.find(([k]) => k === setup.watcher)?.[2]}>
                                <Chips options={WATCHER_OPTIONS} value={setup.watcher} onChange={(v) => updateSetup('watcher', v)} active={ACCENT} />
                            </Section>
                            <Section title="Letzte Karte bei Zeitablauf" hint={STEAL_OPTIONS.find(([k]) => k === setup.steal)?.[2]}>
                                <Chips options={STEAL_OPTIONS} value={setup.steal} onChange={(v) => updateSetup('steal', v)} active={ACCENT} />
                            </Section>
                        </>
                    )}

                    {blockReason && <p className="text-sm text-amber-400 mb-4">{blockReason}</p>}

                    <button
                        onClick={() => onStart({ ...setup, teamCount, teams })}
                        disabled={!!blockReason}
                        className="w-full bg-gradient-to-r from-cyan-500 to-sky-500 hover:from-cyan-400 hover:to-sky-400 disabled:from-slate-700 disabled:to-slate-700 disabled:text-slate-500 text-white font-bold py-3 rounded-xl transition-all shadow-lg flex items-center justify-center gap-2"
                    >
                        <ArrowRight size={18} /> Spiel starten
                    </button>
                </div>
            </fieldset>
        </div>
    );
}
