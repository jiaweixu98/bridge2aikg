import adapter from '@sveltejs/adapter-vercel';
import preprocess from 'svelte-preprocess';
import { resolve } from 'path';
import { optimizeImports, optimizeCss, icons, elements } from 'carbon-preprocess-svelte';

const production = process.env.NODE_ENV === 'production';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  // Consult https://github.com/sveltejs/svelte-preprocess
  // for more information about preprocessors
  preprocess: [preprocess(), optimizeImports()],

  kit: {
    inlineStyleThreshold: 2048,
    adapter: adapter({
      runtime: 'nodejs20.x',
      maxDuration: 300, // Allow up to 5 minutes for large data responses (Pro plan)
      memory: 3008, // Use maximum memory available on Pro plan
    }),
    prerender: {
      concurrency: 6,
    },
    alias: {
      'src/*': './src/*',
    },
  },
  viteOptions: {
    plugins: [
      // production && optimizeCss({ safelist: { deep: [/.*data-*$/] } }),
      icons(),
      elements(),
    ],
    resolve: {
      alias: {
        src: resolve('./src'),
      },
    },
    build: {
      sourcemap: true,
    },
    optimizeDeps: {
      include: ['@carbon/charts'],
    },
    ssr: {
      noExternal: process.env.NODE_ENV === 'production' ? ['@carbon/charts'] : [],
    },
  },
  experimental: {
    inspector: {
      holdMode: true,
    },
    prebundleSvelteLibraries: true,
  },
};

export default config;
