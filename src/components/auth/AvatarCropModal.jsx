import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, ZoomIn } from 'lucide-react';

/** Sichtbarer Ausschnitt (quadratisch, in CSS-Pixeln) und Ziel-Aufloesung
 *  des hochgeladenen Bildes. 512 statt der frueheren 256: die Klick-Vorschau
 *  in Avatar.jsx zeigt das Bild bildschirmfuellend (`max-w-full max-h-full`)
 *  -- bei 256 war das auf einem Handy sichtbar hochskaliert und wirkte
 *  verpixelt, obwohl die Quelle (z. B. ein iPhone-Foto) selbst viel mehr
 *  Aufloesung hatte. In der kleinen Darstellung (36-112 px an anderen
 *  Stellen) war der Unterschied nie zu sehen. */
const VIEWPORT = 280;
const OUTPUT = 512;
const MAX_ZOOM = 3;

/**
 * Kreisförmiger Bildausschnitt mit Pan (Ziehen) und Zoom (Slider), bevor der
 * Avatar hochgeladen wird -- vorher wurde das ganze Bild proportional
 * verkleinert und `object-cover` entschied unsichtbar, welcher Teil im
 * Kreis landet. Kein Zuschneide-Werkzeug im Projekt vorhanden und keins
 * nachinstalliert: dieselbe Handvoll Canvas-/Pointer-Event-Zeilen wie beim
 * Drag in RosterPanel.jsx, keine neue Abhängigkeit für einen einzigen Dialog.
 *
 * `zoom = 1` entspricht `object-fit: cover` fuer den ganzen Kreis -- die
 * kuerzere Bildseite fuellt den Kreis exakt, laengere Seite ragt heraus und
 * ist per Pan erreichbar. Rein-/Rauszoomen skaliert von dort aus weiter.
 */
export default function AvatarCropModal({ file, onCancel, onConfirm }) {
    // Lazy-Initialisierer statt Effect+setState: die Komponente wird pro
    // ausgewaehlter Datei neu gemountet (ProfileModal rendert sie nur
    // bedingt), `file` aendert sich also nie waehrend ihres Lebenszyklus --
    // die Object-URL einmalig beim ersten Rendern zu erzeugen ist hier
    // korrekt, keine Reaktion auf Prop-Aenderungen noetig.
    const [objectUrl] = useState(() => URL.createObjectURL(file));
    const [naturalSize, setNaturalSize] = useState(null);
    const [zoom, setZoom] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [saving, setSaving] = useState(false);
    const imgRef = useRef(null);
    const dragRef = useRef(null);

    useEffect(() => () => URL.revokeObjectURL(objectUrl), [objectUrl]);

    // Anzeige-Grösse bei aktuellem Zoom, in CSS-Pixeln. Bei zoom=1 füllt die
    // kürzere Bildseite exakt VIEWPORT.
    const display = useMemo(() => {
        if (!naturalSize) return null;
        const baseScale = VIEWPORT / Math.min(naturalSize.w, naturalSize.h);
        const scale = baseScale * zoom;
        return { w: naturalSize.w * scale, h: naturalSize.h * scale, scale };
    }, [naturalSize, zoom]);

    /** Pan darf das Bild nie so weit verschieben, dass eine Kante der
     *  Kreisfläche leer bliebe -- Grenze ist der Überstand über VIEWPORT. */
    const clampOffset = (next, disp) => {
        const maxX = Math.max(0, (disp.w - VIEWPORT) / 2);
        const maxY = Math.max(0, (disp.h - VIEWPORT) / 2);
        return {
            x: Math.min(maxX, Math.max(-maxX, next.x)),
            y: Math.min(maxY, Math.max(-maxY, next.y)),
        };
    };

    const handleImgLoad = (e) => {
        setNaturalSize({ w: e.target.naturalWidth, h: e.target.naturalHeight });
    };

    const handleZoomChange = (e) => {
        const nextZoom = Number(e.target.value);
        setZoom(nextZoom);
        if (!naturalSize) return;
        const baseScale = VIEWPORT / Math.min(naturalSize.w, naturalSize.h);
        const scale = baseScale * nextZoom;
        setOffset((prev) => clampOffset(prev, { w: naturalSize.w * scale, h: naturalSize.h * scale }));
    };

    const onPointerDown = (e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, startOffset: offset };
    };
    const onPointerMove = (e) => {
        if (!dragRef.current || !display) return;
        const { startX, startY, startOffset } = dragRef.current;
        const next = { x: startOffset.x + (e.clientX - startX), y: startOffset.y + (e.clientY - startY) };
        setOffset(clampOffset(next, display));
    };
    const endDrag = () => { dragRef.current = null; };

    const confirm = async () => {
        if (!display || !imgRef.current) return;
        setSaving(true);
        try {
            const left = VIEWPORT / 2 - display.w / 2 + offset.x;
            const top = VIEWPORT / 2 - display.h / 2 + offset.y;
            // Rueckrechnung von CSS-Anzeige- in Bild-Originalkoordinaten ueber
            // denselben (gleichfoermigen) Skalierungsfaktor.
            const srcSize = VIEWPORT / display.scale;
            const srcX = -left / display.scale;
            const srcY = -top / display.scale;

            const canvas = document.createElement('canvas');
            canvas.width = OUTPUT;
            canvas.height = OUTPUT;
            canvas.getContext('2d').drawImage(
                imgRef.current, srcX, srcY, srcSize, srcSize, 0, 0, OUTPUT, OUTPUT
            );
            canvas.toBlob(
                (blob) => { setSaving(false); if (blob) onConfirm(blob); },
                'image/webp',
                0.85
            );
        } catch {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[120] p-4">
            <div className="bg-slate-800 rounded-3xl p-6 border border-slate-700 shadow-2xl w-full max-w-sm">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-white">Ausschnitt wählen</h3>
                    <button onClick={onCancel} className="text-slate-400 hover:text-white transition-colors">
                        <X size={22} />
                    </button>
                </div>

                <div
                    className="relative mx-auto rounded-2xl overflow-hidden bg-slate-950 touch-none select-none cursor-grab active:cursor-grabbing"
                    style={{ width: VIEWPORT, height: VIEWPORT }}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                >
                    {display ? (
                        <img
                            ref={imgRef}
                            src={objectUrl}
                            alt=""
                            draggable={false}
                            onLoad={handleImgLoad}
                            className="absolute pointer-events-none"
                            style={{
                                width: display.w,
                                height: display.h,
                                left: VIEWPORT / 2 - display.w / 2 + offset.x,
                                top: VIEWPORT / 2 - display.h / 2 + offset.y,
                            }}
                        />
                    ) : (
                        // Erstes Rendern, bevor naturalWidth/-height bekannt sind
                        // (kein display-Wert): unsichtbar geladen, nur um
                        // onLoad zu bekommen -- danach uebernimmt der Zweig oben.
                        <img
                            ref={imgRef}
                            src={objectUrl}
                            alt=""
                            onLoad={handleImgLoad}
                            className="opacity-0 absolute w-1 h-1"
                        />
                    )}
                    {/* Kreisfoermige Spotlight-Maske: alles ausserhalb wird
                        abgedunkelt, damit sofort klar ist, was tatsaechlich im
                        runden Avatar landet. */}
                    <div
                        className="pointer-events-none absolute inset-0 rounded-full"
                        style={{ boxShadow: '0 0 0 9999px rgba(15,23,42,0.82)' }}
                    />
                </div>

                <div className="flex items-center gap-3 mt-5">
                    <ZoomIn size={16} className="text-slate-400 shrink-0" />
                    <input
                        type="range"
                        min={1}
                        max={MAX_ZOOM}
                        step={0.01}
                        value={zoom}
                        onChange={handleZoomChange}
                        disabled={!display}
                        className="flex-1 accent-indigo-500"
                    />
                </div>
                <p className="text-xs text-slate-500 text-center mt-2">Ziehen zum Verschieben, Regler zum Zoomen</p>

                <div className="flex gap-3 mt-5">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl font-medium text-slate-300 hover:bg-slate-700 transition-colors"
                    >
                        Abbrechen
                    </button>
                    <button
                        onClick={confirm}
                        disabled={!display || saving}
                        className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                        <Check size={18} /> Übernehmen
                    </button>
                </div>
            </div>
        </div>
    );
}
