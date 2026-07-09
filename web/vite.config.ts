import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,
    passWithNoTests: true,
  },
  build: {
    // opencc-js is inherently large (~1.2 MB) but lazy-loaded via dynamic
    // import from zhconv.ts, so it does not block initial page render. The
    // 500 kB default warning is expected and knowingly suppressed.
    chunkSizeWarningLimit: 1300,
  },
});
