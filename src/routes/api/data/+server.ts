import { json, type RequestHandler } from '@sveltejs/kit';
import { EmbeddingName } from 'src/types';
import { loadEmbedding, loadNeighbors, loadCollaborators } from 'src/embedding';

export const GET: RequestHandler = async ({ url, setHeaders, fetch }) => {
  console.log('[DEBUG] API /api/data - Starting request');
  console.time('[timing] API /api/data - parallel load');
  
  const embeddingName = EmbeddingName.TKG;
  const page = parseInt(url.searchParams.get('page') || '0');
  const limit = parseInt(url.searchParams.get('limit') || '10000'); // Increased for Pro plan
  const debug = (url.searchParams.get('debug') || '').toLowerCase() === '1' || (url.searchParams.get('debug') || '').toLowerCase() === 'true';
  const probe = (url.searchParams.get('probe') || '').toLowerCase() === '1' || (url.searchParams.get('probe') || '').toLowerCase() === 'true';
  const probeFull = (url.searchParams.get('probe_full') || '').toLowerCase() === '1' || (url.searchParams.get('probe_full') || '').toLowerCase() === 'true';
  
  console.log('[DEBUG] API /api/data - Parameters:', { embeddingName, page, limit, debug, probe, probeFull });
  
  try {
    // Load only embedding and neighbors - collaborators loaded on-demand
    // This reduces payload from ~860 MB to ~95 MB (90% reduction!)
    console.log('[DEBUG] API /api/data - Starting parallel load of embedding and neighbors');
    const [embedding, neighbors] = await Promise.all([
      loadEmbedding(embeddingName, fetch),
      loadNeighbors(embeddingName, fetch),
    ]);
    console.log('[DEBUG] API /api/data - Successfully loaded embedding and neighbors');
    console.log('[DEBUG] API /api/data - Embedding length:', embedding.length);
    console.log('[DEBUG] API /api/data - Neighbors length:', neighbors.length);
    
    console.timeEnd('[timing] API /api/data - parallel load');
    
    // In debug mode, return only small samples and diagnostics to avoid heavy serialization
    if (debug) {
      const memUsageDbg = process.memoryUsage();
      const sampleSize = Math.min(3, embedding.length);
      const sampleEmbedding = embedding.slice(0, sampleSize);
      const sampleNeighbors = neighbors.slice(0, sampleSize);
      console.log('[DEBUG] API /api/data - Debug mode active, returning samples only');
      setHeaders({
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return json({
        debug: true,
        params: { page, limit },
        counts: { embedding: embedding.length, neighbors: neighbors.length },
        samples: { embedding: sampleEmbedding, neighbors: sampleNeighbors.map(ns => ns.slice(0, 10)) },
        memoryMB: {
          rss: Math.round(memUsageDbg.rss / 1024 / 1024),
          heapUsed: Math.round(memUsageDbg.heapUsed / 1024 / 1024),
          heapTotal: Math.round(memUsageDbg.heapTotal / 1024 / 1024),
        },
        note: 'Debug response returns only small samples to avoid large JSON serialization.'
      });
    }

    // In probe mode, test JSON serialization of parts independently and report results
    if (probe) {
      console.log('[DEBUG] API /api/data - Probe mode active, testing serialization of parts');
      let embeddingOk = false;
      let neighborsOk = false;
      let embeddingErr: { name?: string; message?: string } | null = null;
      let neighborsErr: { name?: string; message?: string } | null = null;
      try {
        // Avoid keeping the string in memory; immediately discard the result
        JSON.stringify(embedding);
        embeddingOk = true;
      } catch (e) {
        embeddingErr = { name: e instanceof Error ? e.name : undefined, message: e instanceof Error ? e.message : String(e) };
      }
      try {
        JSON.stringify(neighbors);
        neighborsOk = true;
      } catch (e) {
        neighborsErr = { name: e instanceof Error ? e.name : undefined, message: e instanceof Error ? e.message : String(e) };
      }
      const mem = process.memoryUsage();
      setHeaders({
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return json({
        probe: true,
        params: { page, limit },
        counts: { embedding: embedding.length, neighbors: neighbors.length },
        embeddingOk,
        neighborsOk,
        embeddingErr,
        neighborsErr,
        memoryMB: {
          rss: Math.round(mem.rss / 1024 / 1024),
          heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        }
      });
    }
    
    // Load all data if limit is very large (for Pro plan)
    let paginatedEmbedding, paginatedNeighbors;
    if (limit >= 999999) {
      // Load ALL data for Pro plan
      paginatedEmbedding = embedding;
      paginatedNeighbors = neighbors;
    } else {
      // Use pagination for smaller requests
      const startIndex = page * limit;
      const endIndex = startIndex + limit;
      paginatedEmbedding = embedding.slice(startIndex, endIndex);
      paginatedNeighbors = neighbors.slice(startIndex, endIndex);
    }
    
    const payloadSizes = {
      embeddingItems: paginatedEmbedding.length,
      neighborsItems: paginatedNeighbors.length,
      totalItems: embedding.length,
      page,
      limit,
      isFullLoad: limit >= 999999,
      hasMore: limit < 999999 ? (page * limit + limit) < embedding.length : false
    };
    
    // Estimation of payload size. Avoid full JSON.stringify on extremely large payloads
    // to prevent memory spikes leading to 500s ("Invalid string length").
    let approxBytes: number | null = null;
    try {
      if (limit >= 999999) {
        // Use a sample-based estimate for full data loads
        const sampleSize = Math.min(1000, paginatedEmbedding.length);
        const embeddingSample = paginatedEmbedding.slice(0, sampleSize);
        const neighborsSample = paginatedNeighbors.slice(0, sampleSize);
        const sampleBytes = JSON.stringify(embeddingSample).length + JSON.stringify(neighborsSample).length;
        const perItemBytes = sampleSize > 0 ? sampleBytes / sampleSize : 0;
        approxBytes = Math.round((perItemBytes * paginatedEmbedding.length) / (1024 * 1024));
      } else {
        // For paginated responses, measuring the exact size is affordable
        approxBytes = Math.round((JSON.stringify(paginatedEmbedding).length + JSON.stringify(paginatedNeighbors).length) / (1024 * 1024));
      }
    } catch (e) {
      console.warn('[WARN] API /api/data - Failed to estimate payload size:', e instanceof Error ? e.message : e);
    }
    const loadType = limit >= 999999 ? 'FULL DATA' : 'paginated';
    console.log('[timing] API /api/data payload:', payloadSizes, approxBytes !== null ? `~${approxBytes} MB json (${loadType}, collaborators excluded)` : `(size estimate unavailable, ${loadType}, collaborators excluded)`);
    console.log('[DEBUG] API /api/data - Paginated embedding length:', paginatedEmbedding.length);
    console.log('[DEBUG] API /api/data - Paginated neighbors length:', paginatedNeighbors.length);
    
    // Set cache headers to cache the response for better performance on subsequent loads
    const cacheControl = process.env.NODE_ENV === 'development' ? 'no-store' : 'public, max-age=3600';
    setHeaders({
      'Cache-Control': cacheControl,
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      ...(approxBytes !== null ? { 'X-Approx-Bytes': String(approxBytes * 1024 * 1024) } : {}),
    });
    
    console.log('[DEBUG] API /api/data - Creating response object');
    
    // Check memory usage before creating large response
    const memUsage = process.memoryUsage();
    console.log('[DEBUG] API /api/data - Memory usage before response:', {
      rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + 'MB'
    });
    
    // For extremely large payloads, stream the JSON to avoid building it in memory
    if (!debug && !probe && !probeFull && limit >= 999999) {
      console.log('[DEBUG] API /api/data - Using streaming JSON response for full data');
      const encoder = new TextEncoder();
      const chunkSize = 200; // keep chunks small to control memory usage
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const enqueue = (str: string) => controller.enqueue(encoder.encode(str));
          try {
            enqueue('{');
            enqueue(`"embeddingName":${JSON.stringify(embeddingName)},`);
            enqueue('"embedding":[');
            for (let i = 0; i < paginatedEmbedding.length; i += chunkSize) {
              const slice = paginatedEmbedding.slice(i, i + chunkSize);
              const chunk = slice.map((item) => JSON.stringify(item)).join(',');
              if (i > 0) enqueue(',');
              enqueue(chunk);
            }
            enqueue('],');
            enqueue('"neighbors":[');
            for (let i = 0; i < paginatedNeighbors.length; i += chunkSize) {
              const slice = paginatedNeighbors.slice(i, i + chunkSize);
              const chunk = slice.map((item) => JSON.stringify(item)).join(',');
              if (i > 0) enqueue(',');
              enqueue(chunk);
            }
            enqueue('],');
            const pagination = {
              page,
              limit,
              total: embedding.length,
              hasMore: false,
              isFullLoad: true,
            };
            enqueue('"pagination":');
            enqueue(JSON.stringify(pagination));
            enqueue('}');
            controller.close();
          } catch (e) {
            console.error('[ERROR] API /api/data - Streaming serialization failed:', e);
            controller.error(e);
          }
        }
      });
      return new Response(stream, {
        status: 200,
        headers: {
          'Cache-Control': process.env.NODE_ENV === 'development' ? 'no-store' : 'no-cache',
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET',
          ...(approxBytes !== null ? { 'X-Approx-Bytes': String(approxBytes * 1024 * 1024) } : {}),
        },
      });
    }
    
    const responseData = { 
      embedding: paginatedEmbedding, 
      embeddingName,
      neighbors: paginatedNeighbors,
      pagination: {
        page,
        limit,
        total: embedding.length,
        hasMore: limit < 999999 ? (page * limit + limit) < embedding.length : false,
        isFullLoad: limit >= 999999
      }
    };
    
    console.log('[DEBUG] API /api/data - Response object created, starting JSON serialization');
    console.time('[timing] API /api/data - JSON serialization');
    
    // Probe full-response serialization without sending huge payload
    if (probeFull) {
      let ok = false;
      let errName: string | undefined;
      let errMessage: string | undefined;
      try {
        // Attempt to build the Response (will stringify internally)
        json(responseData);
        ok = true;
      } catch (serializationError) {
        errName = serializationError instanceof Error ? serializationError.name : undefined;
        errMessage = serializationError instanceof Error ? serializationError.message : String(serializationError);
        console.error('[ERROR] API /api/data - Probe full serialization failed:', serializationError);
      } finally {
        console.timeEnd('[timing] API /api/data - JSON serialization');
      }
      setHeaders({
        'Cache-Control': 'no-cache',
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      return json({ probeFull: true, ok, error: ok ? undefined : { name: errName, message: errMessage } });
    }
    
    try {
      const jsonResponse = json(responseData);
      console.timeEnd('[timing] API /api/data - JSON serialization');
      console.log('[DEBUG] API /api/data - JSON serialization completed, returning response');
      return jsonResponse;
    } catch (serializationError) {
      console.error('[ERROR] API /api/data - JSON serialization failed:', serializationError);
      console.error('[ERROR] API /api/data - Serialization error stack:', serializationError instanceof Error ? serializationError.stack : 'No stack trace');
      throw serializationError;
    }
  } catch (error) {
    console.error('[ERROR] API /api/data failed:', error);
    console.error('[ERROR] Error type:', typeof error);
    console.error('[ERROR] Error name:', error instanceof Error ? error.name : 'Unknown');
    console.error('[ERROR] Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('[ERROR] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    const isDebug = (url.searchParams.get('debug') || '').toLowerCase() === '1' || (url.searchParams.get('debug') || '').toLowerCase() === 'true';
    return json({ 
      error: 'Failed to load data',
      message: error instanceof Error ? error.message : 'Unknown error',
      ...(isDebug ? {
        name: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      } : {})
    }, { status: 500 });
  }
};

