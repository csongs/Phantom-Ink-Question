declare module 'pinyin-to-zhuyin' {
  export function p2z(pinyin: string, options?: { tonemarks?: boolean }): string;
  export function z2p(zhuyin: string, options?: Record<string, unknown>): string;
}
