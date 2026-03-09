import { EmbeddingName } from 'src/types';
import { typify } from 'src/components/recommendation/utils';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  console.log('[DEBUG] +page.server.ts - Starting load function');
  console.log('[timing] server load +page: returning minimal data, client will fetch datasets');
  
  try {
    console.log('[DEBUG] +page.server.ts - Getting EmbeddingName.TKG');
    const embeddingName = EmbeddingName.TKG;
    console.log('[DEBUG] +page.server.ts - EmbeddingName.TKG =', embeddingName);
    
    console.log('[DEBUG] +page.server.ts - Calling typify function');
    const result = typify({ embeddingName });
    console.log('[DEBUG] +page.server.ts - typify result =', result);
    
    console.log('[DEBUG] +page.server.ts - Returning result');
    return result;
  } catch (error) {
    console.error('[ERROR] +page.server.ts - Error in load function:', error);
    console.error('[ERROR] +page.server.ts - Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
};
