import OpenCC from 'opencc-js';

const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });

const PUNCT_MAP: Record<string, string> = {
  '.': '。',
  '?': '？',
  ',': '，',
  ':': '：',
  ';': '；',
  '!': '！',
};

export function toTraditional(text: string): string {
  return converter(text);
}

export function convertPunctuation(text: string): string {
  return text.replace(/[.?,:;!]/g, (ch) => PUNCT_MAP[ch] ?? ch);
}
