// Lazy-load opencc-js so the 500 kB+ chunk is fetched lazily, not on initial
// page load. The only consumer (generator.ts postProcess/generateAnswer) is
// already async, so no call sites needed async migration beyond awaiting here.
let converterPromise: Promise<(text: string) => string> | null = null;

async function getConverter(): Promise<(text: string) => string> {
  if (!converterPromise) {
    converterPromise = (async () => {
      const OpenCC = await import('opencc-js');
      return OpenCC.Converter({ from: 'cn', to: 'tw' });
    })();
  }
  return converterPromise;
}

const PUNCT_MAP: Record<string, string> = {
  '.': '。',
  '?': '？',
  ',': '，',
  ':': '：',
  ';': '；',
  '!': '！',
};

export async function toTraditional(text: string): Promise<string> {
  const converter = await getConverter();
  return converter(text);
}

export function convertPunctuation(text: string): string {
  return text.replace(/[.?,:;!]/g, (ch) => PUNCT_MAP[ch] ?? ch);
}
