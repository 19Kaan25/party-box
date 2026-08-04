/**
 * Erzeugt alle PWA-Icons aus EINER Quelldatei.
 *
 *   node scripts/generate-icons.mjs [quelle]
 *
 * Quelle ist standardmaessig public/icon.png (der Party-Pinguin).
 *
 * ACHTUNG -- die aktuelle Quelle ist zu klein: public/icon.png misst 676x369,
 * der sichtbare Pinguin darin nur 196x259 Pixel. Fuer 180er und 192er Icons
 * reicht das, das 512er wird um Faktor ~1,4 hochskaliert und dadurch leicht
 * weich. Sobald eine hoeher aufgeloeste Originaldatei existiert (SVG oder
 * PNG ab 1024x1024), einfach diesen Befehl mit der neuen Datei laufen lassen
 * -- Groessen, Raender und Hintergrund bleiben dann identisch.
 *
 * Warum ein Skript und keine handgemachten Dateien: die Maskable-Variante
 * braucht einen anderen Rand als die normale, und beide muessen bei jedem
 * Icon-Wechsel gleichzeitig neu entstehen. Von Hand geht das genau einmal gut.
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const SOURCE = process.argv[2] ?? 'public/icon.png';
const OUT_DIR = 'public';

// Verlauf aus dem UI (from-purple-500 to-pink-500). Deckend, nicht
// transparent: iOS legt durchsichtige Icons sonst auf Schwarz.
const GRADIENT = { from: '#a855f7', to: '#ec4899' };

/**
 * Anteil der Kantenlaenge, den das Motiv einnehmen darf.
 *
 * 'any' laesst nur so viel Rand, dass das Motiv nicht am Rand klebt.
 * 'maskable' muss deutlich mehr freilassen: Android schneidet das Icon je
 * nach Launcher zu einem Kreis, Squircle oder Rundeck zu. Sicher ist nur
 * der mittlere Kreis mit 80 % Durchmesser -- ein Motiv, das 60 % der Kante
 * einnimmt, passt auch in dessen einbeschriebenes Quadrat.
 */
const COVERAGE = { any: 0.76, maskable: 0.6 };

const TARGETS = [
    { file: 'icon-32.png', size: 32, purpose: 'any' },       // Favicon
    { file: 'icon-180.png', size: 180, purpose: 'any' },     // apple-touch-icon
    { file: 'icon-192.png', size: 192, purpose: 'any' },
    { file: 'icon-512.png', size: 512, purpose: 'any' },
    { file: 'icon-192-maskable.png', size: 192, purpose: 'maskable' },
    { file: 'icon-512-maskable.png', size: 512, purpose: 'maskable' },
];

/** Schneidet vollstaendig durchsichtige Raender weg. sharp.trim() geht von
 *  einer Hintergrundfarbe aus und traf die Alpha-Kante hier nicht sauber,
 *  deshalb der eigene Durchlauf ueber die Rohpixel. */
async function trimToContent(file) {
    const image = sharp(file).ensureAlpha();
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });

    let left = info.width, top = info.height, right = -1, bottom = -1;
    for (let y = 0; y < info.height; y++) {
        for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * info.channels + 3] <= 8) continue;
            if (x < left) left = x;
            if (x > right) right = x;
            if (y < top) top = y;
            if (y > bottom) bottom = y;
        }
    }
    if (right < 0) throw new Error(`${file} ist komplett durchsichtig`);

    const width = right - left + 1;
    const height = bottom - top + 1;
    return {
        buffer: await sharp(file).extract({ left, top, width, height }).png().toBuffer(),
        width,
        height,
    };
}

function background(size) {
    return Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
           <defs>
             <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
               <stop offset="0" stop-color="${GRADIENT.from}"/>
               <stop offset="1" stop-color="${GRADIENT.to}"/>
             </linearGradient>
           </defs>
           <rect width="${size}" height="${size}" fill="url(#g)"/>
         </svg>`,
    );
}

const logo = await trimToContent(SOURCE);
await mkdir(OUT_DIR, { recursive: true });

for (const { file, size, purpose } of TARGETS) {
    const box = Math.round(size * COVERAGE[purpose]);
    const scale = Math.min(box / logo.width, box / logo.height);
    const width = Math.max(1, Math.round(logo.width * scale));
    const height = Math.max(1, Math.round(logo.height * scale));

    const motif = await sharp(logo.buffer)
        .resize(width, height, { kernel: 'lanczos3' })
        .toBuffer();

    await sharp(background(size))
        .composite([{
            input: motif,
            left: Math.round((size - width) / 2),
            top: Math.round((size - height) / 2),
        }])
        .flatten({ background: GRADIENT.from })   // kein Alpha-Kanal im Ergebnis
        .png()
        .toFile(path.join(OUT_DIR, file));

    const factor = (scale).toFixed(2);
    console.log(`${file.padEnd(24)} ${size}x${size}  ${purpose.padEnd(8)} Motiv ${width}x${height} (Faktor ${factor})`);
}
