import { json, type RequestHandler } from '@sveltejs/kit';
import { EmbeddingName } from 'src/types';
import { loadEmbedding, loadNeighbors } from 'src/embedding';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
  console.time('[timing] API /api/data/lightweight - parallel load');
  
  const embeddingName = EmbeddingName.TKG;
  const limit = parseInt(url.searchParams.get('limit') || '2000'); // Increased for Pro plan
  
  try {
    // Load only a small subset for initial rendering
    const [embedding, neighbors] = await Promise.all([
      loadEmbedding(embeddingName),
      loadNeighbors(embeddingName),
    ]);
    
    console.timeEnd('[timing] API /api/data/lightweight - parallel load');
    
    // Return a balanced sample for fast initial load
    // Since data is sorted by PaperNum descending, we need to sample from different ranges
    const totalItems = embedding.length;
    const sampleSize = Math.min(limit, totalItems);
    
    // Create a balanced sample: take some from top, middle, and bottom
    const topCount = Math.floor(sampleSize * 0.3); // 30% from top (high paper count)
    const middleCount = Math.floor(sampleSize * 0.4); // 40% from middle
    const bottomCount = sampleSize - topCount - middleCount; // 30% from bottom (low paper count)
    
    const topItems = embedding.slice(0, topCount);
    const middleStart = Math.floor(totalItems * 0.3);
    const middleItems = embedding.slice(middleStart, middleStart + middleCount);
    const bottomStart = Math.max(0, totalItems - bottomCount);
    const bottomItems = embedding.slice(bottomStart);
    
    const lightweightEmbedding = [...topItems, ...middleItems, ...bottomItems];
    const lightweightNeighbors = [
      ...neighbors.slice(0, topCount),
      ...neighbors.slice(middleStart, middleStart + middleCount),
      ...neighbors.slice(bottomStart)
    ];
    
    const payloadSizes = {
      embeddingItems: lightweightEmbedding.length,
      neighborsItems: lightweightNeighbors.length,
      totalItems: embedding.length,
      sampleSize,
      topCount,
      middleCount,
      bottomCount
    };
    
    const approxBytes =
      Math.round((JSON.stringify(lightweightEmbedding).length + JSON.stringify(lightweightNeighbors).length) / 1024);
    console.log('[timing] API /api/data/lightweight payload:', payloadSizes, `~${approxBytes} KB json (balanced sample)`);
    
    // Set cache headers
    setHeaders({
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
    });
    
    return json({ 
      embedding: lightweightEmbedding, 
      embeddingName,
      neighbors: lightweightNeighbors,
      total: embedding.length,
      loaded: limit
    });
  } catch (error) {
    console.error('[error] API /api/data/lightweight failed:', error);
    setHeaders({
      'Cache-Control': 'no-cache',
    });
    return json({ 
      error: 'Failed to load lightweight data',
      message: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
