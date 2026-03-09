import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Minimal dev-time timing logs
const devTimingPlugin = () => ({
  name: 'dev-timing-logs',
  apply: 'serve',
  configResolved() {
    console.time('[timing] vite:startup');
  },
  configureServer(server) {
    server.httpServer?.once('listening', () => {
      console.timeEnd('[timing] vite:startup');
    });
  },
});

export default defineConfig({
  plugins: [sveltekit(), devTimingPlugin()],
});
