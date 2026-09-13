/**
 * Full ASCII (extended) Code 39: the shift characters `$ % / +` combined with the
 * following letter encode the complete ASCII range 0–127.
 */

const A = 'A'.charCodeAt(0);
const Z = 'Z'.charCodeAt(0);

type PairDecoder = (letter: number) => number | null;

const inRange = (letter: number, from: string, to: string): boolean =>
  letter >= from.charCodeAt(0) && letter <= to.charCodeAt(0);

const PAIR_DECODERS: Readonly<Record<string, PairDecoder>> = {
  // +A..+Z → a..z
  '+': (letter) => (inRange(letter, 'A', 'Z') ? letter + 32 : null),
  // $A..$Z → control characters 1..26
  $: (letter) => (inRange(letter, 'A', 'Z') ? letter - 64 : null),
  // /A../O → ! " # $ % & ' ( ) * + , - . /   and /Z → :
  '/': (letter) => {
    if (inRange(letter, 'A', 'O')) return letter - 32;
    return letter === Z ? ':'.charCodeAt(0) : null;
  },
  '%': (letter) => {
    if (inRange(letter, 'A', 'E')) return letter - 38; // ESC FS GS RS US (27..31)
    if (inRange(letter, 'F', 'J')) return letter - 11; // ; < = > ?
    if (inRange(letter, 'K', 'O')) return letter + 16; // [ \ ] ^ _
    if (inRange(letter, 'P', 'T')) return letter + 43; // { | } ~ DEL
    if (letter === 'U'.charCodeAt(0)) return 0; // NUL
    if (letter === 'V'.charCodeAt(0)) return '@'.charCodeAt(0);
    if (letter === 'W'.charCodeAt(0)) return '`'.charCodeAt(0);
    if (inRange(letter, 'X', 'Z')) return 127; // DEL (alternate forms)
    return null;
  },
};

/**
 * Expands a raw Code 39 payload using Full ASCII rules.
 * Returns `null` when the payload contains an invalid shift sequence.
 */
export function expandFullAscii(raw: string): string | null {
  let text = '';
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]!;
    const decodePair = PAIR_DECODERS[char];
    if (!decodePair) {
      text += char;
      continue;
    }
    const letter = raw.charCodeAt(i + 1);
    const code = Number.isNaN(letter) || letter < A || letter > Z ? null : decodePair(letter);
    if (code === null) return null;
    text += String.fromCharCode(code);
    i++;
  }
  return text;
}
