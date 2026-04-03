/**
 * Unicode-safe slug generator.
 * Transliterates common Latin-extended characters (Turkish, German, French, etc.)
 * then falls back to removing remaining non-ASCII.
 */

const CHAR_MAP: Record<string, string> = {
  // Turkish
  ş: 's',
  Ş: 'S',
  ç: 'c',
  Ç: 'C',
  ğ: 'g',
  Ğ: 'G',
  ı: 'i',
  İ: 'I',
  ö: 'o',
  Ö: 'O',
  ü: 'u',
  Ü: 'U',
  // German
  ä: 'a',
  Ä: 'A',
  ß: 'ss',
  // French / Spanish / Portuguese
  à: 'a',
  â: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  î: 'i',
  ï: 'i',
  ô: 'o',
  ù: 'u',
  û: 'u',
  ÿ: 'y',
  ñ: 'n',
  Ñ: 'N',
  ã: 'a',
  õ: 'o',
  // Nordic
  å: 'a',
  Å: 'A',
  æ: 'ae',
  Æ: 'AE',
  ø: 'o',
  Ø: 'O',
  // Polish / Czech / etc.
  ł: 'l',
  Ł: 'L',
  ź: 'z',
  ż: 'z',
  ć: 'c',
  ń: 'n',
  ř: 'r',
  ď: 'd',
  ť: 't',
  ň: 'n',
  ě: 'e',
  ů: 'u',
  // Common symbols
  '&': 'and',
  '@': 'at',
};

function transliterate(input: string): string {
  let result = '';
  for (const char of input) {
    result += CHAR_MAP[char] ?? char;
  }
  return result;
}

export function slugify(value: string): string {
  return transliterate(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
