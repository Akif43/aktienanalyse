/** Erzeugt die PNG-Icons für Manifest und iOS aus apps/web/public/icon.svg. Aufruf: npm run icons */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const svg = readFileSync('apps/web/public/icon.svg');
const out = (name) => `apps/web/public/${name}`;

await sharp(svg).resize(192, 192).png().toFile(out('icon-192.png'));
await sharp(svg).resize(512, 512).png().toFile(out('icon-512.png'));
// iOS legt selbst Rundungen an: apple-touch-icon ohne Transparenz, vollflächig
await sharp(svg).resize(180, 180).flatten({ background: '#0b1220' }).png().toFile(out('apple-touch-icon.png'));
// Maskable: Motiv auf 80 % verkleinert in die sichere Zone, Hintergrund vollflächig
const inner = await sharp(svg).resize(410, 410).png().toBuffer();
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0b1220' } })
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(out('icon-maskable-512.png'));
console.log('Icons erzeugt');
