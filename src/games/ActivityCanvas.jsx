import React, { useEffect, useRef, useState } from 'react';
import { Undo2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Zeichenfläche für Activity. Läuft bewusst NICHT über gameState: jeder
 * Patch löst bei allen einen Refetch aus. Stattdessen ein flüchtiger
 * Realtime-Broadcast-Kanal pro Lobby, Striche gebündelt alle ~100 ms,
 * Koordinaten auf 0–1 normiert (feste 3:4-Fläche, damit auch die
 * Proportionen auf jedem Gerät stimmen).
 *
 * Jede Nachricht trägt `k` (Versuch + Karte). Wechselt k — neuer Versuch
 * oder Begriff getauscht — fängt die Fläche leer an. Wer neu lädt, fragt
 * mit 'need' nach dem vollständigen Stand, der Darsteller antwortet mit
 * 'full'. Lädt der Darsteller selbst neu, ist die Zeichnung weg.
 */

const COLORS = ['#0f172a', '#dc2626', '#2563eb', '#16a34a', '#f59e0b'];
const WIDTHS = [0.008, 0.018, 0.04];
const FLUSH_MS = 100;

export default function ActivityCanvas({ lobbyCode, drawKey, isActor, canDraw }) {
    const [color, setColor] = useState(COLORS[0]);
    const [width, setWidth] = useState(WIDTHS[1]);
    const canvasRef = useRef(null);
    const channelRef = useRef(null);
    const strokesRef = useRef([]);      // [{ id, c, w, p: [[x,y], …] }]
    const sentRef = useRef({});         // id -> Anzahl schon gesendeter Punkte
    const keyRef = useRef(drawKey);
    const drawingRef = useRef(null);    // id des Strichs unter dem Finger

    const redraw = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const { width: W, height: H } = canvas;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const s of strokesRef.current) {
            if (!s.p.length) continue;
            ctx.strokeStyle = s.c;
            ctx.fillStyle = s.c;
            ctx.lineWidth = s.w * W;
            if (s.p.length === 1) {
                ctx.beginPath();
                ctx.arc(s.p[0][0] * W, s.p[0][1] * H, (s.w * W) / 2, 0, Math.PI * 2);
                ctx.fill();
                continue;
            }
            ctx.beginPath();
            ctx.moveTo(s.p[0][0] * W, s.p[0][1] * H);
            for (const [x, y] of s.p.slice(1)) ctx.lineTo(x * W, y * H);
            ctx.stroke();
        }
    };
    // Immer die aktuelle redraw-Fassung für Kanal-Callbacks und Effects.
    const redrawRef = useRef(redraw);
    useEffect(() => { redrawRef.current = redraw; });

    const send = (payload) => {
        channelRef.current?.send({ type: 'broadcast', event: 'draw', payload: { ...payload, k: keyRef.current } });
    };

    // Kanal einmal pro Lobby.
    useEffect(() => {
        const channel = supabase.channel(`activity:${lobbyCode}`, { config: { broadcast: { self: false } } });
        channelRef.current = channel;

        const reset = (k) => {
            keyRef.current = k;
            strokesRef.current = [];
            sentRef.current = {};
        };

        channel.on('broadcast', { event: 'draw' }, ({ payload }) => {
            if (!payload) return;
            if (payload.t === 'need') {
                if (isActor && payload.k === keyRef.current) send({ t: 'full', strokes: strokesRef.current });
                return;
            }
            if (isActor) return; // Der Darsteller ist die Quelle, er übernimmt nichts.
            if (payload.k !== keyRef.current) reset(payload.k);
            if (payload.t === 'seg') {
                let s = strokesRef.current.find((x) => x.id === payload.id);
                if (!s) {
                    s = { id: payload.id, c: payload.c, w: payload.w, p: [] };
                    strokesRef.current.push(s);
                }
                s.p.push(...payload.pts);
            } else if (payload.t === 'undo') {
                strokesRef.current = strokesRef.current.filter((x) => x.id !== payload.id);
            } else if (payload.t === 'clear') {
                strokesRef.current = [];
            } else if (payload.t === 'full') {
                strokesRef.current = payload.strokes || [];
            }
            redrawRef.current();
        });

        channel.subscribe((status) => {
            if (status === 'SUBSCRIBED' && !isActor) send({ t: 'need' });
        });

        return () => {
            channelRef.current = null;
            supabase.removeChannel(channel);
        };
        // send/isActor bewusst nicht als Abhängigkeit: ein Rollenwechsel
        // erzeugt ohnehin einen neuen drawKey bzw. ein neues Mounten.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobbyCode]);

    // Neuer Versuch oder Begriff getauscht: Fläche leeren.
    useEffect(() => {
        if (keyRef.current === drawKey) return;
        keyRef.current = drawKey;
        strokesRef.current = [];
        sentRef.current = {};
        redrawRef.current();
        if (!isActor) send({ t: 'need' });
    }, [drawKey, isActor]);

    // Darsteller: neue Punkte gebündelt verschicken.
    useEffect(() => {
        if (!isActor) return undefined;
        const timer = setInterval(() => {
            for (const s of strokesRef.current) {
                const sent = sentRef.current[s.id] || 0;
                if (s.p.length > sent) {
                    send({ t: 'seg', id: s.id, c: s.c, w: s.w, pts: s.p.slice(sent) });
                    sentRef.current[s.id] = s.p.length;
                }
            }
        }, FLUSH_MS);
        return () => clearInterval(timer);
    }, [isActor]);

    // Canvas an die Containerbreite anpassen (Pixel = CSS-Pixel × dpr).
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return undefined;
        const fit = () => {
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.round(canvas.clientWidth * dpr);
            canvas.height = Math.round(canvas.clientHeight * dpr);
            redrawRef.current();
        };
        fit();
        const ro = new ResizeObserver(fit);
        ro.observe(canvas);
        return () => ro.disconnect();
    }, []);

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
        canvasRef.current.setPointerCapture?.(e.pointerId);
        const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        strokesRef.current.push({ id, c: color, w: width, p: [pointAt(e)] });
        drawingRef.current = id;
        redraw();
    };
    const onMove = (e) => {
        if (!canDraw || !drawingRef.current) return;
        const s = strokesRef.current.find((x) => x.id === drawingRef.current);
        if (!s) return;
        s.p.push(pointAt(e));
        redraw();
    };
    const onUp = () => { drawingRef.current = null; };

    const undo = () => {
        const s = strokesRef.current.pop();
        if (!s) return;
        delete sentRef.current[s.id];
        send({ t: 'undo', id: s.id });
        redraw();
    };
    const clear = () => {
        if (!strokesRef.current.length) return;
        strokesRef.current = [];
        sentRef.current = {};
        send({ t: 'clear' });
        redraw();
    };

    return (
        <div className="w-full flex flex-col items-center gap-2 select-none" style={{ WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}>
            <canvas
                ref={canvasRef}
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
                style={{ width: 'min(100%, 31vh)', aspectRatio: '3 / 4', touchAction: 'none' }}
            />
            {isActor && canDraw && (
                <div className="flex items-center gap-1 justify-center">
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            onClick={() => setColor(c)}
                            aria-label={`Farbe ${c}`}
                            className={`w-7 h-7 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-slate-600'}`}
                            style={{ background: c }}
                        />
                    ))}
                    <span className="w-px h-6 bg-slate-700 mx-0.5" />
                    {WIDTHS.map((w, i) => (
                        <button
                            key={w}
                            onClick={() => setWidth(w)}
                            aria-label={['Dünn', 'Mittel', 'Dick'][i]}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center ${width === w ? 'bg-slate-600' : 'bg-slate-800'}`}
                        >
                            <span className="rounded-full bg-white" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
                        </button>
                    ))}
                    <span className="w-px h-6 bg-slate-700 mx-0.5" />
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
