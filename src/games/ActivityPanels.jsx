import React from 'react';
import { X, Pause, Play, Ban, Flag, Minus, Plus, Vote, Check } from 'lucide-react';
import { TYPE_INFO, TEAM_INFO } from './activityUi';
import { MAX_FALSE_REPORTS } from './activityLogic';

function Modal({ title, onClose, children }) {
    return (
        <div className="fixed inset-0 z-[90] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
            <div
                className="w-full sm:max-w-lg max-h-[88vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xl font-bold">{title}</h3>
                    <button onClick={onClose} aria-label="Schließen" className="p-2 rounded-lg hover:bg-slate-800"><X size={20} /></button>
                </div>
                {children}
            </div>
        </div>
    );
}

const RULE_ROWS = [
    ['DRAW', 'Zeichnung, Nicken bei richtigen Wortteilen', 'Sprechen, Gesten, Buchstaben, Zahlen'],
    ['MIME', 'Nur der eigene Körper', 'Sprechen, Geräusche, Gegenstände benutzen oder darauf zeigen'],
    ['EXPLAIN', 'Umschreiben mit Worten', 'Begriff, Wortteile, abgeleitete Formen und die 5 Tabu-Wörter'],
];

export function RulesDialog({ onClose }) {
    return (
        <Modal title="Regeln" onClose={onClose}>
            <div className="space-y-3 text-sm">
                {RULE_ROWS.map(([type, ok, no]) => {
                    const info = TYPE_INFO[type];
                    return (
                        <div key={type} className="rounded-2xl bg-slate-800 p-3 border border-slate-700">
                            <p className={`font-bold flex items-center gap-2 mb-1 ${info.text}`}><info.Icon size={16} /> {info.label}</p>
                            <p><span className="text-green-400 font-bold">Erlaubt:</span> {ok}</p>
                            <p><span className="text-red-400 font-bold">Verboten:</span> {no}</p>
                        </div>
                    );
                })}
                <p className="text-slate-300">
                    Die Feldart, auf der eure Figur steht, bestimmt die Darstellung. Vor dem Ziehen wählt der
                    Darsteller die Schwierigkeit 3, 4 oder 5 — so viele Felder geht es bei Erfolg vor. Landet ihr
                    auf einem Feld mit einer fremden Figur, muss diese ein Feld zurück.
                </p>
                <p className="text-slate-300">
                    <b>Offene Runde:</b> alle Teams raten mit. Errät das eigene Team zuerst, gibt es 6 Felder;
                    errät ein fremdes Team zuerst, bekommt es 4 und das Darsteller-Team 2.
                </p>
                <p className="text-slate-300">
                    <b>Aufpasser</b> sehen die Karte mit, um auf die Regeln zu achten — sie raten nie mit. Sie
                    dürfen „Erraten" bestätigen, falls der Darsteller nicht ans Handy kommt.
                </p>
                <p className="text-slate-300">
                    <b>Regelverstoß</b> kann jeder Gegner melden, mit Grund. Der Timer hält an, der Darsteller sagt
                    „Stimmt" (Versuch vorbei) oder „Stimmt nicht" (weiter mit der Restzeit). Je nach Einstellung
                    gibt es danach einen Einspruch. Wer {MAX_FALSE_REPORTS}× zu Unrecht meldet, verliert das Melderecht.
                </p>
            </div>
        </Modal>
    );
}

/** Offene Abstimmung (Schiedsrichter-Modus "Gruppe stimmt ab"). Blockiert das Spiel nicht. */
export function ProposalBanner({ proposal, me, players, onVote, nameOf }) {
    if (!proposal) return null;
    const ids = players.map((p) => p.id);
    const yes = ids.filter((id) => proposal.votes?.[id] === true).length;
    const no = ids.filter((id) => proposal.votes?.[id] === false).length;
    const mine = proposal.votes?.[me];
    return (
        <div className="rounded-2xl bg-indigo-500/15 border border-indigo-400/50 p-3">
            <p className="text-sm font-bold text-indigo-100 flex items-center gap-2"><Vote size={16} /> Abstimmung</p>
            <p className="text-sm text-slate-200 mt-1">{proposal.label}</p>
            <p className="text-xs text-slate-400 mt-1">vorgeschlagen von {nameOf(proposal.by)} · Ja {yes} / Nein {no} von {ids.length}</p>
            {mine === undefined ? (
                <div className="grid grid-cols-2 gap-2 mt-2">
                    <button onClick={() => onVote(true)} className="py-2 rounded-xl bg-green-600 font-bold">Ja</button>
                    <button onClick={() => onVote(false)} className="py-2 rounded-xl bg-slate-700 font-bold">Nein</button>
                </div>
            ) : (
                <p className="text-xs text-slate-300 mt-2 flex items-center gap-1"><Check size={12} /> Du hast mit {mine ? 'Ja' : 'Nein'} gestimmt.</p>
            )}
        </div>
    );
}

function Block({ title, children }) {
    return (
        <div className="rounded-2xl bg-slate-800 border border-slate-700 p-3 mb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">{title}</p>
            {children}
        </div>
    );
}

/**
 * Schiedsrichter-Werkzeug, nur für den Host. Technische Notfälle (Pause,
 * Abbruch, Spielende, Nachzügler) gibt es in jedem Modus; Korrekturen
 * direkt (HOST), als Abstimmung (VOTE) oder gar nicht (OFF).
 */
export function RefereePanel({
    onClose, mode, involved, turn, order, positions, goal, skipsLeft, falseReports, history, appliedN,
    players, three, proposal, teamName, nameOf, teamOf, resultLabel,
    onCorrection, onPause, onResume, onAbort, onEnd, onAssign,
}) {
    const corrections = mode !== 'OFF';
    const voteMode = mode === 'VOTE';
    const busy = voteMode && !!proposal;
    const lastEntry = [...history].reverse().find((e) => !e.host && e.n === appliedN);
    const spectators = players.filter((p) => !teamOf(p.id));
    const btn = 'px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-bold disabled:opacity-40';

    const resultOptions = lastEntry ? [
        ...(lastEntry.open || three
            ? order.filter((k) => !three || k !== lastEntry.team).map((k) => ({ kind: 'erraten', winner: k, label: `Erraten: ${teamName(k)}` }))
            : [{ kind: 'erraten', winner: null, label: 'Erraten' }]),
        { kind: 'aufgegeben', winner: null, label: 'Nicht erraten' },
        { kind: 'regelverstoss', winner: null, label: 'Regelverstoß' },
    ] : [];

    return (
        <Modal title="Schiedsrichter" onClose={onClose}>
            {involved && <p className="text-xs text-amber-300 mb-3">Du bist an diesem Versuch beteiligt.</p>}
            <p className="text-xs text-slate-400 mb-3">
                Modus: {mode === 'HOST' ? 'Host entscheidet' : voteMode ? 'Gruppe stimmt ab — Korrekturen werden zur Abstimmung gestellt' : 'Kein Schiedsrichter — nur Notfall-Werkzeuge'}
                {busy && ' · Eine Abstimmung läuft, neue Vorschläge müssen warten.'}
            </p>

            <Block title="Laufender Versuch">
                <div className="flex flex-wrap gap-2">
                    <button onClick={onPause} disabled={turn?.stage !== 'RUNNING'} className={btn}><Pause size={14} className="inline mr-1" />Pausieren</button>
                    <button onClick={onResume} disabled={!(turn?.stage === 'PAUSED' && turn.hold)} className={btn}><Play size={14} className="inline mr-1" />Fortsetzen</button>
                    <button onClick={() => window.confirm('Versuch abbrechen? Niemand rückt vor.') && onAbort()} disabled={!turn || turn.stage === 'REVEAL' || !!turn.result} className={btn}>Abbrechen</button>
                    <button onClick={() => window.confirm('Spiel jetzt mit Zwischenstand beenden?') && onEnd()} className={btn}><Flag size={14} className="inline mr-1" />Mit Zwischenstand beenden</button>
                </div>
            </Block>

            {corrections && lastEntry && (
                <Block title={`Ergebnis von Versuch ${lastEntry.n} ändern (jetzt: ${resultLabel[lastEntry.kind]})`}>
                    <div className="flex flex-wrap gap-2">
                        {resultOptions.map((o) => (
                            <button
                                key={o.label}
                                disabled={busy}
                                onClick={() => onCorrection('result', { kind: o.kind, winner: o.winner }, `Versuch ${lastEntry.n} auf „${o.label}" ändern`)}
                                className={btn}
                            >
                                {o.label}
                            </button>
                        ))}
                    </div>
                </Block>
            )}

            {corrections && (
                <Block title="Felder und Tausche anpassen">
                    <div className="space-y-2">
                        {order.map((k) => (
                            <div key={k} className="flex items-center gap-2 flex-wrap">
                                <span className={`font-bold text-sm w-28 truncate ${TEAM_INFO[k].text}`}>{teamName(k)}</span>
                                <button disabled={busy} onClick={() => onCorrection('pos', { team: k, value: (positions[k] || 0) - 1 }, `${teamName(k)} ein Feld zurück`)} className={btn}><Minus size={14} /></button>
                                <span className="font-mono w-14 text-center text-sm">{positions[k] || 0}/{goal}</span>
                                <button disabled={busy} onClick={() => onCorrection('pos', { team: k, value: (positions[k] || 0) + 1 }, `${teamName(k)} ein Feld vor`)} className={btn}><Plus size={14} /></button>
                                {skipsLeft && <span className="text-xs text-slate-400 ml-2">Tausche {skipsLeft[k] < 0 ? '∞' : skipsLeft[k]}</span>}
                                {skipsLeft?.[k] >= 0 && (
                                    <>
                                        <button disabled={busy} onClick={() => onCorrection('skips', { team: k, delta: -1 }, `${teamName(k)}: ein Tausch weniger`)} className={btn}><Minus size={12} /></button>
                                        <button disabled={busy} onClick={() => onCorrection('skips', { team: k, delta: 1 }, `${teamName(k)}: ein Tausch mehr`)} className={btn}><Plus size={12} /></button>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </Block>
            )}

            {corrections && (
                <Block title="Melderecht">
                    <div className="space-y-1.5">
                        {players.filter((p) => teamOf(p.id)).map((p) => {
                            const banned = (falseReports[p.id] || 0) >= MAX_FALSE_REPORTS;
                            return (
                                <div key={p.id} className="flex items-center gap-2 text-sm">
                                    <span className="flex-1 truncate">{p.name} <span className="text-slate-500">({falseReports[p.id] || 0} Fehlmeldungen)</span></span>
                                    <button
                                        disabled={busy}
                                        onClick={() => onCorrection('ban', { id: p.id, banned: !banned }, `${p.name} ${banned ? 'darf wieder melden' : 'verliert das Melderecht'}`)}
                                        className={btn}
                                    >
                                        <Ban size={12} className="inline mr-1" />{banned ? 'Freigeben' : 'Sperren'}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </Block>
            )}

            {!three && spectators.length > 0 && (
                <Block title="Nachzügler einem Team zuweisen">
                    {spectators.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-sm flex-1 truncate">{p.name}</span>
                            {order.map((k) => (
                                <button key={k} onClick={() => onAssign(p.id, k)} className={`px-2.5 py-1.5 rounded-lg border ${TEAM_INFO[k].ring} text-xs font-bold ${TEAM_INFO[k].text}`}>
                                    {TEAM_INFO[k].label}
                                </button>
                            ))}
                        </div>
                    ))}
                </Block>
            )}

            <Block title="Protokoll">
                <div className="space-y-1 text-xs max-h-56 overflow-y-auto">
                    {[...history].reverse().map((e, i) => (
                        <p key={i} className={e.host ? 'text-amber-300' : 'text-slate-300'}>
                            {e.host ? `⚖ ${e.text}` : (
                                <>
                                    #{e.n} {teamName(e.team)} · {nameOf(e.actor)} · {TYPE_INFO[e.type]?.label}
                                    {e.word ? ` · „${e.word}"` : ''} → {resultLabel[e.kind]}{e.winner ? ` (${teamName(e.winner)})` : ''}
                                    {e.reports?.map((r, j) => <span key={j} className="block pl-3 text-slate-500">Meldung {nameOf(r.by)}: {r.reason} — {r.decision} ({r.decider})</span>)}
                                </>
                            )}
                        </p>
                    ))}
                    {history.length === 0 && <p className="text-slate-500">Noch nichts passiert.</p>}
                </div>
            </Block>
        </Modal>
    );
}
