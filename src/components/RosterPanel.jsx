/* =====================================================================
 *  Mitspielerliste fuer die Einzelgeraet-Modi.
 *
 *  Lobby-Mitglieder sind vorbelegt, Gaeste ohne Account lassen sich
 *  ergaenzen, entfernte Mitglieder kommen ueber "Nicht dabei" zurueck. Die
 *  Reihenfolge bestimmt, in welcher Richtung das Handy wandert.
 *
 *  Sortiert wird per Pointer Events, nicht per HTML5-Drag-and-Drop:
 *  mobile Browser feuern kein dragstart, und das hier ist handy-first.
 *  Die Chevron-Buttons bleiben als robuster Zweitweg.
 * ===================================================================== */

import React, { useState, useRef } from 'react';
import { Users, Plus, X, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';

import { MAX_ROSTER, NAME_MAX, newGuestKey } from '../utils/roster';

function SortableRows({ items, myUserId, onReorder, onRemove, onCommit, badgeOf }) {
    const [dragKey, setDragKey] = useState(null);
    const [dragOffset, setDragOffset] = useState(0);
    const listRef = useRef(null);
    const dragInfo = useRef({ startY: 0, index: 0, startIndex: 0, rowHeight: 0 });

    // Zeilenabstand exakt messen: Abstand der ersten beiden Zeilen inklusive
    // Gap. Nur mit der reinen Zeilenhoehe liefe das Ziel nach ein paar Zeilen
    // auseinander.
    const measureRowHeight = () => {
        const rows = listRef.current?.children;
        if (!rows || rows.length === 0) return 56;
        if (rows.length > 1) {
            return rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().top;
        }
        return rows[0].getBoundingClientRect().height;
    };

    const handlePointerDown = (e, index) => {
        dragInfo.current = { startY: e.clientY, index, startIndex: index, rowHeight: measureRowHeight() };
        setDragKey(items[index].key);
        setDragOffset(0);
        e.currentTarget.setPointerCapture(e.pointerId);
    };

    const handlePointerMove = (e) => {
        if (!dragKey) return;
        const { index, rowHeight, startY } = dragInfo.current;
        const dy = e.clientY - startY;
        const steps = rowHeight > 0 ? Math.round(dy / rowHeight) : 0;
        const target = Math.max(0, Math.min(items.length - 1, index + steps));

        if (target !== index) {
            // Basislinie mitziehen, damit die Zeile unter dem Finger bleibt.
            const nextStartY = startY + (target - index) * rowHeight;
            dragInfo.current = { ...dragInfo.current, startY: nextStartY, index: target };
            // Waehrend des Ziehens nicht speichern -- das waere ein RPC pro
            // uebersprungener Zeile. Gesichert wird beim Loslassen.
            onReorder(index, target, false);
            setDragOffset(e.clientY - nextStartY);
        } else {
            setDragOffset(dy);
        }
    };

    const endDrag = (e) => {
        if (!dragKey) return;
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        setDragKey(null);
        setDragOffset(0);
        // Nur sichern, wenn sich tatsaechlich etwas verschoben hat.
        if (dragInfo.current.index !== dragInfo.current.startIndex) onCommit(items);
    };

    return (
        <div ref={listRef} className="space-y-2">
            {items.map((item, index) => {
                const isDragging = item.key === dragKey;
                const badge = badgeOf ? badgeOf(item) : null;
                return (
                    <div
                        key={item.key}
                        style={isDragging ? { transform: `translateY(${dragOffset}px)`, position: 'relative', zIndex: 20 } : undefined}
                        className={`flex items-center gap-2 p-2 sm:p-3 rounded-xl border transition-colors ${
                            isDragging
                                ? 'border-emerald-500 bg-slate-800 shadow-xl shadow-black/40'
                                : 'border-slate-700 bg-slate-900/60'
                        }`}
                    >
                        <span
                            onPointerDown={(e) => handlePointerDown(e, index)}
                            onPointerMove={handlePointerMove}
                            onPointerUp={endDrag}
                            onPointerCancel={endDrag}
                            style={{ touchAction: 'none' }}
                            title="Zum Sortieren ziehen"
                            className="shrink-0 text-slate-500 hover:text-slate-300 cursor-grab active:cursor-grabbing p-1"
                        >
                            <GripVertical size={18} />
                        </span>

                        <span className="shrink-0 w-6 text-center text-xs font-bold text-slate-500">{index + 1}</span>

                        <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center font-bold text-xs text-white">
                            {(item.name || '?').charAt(0).toUpperCase()}
                        </div>

                        <div className="min-w-0 flex-1">
                            <p className="font-bold text-sm text-slate-200 [overflow-wrap:anywhere]">
                                {item.name}
                                {item.userId === myUserId && <span className="text-slate-400 font-medium"> (Du)</span>}
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-slate-500">
                                {badge || (item.userId ? 'Lobby' : 'Gast')}
                            </p>
                        </div>

                        <div className="flex items-center shrink-0">
                            <button
                                onClick={() => onReorder(index, index - 1)}
                                disabled={index === 0}
                                title="Nach oben"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                                <ChevronUp size={16} />
                            </button>
                            <button
                                onClick={() => onReorder(index, index + 1)}
                                disabled={index === items.length - 1}
                                title="Nach unten"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                            >
                                <ChevronDown size={16} />
                            </button>
                            <button
                                onClick={() => onRemove(item.key)}
                                title="Spielt nicht mit"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                );
            })}
            {items.length === 0 && (
                <p className="text-sm text-slate-500 italic py-4 text-center">Niemand ausgewählt.</p>
            )}
        </div>
    );
}

/**
 * onChange(nextRoster, save) -- save=false waehrend eines laufenden Drags,
 * damit nicht jede uebersprungene Zeile einen Schreibvorgang ausloest.
 */
export default function RosterPanel({ roster, players, myUserId, onChange, hint, badgeOf }) {
    const [guestInput, setGuestInput] = useState('');

    const move = (from, to, save = true) => {
        if (to < 0 || to >= roster.length || from === to) return;
        const next = [...roster];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onChange(next, save);
    };

    const addGuest = () => {
        const name = guestInput.trim().slice(0, NAME_MAX);
        if (!name || roster.length >= MAX_ROSTER) return;
        onChange([...roster, { key: newGuestKey(), name, userId: null }], true);
        setGuestInput('');
    };

    const missingMembers = players.filter((p) => !roster.some((r) => r.userId === p.id));

    return (
        <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-xl">
            <h3 className="text-xl font-bold mb-1 flex items-center gap-2">
                <Users className="text-indigo-400" size={20} /> Mitspieler ({roster.length})
            </h3>
            {hint && <p className="text-xs text-slate-500 mb-4">{hint}</p>}

            <SortableRows
                items={roster}
                myUserId={myUserId}
                badgeOf={badgeOf}
                onReorder={move}
                onRemove={(key) => onChange(roster.filter((r) => r.key !== key), true)}
                onCommit={(items) => onChange(items, true)}
            />

            {missingMembers.length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-700">
                    <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2">Nicht dabei</p>
                    <div className="flex flex-wrap gap-2">
                        {missingMembers.map((p) => (
                            <button
                                key={p.id}
                                onClick={() => {
                                    if (roster.length >= MAX_ROSTER) return;
                                    onChange([...roster, { key: p.id, name: p.name, userId: p.id }], true);
                                }}
                                className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 hover:border-emerald-500 px-3 py-1.5 rounded-lg text-xs transition-colors"
                            >
                                <Plus size={12} className="text-emerald-400" />
                                <span className="[overflow-wrap:anywhere]">{p.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            <div className="mt-5 pt-4 border-t border-slate-700">
                <p className="text-xs uppercase font-bold tracking-widest text-slate-500 mb-2">Gast hinzufügen</p>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={guestInput}
                        maxLength={NAME_MAX}
                        onChange={(e) => setGuestInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') addGuest(); }}
                        placeholder="Name ohne Account..."
                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <button
                        onClick={addGuest}
                        disabled={!guestInput.trim() || roster.length >= MAX_ROSTER}
                        className="bg-emerald-600 p-2 rounded-lg hover:bg-emerald-500 disabled:opacity-40 transition-colors"
                    >
                        <Plus size={20} />
                    </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-2">
                    Gäste spielen mit, bekommen aber keine globalen Punkte.
                </p>
            </div>
        </div>
    );
}
