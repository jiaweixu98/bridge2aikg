<script lang="ts">
  import { onMount } from 'svelte';
  import Atlas from 'src/components/Atlas.svelte';
  import type { PageData } from './$types';

  export let data: PageData;
  
  console.log('[DEBUG] +page.svelte - Component script loaded');
  console.log('[DEBUG] +page.svelte - Data prop received:', data);

  let loading = true;
  let loadingProgress = 0;
  let embedding: any = null;
  let neighbors: any = null;
  let collaboratorsdict: any = {}; // Empty initially, loaded on-demand
  let error: string | null = null;

  const fetchFullGraph = async (onProgress: (progress: number) => void) => {
    const url = '/api/data?page=0&limit=999999';
    const r = await fetch(url);
    if (!r.ok) {
      const t = await r.text();
      console.error('[ERROR] +page.svelte - Page fetch failed:', r.status, r.statusText, t);
      throw new Error(`Full graph fetch failed: ${r.status} ${r.statusText}`);
    }

    if (!r.body) {
      return r.json();
    }

    const contentLengthHeader = r.headers.get('content-length');
    const approxBytesHeader = r.headers.get('x-approx-bytes');
    const totalBytesFromContentLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    const totalBytesFromApprox = approxBytesHeader ? Number(approxBytesHeader) : NaN;
    const totalBytes = Number.isFinite(totalBytesFromContentLength) && totalBytesFromContentLength > 0
      ? totalBytesFromContentLength
      : (Number.isFinite(totalBytesFromApprox) && totalBytesFromApprox > 0 ? totalBytesFromApprox : NaN);

    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let receivedBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      receivedBytes += value.length;
      if (Number.isFinite(totalBytes) && totalBytes > 0) {
        onProgress(Math.min(99, Math.floor((receivedBytes / totalBytes) * 100)));
      }
    }

    const merged = new Uint8Array(receivedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    const decoded = new TextDecoder().decode(merged);
    return JSON.parse(decoded);
  };

  onMount(async () => {
    try {
      console.log('[DEBUG] +page.svelte - Starting onMount');
      console.log('[DEBUG] +page.svelte - Data object:', data);
      console.log('[DEBUG] +page.svelte - EmbeddingName from data:', data?.embeddingName);
      console.time('[timing] client fetch data');
      
      loadingProgress = 0;

      // Load full graph in one request for a consistent first render.
      const fullGraph = await fetchFullGraph((progress) => {
        loadingProgress = progress;
      });
      embedding = Array.isArray(fullGraph.embedding) ? fullGraph.embedding : [];
      neighbors = Array.isArray(fullGraph.neighbors) ? fullGraph.neighbors : [];
      // Collaborators are loaded on-demand per author.
      
      loadingProgress = 100;
      loading = false;
      
      console.timeEnd('[timing] client fetch data');
      console.log('[timing] client loaded:', {
        embeddingItems: embedding.length,
        neighborsItems: neighbors.length
      });
      console.log('[timing] Collaborators will be loaded on-demand when authors are selected');
    } catch (e) {
      console.error('[ERROR] +page.svelte - Failed to load data:', e);
      console.error('[ERROR] +page.svelte - Error type:', typeof e);
      console.error('[ERROR] +page.svelte - Error name:', e instanceof Error ? e.name : 'Unknown');
      console.error('[ERROR] +page.svelte - Error message:', e instanceof Error ? e.message : 'Unknown error');
      console.error('[ERROR] +page.svelte - Error stack:', e instanceof Error ? e.stack : 'No stack trace');
      
      // Check if it's an AbortError
      if (e instanceof Error && e.name === 'AbortError') {
        console.error('[ERROR] +page.svelte - Request was aborted (timeout)');
        error = 'Request timeout - the data is too large to load. Please try with a smaller dataset.';
      } else {
        error = e instanceof Error ? e.message : 'Unknown error';
      }
      
      loading = false;
    }
  });
</script>

{#if loading}
  <div class="loading-container">
    <div class="loading-content">
      <div class="spinner"></div>
      <h2>Loading Knowledge Graph Visualization</h2>
      <div class="progress-bar">
        <div class="progress-fill" style="width: {loadingProgress}%"></div>
      </div>
      <p class="progress-text">{Math.round(loadingProgress)}%</p>
      <p class="status-text">{
        loadingProgress < 5 ? 'Connecting to server...' :
        loadingProgress < 90 ? 'Downloading full graph data...' :
        'Almost ready...'
      }</p>
    </div>
  </div>
{:else if error}
  <div class="error-container">
    <h2>Error Loading Data</h2>
    <p>{error}</p>
    <button on:click={() => window.location.reload()}>Retry</button>
  </div>
{:else if embedding && neighbors && collaboratorsdict}
  <Atlas 
    {embedding} 
    embeddingName={data.embeddingName} 
    embeddingNeighbors={neighbors} 
    {collaboratorsdict} 
  />
{/if}

<style>
  .loading-container, .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
  }

  .loading-content {
    text-align: center;
    padding: 2rem;
    max-width: 500px;
    width: 100%;
  }

  .error-container {
    text-align: center;
    padding: 2rem;
    max-width: 500px;
  }

  .spinner {
    width: 60px;
    height: 60px;
    margin: 0 auto 2rem;
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  h2 {
    font-size: 1.75rem;
    margin-bottom: 2rem;
    font-weight: 600;
    line-height: 1.3;
  }

  .progress-bar {
    width: 100%;
    height: 12px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    overflow: hidden;
    margin: 1.5rem 0 0.5rem;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
  }

  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(255, 255, 255, 0.9), white);
    transition: width 0.1s ease-out;
    border-radius: 6px;
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
  }

  .progress-text {
    font-size: 1.5rem;
    font-weight: 700;
    margin: 0.75rem 0 0.25rem;
    opacity: 1;
  }

  .status-text {
    font-size: 1rem;
    opacity: 0.9;
    margin: 0.5rem 0;
    font-weight: 500;
  }

  .optimization-note {
    font-size: 0.875rem;
    opacity: 0.8;
    margin-top: 1rem;
    font-style: italic;
  }

  button {
    margin-top: 1.5rem;
    padding: 0.75rem 2rem;
    font-size: 1rem;
    background: white;
    color: #667eea;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
    transition: all 0.2s;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  button:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }

  button:active {
    transform: translateY(0);
  }

</style>
