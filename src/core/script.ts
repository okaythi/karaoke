/** Kana, kanji and CJK punctuation, including full-width forms. */
const CJK = /[　-〿぀-ヿ㐀-䶿一-龯＀-ﾟ]/;
/** Kana and kanji only: the characters that mark a title or name as Japanese. */
const JAPANESE_LETTERS = /[぀-ヿ㐀-鿿]/u;

export const hasCjk = (text: string): boolean => CJK.test(text);
export const hasJapaneseLetters = (text: string): boolean => JAPANESE_LETTERS.test(text);
