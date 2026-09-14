/**
 * Phonetic transliteration table: Hiragana to standard Hepburn Romaji.
 */
const HIRAGANA_TO_ROMAJI: Record<string, string> = {
  // Digraphs (Yōon)
  'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
  'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
  'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
  'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
  'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
  'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
  'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
  'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
  'じゃ': 'ja',  'じゅ': 'ju',  'じょ': 'jo',
  'ぢゃ': 'ja',  'ぢゅ': 'ju',  'ぢょ': 'jo',
  'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
  'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',

  // Basic Vowels
  'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',

  // K-row
  'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',

  // S-row
  'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',

  // T-row
  'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',

  // N-row
  'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',

  // H-row
  'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',

  // M-row
  'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',

  // Y-row
  'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',

  // R-row
  'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',

  // W-row & N
  'わ': 'wa', 'ゐ': 'wi', 'ゑ': 'we', 'を': 'wo', 'ん': 'n',

  // Voiced G-row
  'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',

  // Voiced Z-row
  'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',

  // Voiced D-row
  'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'de': 'de', 'ど': 'do',

  // Voiced B-row
  'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',

  // Half-voiced P-row
  'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',

  // Small kana vowels
  'ぁ': 'a', 'ぃ': 'i', 'ぅ': 'u', 'ぇ': 'e', 'ぉ': 'o'
};

/**
 * Converts Japanese Kana (Hiragana & Katakana) to Romaji for internal sorting keys.
 */
export function kanaToRomaji(text: string): string {
  if (!text) return '';

  // 1. Normalize Katakana (0x30A1 - 0x30F6) to Hiragana (0x3041 - 0x3096)
  let hira = text.replace(/[\u30A1-\u30F6]/g, ch =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60)
  );

  // Remove prolonged sound mark (ー)
  hira = hira.replace(/ー/g, '');

  let result = '';
  for (let i = 0; i < hira.length; i++) {
    // Check 2-character digraphs (e.g. きゃ, しょ)
    const two = hira.slice(i, i + 2);
    if (HIRAGANA_TO_ROMAJI[two]) {
      result += HIRAGANA_TO_ROMAJI[two];
      i++;
      continue;
    }

    const one = hira[i];

    // Handle sokuon (small tsu っ) - doubles the next romaji consonant
    if (one === 'っ') {
      const nextOne = hira[i + 1];
      const nextRomaji = HIRAGANA_TO_ROMAJI[nextOne] || '';
      if (nextRomaji && nextRomaji[0]) {
        result += nextRomaji[0];
      }
      continue;
    }

    if (HIRAGANA_TO_ROMAJI[one]) {
      result += HIRAGANA_TO_ROMAJI[one];
    } else {
      result += one;
    }
  }

  return result;
}

/**
 * Extracts a deterministic, phonetic Latin sorting key from a song or title string.
 * Strips accents, punctuation, quotes, and romanizes Japanese kana.
 * This is STRICTLY an internal comparator key; user-facing titles are never modified.
 */
export function getSortKey(item: { title: string; sortTitle?: string } | string): string {
  const raw = typeof item === 'string' ? item : (item.sortTitle || item.title || '');

  // 1. Romanize any Japanese kana phonetically
  let key = kanaToRomaji(raw);

  // 2. Decompose Unicode accents (e.g. É -> E, ø -> o, à -> a)
  key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // 3. Strip leading quotes, punctuation, and non-alphanumerics
  key = key.replace(/^[^a-zA-Z0-9]+/, '');

  return key.toLowerCase().trim();
}

/**
 * Sorts songs alphabetically in-place or into a new array based on their internal phonetic sort key.
 */
export function sortSongs<T extends { title: string; sortTitle?: string }>(songs: T[]): T[] {
  return [...songs].sort((a, b) => {
    const keyA = getSortKey(a);
    const keyB = getSortKey(b);
    return keyA.localeCompare(keyB, undefined, { numeric: true, sensitivity: 'base' });
  });
}
