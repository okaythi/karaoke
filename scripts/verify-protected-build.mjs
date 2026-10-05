// Release check: private arrangement inputs must not reappear in static assets.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const markers = ['closing.n5', 'closing.n2', 'source/performance.mid', 'fantaisie-transkun.mid', 'closing passage transcribed from the recording, rhythm inferred'];
let checked = 0;
function walk(path) {
  for (const name of readdirSync(path)) {
    const file = join(path, name);
    if (statSync(file).isDirectory()) { walk(file); continue; }
    if (/\.(mid|midi|mp3|mp4|map|ly)$/i.test(name)) throw new Error(`Unexpected source/media artifact: ${file}`);
    if (!/\.(js|json|html)$/i.test(name)) continue;
    checked++;
    const text = readFileSync(file, 'utf8');
    for (const marker of markers) if (text.includes(marker)) throw new Error(`Protected score leaked into ${file}: ${marker}`);
  }
}
walk('dist');
console.log(`Protected build verified: ${checked} static files, no Fantaisie arrangement/source/media markers.`);
