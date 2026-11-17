import React, { useEffect, useRef, useState } from 'react';
import { Undo2, Trash2, Pencil, PaintBucket, Eraser } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Zeichenfläche für Activity. Läuft bewusst NICHT über gameState: jeder
 * Patch löst bei allen einen Refetch aus. Stattdessen ein flüchtiger
 * Realtime-Broadcast-Kanal pro Lobby, Striche gebündelt alle ~100 ms,
 * Koordinaten auf 0–1 normiert.
 *
 * Feste interne Auflösung (W×H) auf jedem Gerät, per CSS skaliert: nur so
 * ergibt das Füllwerkzeug überall dasselbe Bild. Bei geräteabhängiger
 * Auflösung könnte eine Füllung auf einem Handy durch eine Lücke im Strich
 * auslaufen und auf dem anderen nicht.
 *
 * Ein Eintrag in strokes ist ein Strich ({ id, c, w, p }) oder eine
 * Füllung ({ id, c, f: 1, p: [Startpunkt] }). Radieren = weißer Strich.
 * Rückgängig entfernt den letzten Eintrag und zeichnet alles neu.
 *
 * Jede Nachricht trägt `k` (Versuch + Karte). Wechselt k — neuer Versuch
 * oder Begriff getauscht — fängt die Fläche leer an. Wer neu lädt, fragt
 * mit 'need' nach dem vollständigen Stand, der Darsteller antwortet mit
 * 'full'. Lädt der Darsteller selbst neu, ist die Zeichnung weg.
 */

const W = 750;
const H = 1000;
const COLORS = [
    '#0f172a', '#64748b', '#ffffff', '#92400e', '#fcd5b4',
    '#dc2626', '#f97316', '#facc15', '#84cc16', '#16a34a',
    '#06b6d4', '#2563eb', '#7c3aed', '#ec4899', '#f9a8d4',
];
const WIDTHS = [0.008, 0.018, 0.04];
const ERASER = '#ffffff';
const FLUSH_MS = 100;
const FILL_TOLERANCE = 120; // Summe der Kanal-Abweichungen; fängt Kantenglättung der Striche ab

function floodFill(ctx, [nx, ny], hex) {
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const x0 = Math.min(W - 1, Math.floor(nx * W));
    const y0 = Math.min(H - 1, Math.floor(ny * H));
    const s = (y0 * W + x0) * 4;
    const [tr, tg, tb] = [d[s], d[s + 1], d[s + 2]];
    const [fr, fg, fb] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
    if (fr === tr && fg === tg && fb === tb) return;
    const seen = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    let top = 0;
    stack[top++] = y0 * W + x0;
    seen[y0 * W + x0] = 1;
    while (top) {
        const p = stack[--top];
        const i = p * 4;
        const near = Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= FILL_TOLERANCE;
        // Randpixel (erstes nicht passendes) mitfärben, sonst bleibt ein heller Saum am Strich.
        d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
        if (!near) continue;
        const x = p % W;
        const next = [x > 0 && p - 1, x < W - 1 && p + 1, p >= W && p - W, p < W * H - W && p + W];
        for (const q of next) {
            if (q !== false && !seen[q]) { seen[q] = 1; stack[top++] = q; }
        }
    }
    ctx.putImageData(img, 0, 0);
}

/** Zeichnet einen Eintrag ab Punkt `from` (für Strich-Stücke ohne Neuaufbau). */
function paint(ctx, s, from = 0) {
    if (!s.p.length) return;
    if (s.f) {
        if (from === 0) floodFill(ctx, s.p[0], s.c);
        return;
    }
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = s.w * W;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.p.length === 1) {
        ctx.beginPath();
        ctx.arc(s.p[0][0] * W, s.p[0][1] * H, (s.w * W) / 2, 0, Math.PI * 2);
        ctx.fill();
        return;
    }
    const start = Math.max(0, from - 1);
    ctx.beginPath();
    ctx.moveTo(s.p[start][0] * W, s.p[start][1] * H);
    for (const [x, y] of s.p.slice(start + 1)) ctx.lineTo(x * W, y * H);
    ctx.stroke();
}

function redraw(canvas, strokes) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (const s of strokes) paint(ctx, s);
}

function post(channel, k, payload) {
    channel?.send({ type: 'broadcast', event: 'draw', payload: { ...payload, k } });
}

export default function ActivityCanvas({ lobbyCode, drawKey, isActor, canDraw }) {
    const [color, setColor] = useState(COLORS[0]);
    const [width, setWidth] = useState(WIDTHS[1]);
    const [tool, setTool] = useState('pen');   // 'pen' | 'fill' | 'eraser'
    const [paletteOpen, setPaletteOpen] = useState(false);
    const canvasRef = useRef(null);
    const channelRef = useRef(null);
    const strokesRef = useRef([]);
    const sentRef = useRef({});         // id -> Anzahl schon gesendeter Punkte
    const keyRef = useRef(drawKey);
    const drawingRef = useRef(null);    // id des Strichs unter dem Finger

    const ctx = () => canvasRef.current.getContext('2d', { willReadFrequently: true });
    const send = (payload) => post(channelRef.current, keyRef.current, payload);
    const redrawAll = () => redraw(canvasRef.current, strokesRef.current);

    // Kanal einmal pro Lobby.
    useEffect(() => {
        const channel = supabase.channel(`activity:${lobbyCode}`, { config: { broadcast: { self: false } } });
        channelRef.current = channel;

        channel.on('broadcast', { event: 'draw' }, ({ payload }) => {
            if (!payload) return;
            if (payload.t === 'need') {
                if (isActor && payload.k === keyRef.current) post(channel, keyRef.current, { t: 'full', strokes: strokesRef.current });
                return;
            }
            if (isActor) return; // Der Darsteller ist die Quelle, er übernimmt nichts.
            let full = false;
            if (payload.k !== keyRef.current) {
                keyRef.current = payload.k;
                strokesRef.current = [];
                full = true;
            }
            if (payload.t === 'seg') {
                let s = strokesRef.current.find((x) => x.id === payload.id);
                const from = s ? s.p.length : 0;
                if (!s) {
                    s = { id: payload.id, c: payload.c, w: payload.w, f: payload.f, p: [] };
                    strokesRef.current.push(s);
                }
                s.p.push(...payload.pts);
                if (!full) {
                    paint(canvasRef.current.getContext('2d', { willReadFrequently: true }), s, from);
                    return;
                }
            } else if (payload.t === 'undo') {
                strokesRef.current = strokesRef.current.filter((x) => x.id !== payload.id);
            } else if (payload.t === 'clear') {
                strokesRef.current = [];
            } else if (payload.t === 'full') {
                strokesRef.current = payload.strokes || [];
            }
            redraw(canvasRef.current, strokesRef.current);
        });

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED' && !isActor) post(channel, keyRef.current, { t: 'need' });
        });

        return () => {
            channelRef.current = null;
            supabase.removeChannel(channel);
        };
        // isActor bewusst nicht als Abhängigkeit: ein Rollenwechsel
        // erzeugt ohnehin ein neues Mounten (key={turn.n}).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobbyCode]);

    // Erstes Bild (weiße Fläche) und neuer Versuch / Begriff getauscht: Fläche leeren.
    useEffect(() => {
        if (keyRef.current !== drawKey) {
            keyRef.current = drawKey;
            strokesRef.current = [];
            sentRef.current = {};
            if (!isActor) post(channelRef.current, drawKey, { t: 'need' });
        }
        redraw(canvasRef.current, strokesRef.current);
    }, [drawKey, isActor]);

    // Darsteller: neue Punkte gebündelt verschicken (Reihenfolge der Einträge bleibt erhalten).
    useEffect(() => {
        if (!isActor) return undefined;
        const timer = setInterval(() => {
            for (const s of strokesRef.current) {
                const sent = sentRef.current[s.id] || 0;
                if (s.p.length > sent) {
                    post(channelRef.current, keyRef.current, { t: 'seg', id: s.id, c: s.c, w: s.w, f: s.f, pts: s.p.slice(sent) });
                    sentRef.current[s.id] = s.p.length;
                }
            }
        }, FLUSH_MS);
        return () => clearInterval(timer);
    }, [isActor]);

    const pointAt = (e) => {
        const r = canvasRef.current.getBoundingClientRect();
        const clamp = (v) => Math.min(1, Math.max(0, v));
        // Auf 3 Nachkommastellen runden: halbiert die Broadcast-Größe, unsichtbar.
        return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)]
            .map((v) => Math.round(v * 1000) / 1000);
    };

    const onDown = (e) => {
        if (!canDraw) return;
        e.preventDefault();
        setPaletteOpen(false);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        if (tool === 'fill') {
            const s = { id, c: color, w: 0, f: 1, p: [pointAt(e)] };
            strokesRef.current.push(s);
            paint(ctx(), s);
            return;
        }
        canvasRef.current.setPointerCapture?.(e.pointerId);
        const s = { id, c: tool === 'eraser' ? ERASER : color, w: width, p: [pointAt(e)] };
        strokesRef.current.push(s);
        drawingRef.current = id;
        paint(ctx(), s);
    };
    const onMove = (e) => {
        if (!canDraw || !drawingRef.current) return;
        const s = strokesRef.current.find((x) => x.id === drawingRef.current);
        if (!s) return;
        s.p.push(pointAt(e));
        paint(ctx(), s, s.p.length - 1);
    };
    const onUp = () => { drawingRef.current = null; };

    const undo = () => {
        const s = strokesRef.current.pop();
        if (!s) return;
        delete sentRef.current[s.id];
        send({ t: 'undo', id: s.id });
        redrawAll();
    };
    const clear = () => {
        if (!strokesRef.current.length || !window.confirm('Ganze Zeichnung löschen?')) return;
        strokesRef.current = [];
        sentRef.current = {};
        send({ t: 'clear' });
        redrawAll();
    };
    const pickColor = (c, close = true) => {
        setColor(c);
        if (tool === 'eraser') setTool('pen');
        if (close) setPaletteOpen(false);
    };

    const toolBtn = (active) => `w-7 h-7 rounded-lg flex items-center justify-center ${active ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-200'}`;
    const sep = <span className="w-px h-6 bg-slate-700 mx-0.5" />;

    return (
        <div className="w-full flex flex-col items-center gap-2 select-none" style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
            <canvas
                ref={canvasRef}
                width={W}
                height={H}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onContextMenu={(e) => e.preventDefault()}
                className="rounded-2xl border border-slate-600 bg-white shadow-xl"
                // Breite aus der Höhe ableiten statt max-height: so bleibt es exakt 3:4 und
                // die normierten Koordinaten sind auf jedem Gerät unverzerrt. Höhe ≤ 44vh,
                // damit "Erraten" beim Malen ohne Scrollen erreichbar bleibt.
                // touch-action:none — sonst scrollt die Seite beim Malen bzw. Pull-to-Refresh greift.
                style={{ width: 'min(100%, 31vh)', aspectRatio: '3 / 4', touchAction: 'none', cursor: tool === 'fill' ? 'cell' : 'crosshair' }}
            />
            {isActor && canDraw && (
                <div className="relative flex items-center gap-1 justify-center">
                    {paletteOpen && (
                        <div className="absolute bottom-full mb-2 left-0 z-20 bg-slate-800 border border-slate-600 rounded-2xl p-2 shadow-2xl grid grid-cols-8 gap-1.5">
                            {COLORS.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => pickColor(c)}
                                    aria-label={`Farbe ${c}`}
                                    className={`w-8 h-8 rounded-full border-2 ${color === c && tool !== 'eraser' ? 'border-orange-400 scale-110' : 'border-slate-600'}`}
                                    style={{ background: c }}
                                />
                            ))}
                            <label
                                aria-label="Eigene Farbe"
                                className="relative w-8 h-8 rounded-full border-2 border-slate-600 overflow-hidden"
                                style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}
                            >
                                <input
                                    type="color"
                                    value={color}
                                    onChange={(e) => pickColor(e.target.value, false)}
                                    className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                                />
                            </label>
                        </div>
                    )}
                    <button
                        onClick={() => setPaletteOpen((o) => !o)}
                        aria-label="Farbe wählen"
                        className={`w-7 h-7 rounded-full border-2 ${paletteOpen ? 'border-orange-400' : 'border-white'}`}
                        style={{ background: color }}
                    />
                    {sep}
                    <button onClick={() => setTool('pen')} aria-label="Stift" className={toolBtn(tool === 'pen')}><Pencil size={15} /></button>
                    <button onClick={() => setTool('fill')} aria-label="Fläche füllen" className={toolBtn(tool === 'fill')}><PaintBucket size={15} /></button>
                    <button onClick={() => setTool('eraser')} aria-label="Radierer" className={toolBtn(tool === 'eraser')}><Eraser size={15} /></button>
                    {sep}
                    {WIDTHS.map((w, i) => (
                        <button
                            key={w}
                            onClick={() => { setWidth(w); if (tool === 'fill') setTool('pen'); }}
                            aria-label={['Dünn', 'Mittel', 'Dick'][i]}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${width === w && tool !== 'fill' ? 'bg-slate-600' : 'bg-slate-800'}`}
                        >
                            <span className="rounded-full bg-white" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                        </button>
                    ))}
                    {sep}
                    <button onClick={undo} aria-label="Rückgängig" className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-slate-200">
                        <Undo2 size={16} />
                    </button>
                    <button onClick={clear} aria-label="Alles löschen" className="w-7 h-7 rounded-lg bg-slate-800 flex items-center justify-center text-red-300">
                        <Trash2 size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
