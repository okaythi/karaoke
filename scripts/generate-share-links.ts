import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import type { SongMetadata } from '../src/types/karaoke';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const manifestPath = path.join(projectRoot, 'src', 'data', 'songs-manifest.json');
const lyricsDir = path.join(projectRoot, 'src', 'data', 'lyrics');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function generateRandomCode(length = 6): string {
  let res = '';
  for (let i = 0; i < length; i++) {
    res += CHARS.charAt(Math.floor(Math.random() * CHARS.length));
  }
  return res;
}

async function main() {
  console.log('🔄 Loading songs manifest...');
  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest: SongMetadata[] = JSON.parse(manifestRaw);

  const usedCodes = new Set<string>();
  for (const song of manifest) {
    if (song.shareCode) {
      usedCodes.add(song.shareCode);
    }
  }

  const d1Inserts: { code: string; song_id: string; file_name: string }[] = [];

  for (const song of manifest) {
    // 1. Ensure unique 6-character code
    if (!song.shareCode) {
      let code = generateRandomCode(6);
      while (usedCodes.has(code)) {
        code = generateRandomCode(6);
      }
      song.shareCode = code;
      usedCodes.add(code);
      console.log(`✨ Generated share code "${code}" for "${song.title}" (${song.id})`);
    }

    // 2. Specific flag adjustments requested:
    // Zaterdag: remove dialect flag
    if (song.id === 'zaterdag') {
      song.isDialect = false;
      console.log('📝 Removed dialect flag from Zaterdag');
    }

    // Grafgravers: support flag + Phatmark Collective link
    if (song.id === 'grafgravers-van-de-g-no-de-h') {
      song.support = true;
      song.supportItems = [
        {
          itemName: 'Phatmark Collective',
          itemLink: 'https://phatmarkcollective.bandcamp.com/'
        }
      ];
      console.log('🎸 Added support flag & Phatmark Collective link to Grafgravers');
    }

    d1Inserts.push({
      code: song.shareCode,
      song_id: song.id,
      file_name: song.videoFile
    });

    // 3. Update individual lyric JSON file if it exists
    const lyricFilePath = path.join(lyricsDir, `${song.id}.json`);
    if (fs.existsSync(lyricFilePath)) {
      try {
        const lyricJson = JSON.parse(fs.readFileSync(lyricFilePath, 'utf8'));
        lyricJson.shareCode = song.shareCode;
        if (song.id === 'zaterdag') lyricJson.isDialect = false;
        if (song.id === 'grafgravers-van-de-g-no-de-h') {
          lyricJson.support = true;
          lyricJson.supportItems = song.supportItems;
        }
        fs.writeFileSync(lyricFilePath, JSON.stringify(lyricJson, null, 2), 'utf8');
      } catch (err) {
        console.warn(`Could not update lyric file ${lyricFilePath}:`, err);
      }
    }
  }

  // Write updated manifest
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log('✅ Updated src/data/songs-manifest.json and lyric files.');

  // Populate D1 database
  console.log(`\n📦 Upserting ${d1Inserts.length} codes into D1 table "song_links"...`);
  const sqlStatements = d1Inserts.map(item => {
    const escapedFile = item.file_name.replace(/'/g, "''");
    const escapedSong = item.song_id.replace(/'/g, "''");
    return `INSERT INTO song_links (code, song_id, file_name) VALUES ('${item.code}', '${escapedSong}', '${escapedFile}') ON CONFLICT(code) DO UPDATE SET song_id = excluded.song_id, file_name = excluded.file_name;`;
  }).join(' ');

  try {
    const d1Cmd = `npx wrangler d1 execute system_data --remote --command="${sqlStatements.replace(/"/g, '\\"')}"`;
    const output = execSync(d1Cmd, { cwd: projectRoot, encoding: 'utf8' });
    console.log(output);
    console.log('🎉 Successfully populated D1 database!');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('❌ Failed to run D1 command:', msg);
  }
}

main().catch(console.error);
