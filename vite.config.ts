import { defineConfig } from 'vite';

export default defineConfig({
  // The Supabase Marketplace integration sets NEXT_PUBLIC_* variables on Vercel; expose those too.
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
  build: {
    // Phaser is one big library; keep it in its own cacheable chunk.
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
    chunkSizeWarningLimit: 1600,
  },
});
