<script lang="ts">
    import 'carbon-components-svelte/css/g100.css';
    import { env } from '$env/dynamic/public';
    import { maybeInitSentry } from '../sentry.js';
  
    import '../index.css';

    const PUBLIC_GA_ID = env.PUBLIC_GA_ID;
  
    maybeInitSentry();

    if (typeof window !== 'undefined') {
      if (PUBLIC_GA_ID) {
        const w = window as any;
        w.dataLayer = w.dataLayer || [];
        w.gtag = function () {
          w.dataLayer.push(arguments);
        };
        w.gtag('js', new Date());
        w.gtag('config', PUBLIC_GA_ID);
      }

      const navStart = performance.timing?.navigationStart ?? performance.timeOrigin ?? Date.now();
      const paintLogged = { fp: false, fcp: false };
      new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries()) {
          if ((entry as any).name === 'first-paint' && !paintLogged.fp) {
            paintLogged.fp = true;
            console.log('[timing] client first-paint:', Math.round(entry.startTime), 'ms');
          }
          if ((entry as any).name === 'first-contentful-paint' && !paintLogged.fcp) {
            paintLogged.fcp = true;
            console.log('[timing] client first-contentful-paint:', Math.round(entry.startTime), 'ms');
          }
        }
      }).observe({ type: 'paint', buffered: true } as any);

      // Log when the page fully loads and total transfer size if available via PerformanceNavigationTiming
      window.addEventListener('load', () => {
        const navEntries = performance.getEntriesByType('navigation') as PerformanceEntry[];
        const nav = navEntries && (navEntries[0] as any);
        const transferMB = nav && nav.transferSize ? (nav.transferSize / (1024 * 1024)).toFixed(2) : 'n/a';
        console.log('[timing] client load event:', Math.round(performance.now()), 'ms', '| transfer ~', transferMB, 'MB');

        const resources = performance.getEntriesByType('resource') as any[];
        const heavy = resources
          .map((r) => ({ name: r.name, size: r.transferSize || 0, dur: r.duration || 0 }))
          .filter((r) => r.size > 200 * 1024 || r.dur > 500) // >200KB or >500ms
          .sort((a, b) => (b.size || 0) - (a.size || 0))
          .slice(0, 10);
        if (heavy.length) {
          console.log('[timing] client heavy resources (top 10):');
          for (const r of heavy) {
            console.log('  ', r.name, '|', (r.size / (1024 * 1024)).toFixed(2), 'MB', '|', Math.round(r.dur), 'ms');
          }
        }
      });
    }
  </script>

  <svelte:head>
    {#if PUBLIC_GA_ID}
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${PUBLIC_GA_ID}`}></script>
    {/if}
  </svelte:head>
  
  <slot />
  
  <style lang="css">
  </style>