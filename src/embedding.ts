import * as fs from 'fs';
import path from 'path';
import { DATA_DIR, DATA_HTTP_BASE, buildDataUrl } from './conf';
import { Readable } from 'stream';
import { ReadableStream as WebReadableStream } from 'stream/web';
import type { Embedding } from './routes/embedding/+server';
import { EmbeddingName } from './types';
import { AnimeMediaType } from './malAPI';

interface RawEmbedding {
  points: { [index: string]: { x: number; y: number } };
  neighbors: { neighbors: { [index: string]: number[] } };
  ids: number[];
}
//  id	FullName	BeginYear	PaperNum
export interface Metadatum {
  id: number;
  FullName: string;
  BeginYear: number;
  RecentYear?: number;
  PaperNum: number;
  IsAuthor: boolean;
  color_category: number;
  Affiliation: string;
  Data_Source: string;
  Data_Description: string;
  Data_url: string;
  Representative_papers: string;
  // average_rating: number;
  // aired_from_year: number;
  // media_type: AnimeMediaType;
}

// Global cache with TTL support
const CachedRawEmbeddings: Map<EmbeddingName, { data: RawEmbedding; timestamp: number }> = new Map();
const CachedEmbeddings: Map<EmbeddingName, { data: Embedding; timestamp: number }> = new Map();
const CachedNeighbors: Map<EmbeddingName, { data: number[][]; timestamp: number }> = new Map();
let CachedMetadata: { data: Map<number, Metadatum>; timestamp: number } | null = null;

// Cache TTL: disable in dev so layout file switches are visible immediately.
const CACHE_TTL = process.env.NODE_ENV === 'development' ? 0 : 60 * 60 * 1000;

const isCacheValid = (timestamp: number): boolean => {
  return Date.now() - timestamp < CACHE_TTL;
};


type CollaboratorDict = Record<number, number[]>;
let CachedCollaborators: CollaboratorDict | null = null;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const resolvePathBase = (): string => {
  const base = DATA_HTTP_BASE.replace(/\/$/, '');
  if (/^https?:\/\//i.test(base)) return base;
  return base.startsWith('/') ? base : `/${base}`;
};

const toNum = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const toText = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const lowered = s.toLowerCase();
  if (lowered === 'nan' || lowered === 'none' || lowered === 'null') return '';
  return s;
};

const toBool = (v: unknown, fallback = true): boolean => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '1' || s === 'true' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'no') return false;
  return fallback;
};

const normalizeMetadatum = (row: any): Metadatum | null => {
  const id = toNum(row?.id, NaN);
  if (!Number.isFinite(id)) return null;

  if (row?.Affiliation === undefined || row?.is_author === undefined) {
    throw new Error(`Invalid canonical metadata row for id=${row?.id ?? 'unknown'}: missing Affiliation/is_author`);
  }

  return {
    id,
    FullName: toText(row?.FullName) || 'Unknown',
    BeginYear: toNum(row?.BeginYear, 0),
    RecentYear: toNum(row?.RecentYear, 0),
    PaperNum: toNum(row?.PaperNum, 0),
    IsAuthor: toBool(row?.is_author, true),
    color_category: toNum(row?.color_category, 0),
    Affiliation: toText(row?.Affiliation),
    Data_Source: toText(row?.Data_Source),
    Data_Description: toText(row?.Data_Description),
    Data_url: toText(row?.Data_url),
    Representative_papers: toText(row?.pmids_string),
  };
};

const readTextFromFsOrHttp = async (relativeFilename: string, fetchFn?: FetchLike): Promise<string> => {
  const filePath = path.resolve(DATA_DIR, relativeFilename);
  try {
    return await fs.promises.readFile(filePath, 'utf8');
  } catch (err) {
    const url = fetchFn ? `${resolvePathBase()}/${relativeFilename}` : buildDataUrl(relativeFilename);
    console.warn(`[WARN] readTextFromFsOrHttp - FS read failed for ${filePath}. Falling back to ${fetchFn ? 'internal' : 'absolute'} HTTP: ${url}`);
    const res = await (fetchFn ? fetchFn(url) : fetch(url));
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    }
    return await res.text();
  }
};

const readJsonFromFsOrHttp = async <T>(relativeFilename: string, fetchFn?: FetchLike): Promise<T> => {
  const text = await readTextFromFsOrHttp(relativeFilename, fetchFn);
  return JSON.parse(text) as T;
};

export const loadCollaborators = async (fetchFn?: FetchLike): Promise<CollaboratorDict> => {
  // Return cached version if already loaded
  if (CachedCollaborators) {
    console.log('[timing] loadCollaborators: returning cached data');
    return CachedCollaborators;
  }

  console.time('[timing] loadCollaborators total');
  const localFilePath = path.resolve(DATA_DIR, 'author_collab_dataset.json');
  const httpAbsoluteUrl = buildDataUrl('author_collab_dataset.json');
  const httpRelativeUrl = `${resolvePathBase()}/author_collab_dataset.json`;
  
  const createReader = async () => {
    try {
      return fs.createReadStream(localFilePath, { encoding: 'utf8', highWaterMark: 512 * 1024 });
    } catch {
      const res = await (fetchFn ? fetchFn(httpRelativeUrl) : fetch(httpAbsoluteUrl));
      if (!res.ok || !res.body) throw new Error(`Failed to fetch ${(fetchFn ? httpRelativeUrl : httpAbsoluteUrl)}: ${res.status} ${res.statusText}`);
      // Convert web ReadableStream to Node readable
      return Readable.fromWeb(res.body as WebReadableStream);
    }
  };
  
  return new Promise(async (resolve, reject) => {
    const readStream = await createReader();
    
    let buffer = '';
    let started = false;
    let done = false;
    const collaboratorsDict: CollaboratorDict = {};
    let entriesProcessed = 0;
    const startTime = Date.now();
    let lastReportTime = startTime;
    
    const isWhitespace = (ch: string) => ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
    
    const processBuffer = () => {
      if (done) return;
      
      // Find the opening '{'
      if (!started) {
        const objStart = buffer.indexOf('{');
        if (objStart === -1) {
          if (buffer.length > 100000) buffer = buffer.slice(-100000);
          return;
        }
        buffer = buffer.slice(objStart + 1);
        started = true;
      }
      
      // Parse entries: "key": [array], ...
      while (true) {
        // Skip whitespace and commas
        let i = 0;
        while (i < buffer.length && (isWhitespace(buffer[i]) || buffer[i] === ',')) i++;
        buffer = buffer.slice(i);
        
        if (buffer.length === 0) return;
        
        // Check for end of object
        if (buffer[0] === '}') {
          done = true;
          return;
        }
        
        // Find the key (quoted string)
        if (buffer[0] !== '"') return;
        
        let keyEnd = -1;
        for (let j = 1; j < buffer.length; j++) {
          if (buffer[j] === '"' && buffer[j - 1] !== '\\') {
            keyEnd = j;
            break;
          }
        }
        if (keyEnd === -1) return;
        
        const key = buffer.slice(1, keyEnd);
        
        // Find the colon
        let colonPos = keyEnd + 1;
        while (colonPos < buffer.length && isWhitespace(buffer[colonPos])) colonPos++;
        if (colonPos >= buffer.length || buffer[colonPos] !== ':') return;
        colonPos++;
        while (colonPos < buffer.length && isWhitespace(buffer[colonPos])) colonPos++;
        if (colonPos >= buffer.length) return;
        
        // Find the array
        if (buffer[colonPos] !== '[') return;
        
        let arrEnd = -1;
        for (let j = colonPos; j < buffer.length; j++) {
          if (buffer[j] === ']') {
            arrEnd = j;
            break;
          }
        }
        if (arrEnd === -1) return;
        
        // Parse the array
        try {
          const arrayText = buffer.slice(colonPos, arrEnd + 1);
          const arrayValue = JSON.parse(arrayText) as number[];
          const numKey = +key;
          if (!Number.isNaN(numKey)) {
            collaboratorsDict[numKey] = arrayValue;
            entriesProcessed++;
            
            // Progress logging every 2 seconds
            const now = Date.now();
            if (now - lastReportTime > 2000) {
              const elapsed = (now - startTime) / 1000;
              console.log(`[timing] loadCollaborators: processed ${entriesProcessed} entries in ${elapsed.toFixed(1)}s`);
              lastReportTime = now;
            }
          }
        } catch (e) {
          // If JSON.parse fails, we need more data
          return;
        }
        
        // Move past this entry
        buffer = buffer.slice(arrEnd + 1);
      }
    };
    
    readStream.on('data', (chunk: string) => {
      buffer += chunk;
      // Process buffer every 512KB to avoid excessive memory
      if (buffer.length > 1024 * 1024) {
        processBuffer();
      }
    });
    
    readStream.on('end', () => {
      try {
        processBuffer();
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`[timing] loadCollaborators: parsed ${entriesProcessed} entries`);
        console.timeEnd('[timing] loadCollaborators total');
        CachedCollaborators = collaboratorsDict;
        resolve(collaboratorsDict);
      } catch (e) {
        reject(e);
      }
    });
    
    readStream.on('error', (err) => {
      reject(err);
    });
  });
};


// Canonical metadata only.
const METADATA_JSON_FILE_NAME = path.resolve(DATA_DIR, 'author_metadata.json');

// id: number;ver
// FullName: string;
// BeginYear: number;
// PaperNum: number;
// IsAuthor: boolean;
export const loadMetadata = async (fetchFn?: FetchLike) => {
  console.log('[DEBUG] loadMetadata - Starting');
  // Return cached metadata if already loaded and valid
  if (CachedMetadata && isCacheValid(CachedMetadata.timestamp)) {
    console.log('[DEBUG] loadMetadata: returning cached data');
    return { metadataById: CachedMetadata.data };
  }

  console.log(`[DEBUG] loadMetadata - Reading canonical metadata JSON first: ${METADATA_JSON_FILE_NAME}`);
  console.time('[timing] loadMetadata total');
  const metadataById = new Map<number, Metadatum>();
  const jsonHttpAbsoluteUrl = buildDataUrl('author_metadata.json');
  const jsonHttpRelativeUrl = `${resolvePathBase()}/author_metadata.json`;

  const setCacheAndReturn = () => {
    console.timeEnd('[timing] loadMetadata total');
    CachedMetadata = { data: metadataById, timestamp: Date.now() };
    return { metadataById };
  };

  let rows: any[] = [];
  if (fs.existsSync(METADATA_JSON_FILE_NAME)) {
    const text = await fs.promises.readFile(METADATA_JSON_FILE_NAME, 'utf8');
    rows = JSON.parse(text);
  } else {
    const url = fetchFn ? jsonHttpRelativeUrl : jsonHttpAbsoluteUrl;
    const res = await (fetchFn ? fetchFn(url) : fetch(url));
    if (!res.ok) throw new Error(`Failed to fetch metadata JSON ${url}: ${res.status} ${res.statusText}`);
    rows = JSON.parse(await res.text());
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('Canonical metadata JSON is empty or invalid');
  }
  for (const row of rows) {
    const metadatum = normalizeMetadatum(row);
    if (!metadatum) continue;
    metadataById.set(metadatum.id, metadatum);
  }
  if (metadataById.size === 0) {
    throw new Error('Canonical metadata JSON contains no valid rows');
  }
  return setCacheAndReturn();
};

const AllValidEmbeddingNames = new Set<EmbeddingName>([
  EmbeddingName.TEST11,
  EmbeddingName.TKG,
  EmbeddingName.TKG_DATA,
  EmbeddingName.TKG_DATA_SET_BIOENTITY,
]);

export const validateEmbeddingName = (name: string | null | undefined): EmbeddingName | null =>
  AllValidEmbeddingNames.has(name as EmbeddingName) ? (name as EmbeddingName) : null;

const getEmbeddingFilename = (embeddingName: EmbeddingName): string => {
  return embeddingName === EmbeddingName.TKG_DATA_SET_BIOENTITY
    ? 'tkg_ebd_89k_dataset_bioentity.json'
    : 'tkg_ebd_89k_dataset.json';
};

const loadRawEmbedding = async (embeddingName: EmbeddingName, fetchFn?: FetchLike): Promise<RawEmbedding> => {
  console.log(`[DEBUG] loadRawEmbedding - Starting for ${embeddingName}`);
  console.time(`[timing] loadRawEmbedding total (${embeddingName})`);
  const cached = CachedRawEmbeddings.get(embeddingName);
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`[DEBUG] loadRawEmbedding - Returning cached data for ${embeddingName}`);
    console.timeEnd(`[timing] loadRawEmbedding total (${embeddingName})`);
    return cached.data;
  }

  // function listDirectoryContents(dir: string): void {
  //   const items = fs.readdirSync(dir);

  //   items.forEach(item => {
  //     const fullPath = path.join(dir, item);
  //     const stats = fs.statSync(fullPath);

  //     if (stats.isDirectory()) {
  //       console.log(`Directory: ${fullPath}`);
  //       listDirectoryContents(fullPath);
  //     } else {
  //       console.log(`File: ${fullPath}`);
  //     }
  //   });
  // }
  // console.log('\nDirectory structure:');
  // listDirectoryContents(process.cwd());
  // console.log('Current directory:', process.cwd());
  // console.log('File path:', path.resolve('work/data/tkg_ebd_34k.json'));

  const embeddingFilename = getEmbeddingFilename(embeddingName);
  const fsPath = path.resolve(DATA_DIR, embeddingFilename);
  const httpAbsoluteUrl = buildDataUrl(embeddingFilename);
  const httpRelativeUrl = `${resolvePathBase()}/${embeddingFilename}`;
  console.log(`[DEBUG] loadRawEmbedding - Reading file: ${fsPath} (http fallback: ${fetchFn ? httpRelativeUrl : httpAbsoluteUrl})`);
  console.log(`[DEBUG] loadRawEmbedding - DATA_DIR: ${DATA_DIR}`);
  try {
    const data = await fs.promises.readFile(fsPath, 'utf8');
    console.time('[timing] loadRawEmbedding parse JSON');
    const embedding = JSON.parse(data) as RawEmbedding;
    console.timeEnd('[timing] loadRawEmbedding parse JSON');
    const entries = Object.entries(embedding.points);
    if (embedding.ids.length !== entries.length) {
      throw new Error(`Have ${entries.length} embedding entries, but ${embedding.ids.length} ids`);
    }
    CachedRawEmbeddings.set(embeddingName, { data: embedding, timestamp: Date.now() });
    console.timeEnd(`[timing] loadRawEmbedding total (${embeddingName})`);
    return embedding;
  } catch (err) {
    const url = fetchFn ? httpRelativeUrl : httpAbsoluteUrl;
    console.warn(`[WARN] loadRawEmbedding - FS read failed for ${fsPath}. Falling back to HTTP: ${url}`);
    const res = await (fetchFn ? fetchFn(url) : fetch(url));
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
    const text = await res.text();
    console.time('[timing] loadRawEmbedding parse JSON');
    const embedding = JSON.parse(text) as RawEmbedding;
    console.timeEnd('[timing] loadRawEmbedding parse JSON');
    const entries = Object.entries(embedding.points);
    if (embedding.ids.length !== entries.length) {
      throw new Error(`Have ${entries.length} embedding entries, but ${embedding.ids.length} ids`);
    }
    CachedRawEmbeddings.set(embeddingName, { data: embedding, timestamp: Date.now() });
    console.timeEnd(`[timing] loadRawEmbedding total (${embeddingName})`);
    return embedding;
  }
};

export const loadEmbedding = async (embeddingName: EmbeddingName, fetchFn?: FetchLike): Promise<Embedding> => {
  console.log(`[DEBUG] loadEmbedding - Starting for ${embeddingName}`);
  console.time(`[timing] loadEmbedding total (${embeddingName})`);
  const cached = CachedEmbeddings.get(embeddingName);
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`[DEBUG] loadEmbedding - Returning cached data for ${embeddingName}`);
    console.timeEnd(`[timing] loadEmbedding total (${embeddingName})`);
    return cached.data;
  }

  //const metadata = await loadMetadata();
  console.log(`[DEBUG] loadEmbedding - Loading metadata for ${embeddingName}`);
  console.time(`[timing] loadEmbedding loadMetadata (${embeddingName})`);
  const { metadataById } = await loadMetadata(fetchFn); // destruct metadataById
  console.timeEnd(`[timing] loadEmbedding loadMetadata (${embeddingName})`);
  console.log(`[DEBUG] loadEmbedding - Loaded ${metadataById.size} metadata entries`);

  console.log(`[DEBUG] loadEmbedding - Loading raw embedding for ${embeddingName}`);
  console.time(`[timing] loadEmbedding loadRaw (${embeddingName})`);
  const rawEmbedding = await loadRawEmbedding(embeddingName, fetchFn);
  console.timeEnd(`[timing] loadEmbedding loadRaw (${embeddingName})`);
  console.log(`[DEBUG] loadEmbedding - Loaded raw embedding with ${Object.keys(rawEmbedding.points).length} points`);
  const entries = Object.entries(rawEmbedding.points);

  const embedding: Embedding = [];
  console.time(`[timing] loadEmbedding build (${embeddingName})`);
  let skippedMissingMetadata = 0;
  for (const [index, point] of entries) {
    const i = +index;
    const id = +rawEmbedding.ids[i];
    const metadatum = metadataById.get(id); // ensure receive msg from metadataById
    if (!metadatum) {
      skippedMissingMetadata++;
      continue;
    }

    embedding.push({
      vector: { x: point.x * 5, y: point.y * 5 },
      metadata: metadatum,
    });
  }
  if (skippedMissingMetadata > 0) {
    console.warn(
      `[WARN] loadEmbedding - skipped ${skippedMissingMetadata} points without canonical metadata ` +
        `(embedding=${embeddingName})`
    );
  }
  console.timeEnd(`[timing] loadEmbedding build (${embeddingName})`);
  // did not work?
  console.time(`[timing] loadEmbedding sort (${embeddingName})`);
  embedding.sort((a, b) => {
    if (b.metadata.PaperNum !== a.metadata.PaperNum) {
      return b.metadata.PaperNum - a.metadata.PaperNum;
    }
    return b.metadata.id - a.metadata.id;
  });
  console.timeEnd(`[timing] loadEmbedding sort (${embeddingName})`);

  CachedEmbeddings.set(embeddingName, { data: embedding, timestamp: Date.now() });
  console.timeEnd(`[timing] loadEmbedding total (${embeddingName})`);
  return embedding;
};


export const loadNeighbors = async (embeddingName: EmbeddingName, fetchFn?: FetchLike): Promise<number[][]> => {
  console.log(`[DEBUG] loadNeighbors - Starting for ${embeddingName}`);
  console.time(`[timing] loadNeighbors total (${embeddingName})`);
  const cached = CachedNeighbors.get(embeddingName);
  if (cached && isCacheValid(cached.timestamp)) {
    console.log(`[DEBUG] loadNeighbors - Returning cached data for ${embeddingName}`);
    console.timeEnd(`[timing] loadNeighbors total (${embeddingName})`);
    return cached.data;
  }

  console.time(`[timing] loadNeighbors loadRaw (${embeddingName})`);
  const rawEmbedding = await loadRawEmbedding(embeddingName, fetchFn);
  console.timeEnd(`[timing] loadNeighbors loadRaw (${embeddingName})`);
  
  // Load metadata to get the sorted order without loading full embedding
  console.time(`[timing] loadNeighbors loadMetadata (${embeddingName})`);
  const { metadataById } = await loadMetadata(fetchFn);
  console.timeEnd(`[timing] loadNeighbors loadMetadata (${embeddingName})`);

  const idByOriginalIndex = rawEmbedding.ids;
  const originalIndexByID = new Map<number, number>();
  console.time(`[timing] loadNeighbors index mapping (${embeddingName})`);
  for (let i = 0; i < idByOriginalIndex.length; i++) {
    originalIndexByID.set(+idByOriginalIndex[i], i);
  }
  console.timeEnd(`[timing] loadNeighbors index mapping (${embeddingName})`);

  // Build a sorted list of IDs matching the embedding sort order
  console.time(`[timing] loadNeighbors sort IDs (${embeddingName})`);
  const sortedIds = Array.from(idByOriginalIndex)
    .map((id) => +id)
    .filter((id) => metadataById.has(id))
    .sort((a, b) => {
    const metaA = metadataById.get(a);
    const metaB = metadataById.get(b);
    if (!metaA || !metaB) return 0;
    if (metaB.PaperNum !== metaA.PaperNum) {
      return metaB.PaperNum - metaA.PaperNum;
    }
    return metaB.id - metaA.id;
    });
  console.timeEnd(`[timing] loadNeighbors sort IDs (${embeddingName})`);

  console.time(`[timing] loadNeighbors map neighbors (${embeddingName})`);
  const neighbors = sortedIds.map((id) => {
    const originalIndex = originalIndexByID.get(id);
    if (originalIndex === undefined) {
      console.error('Missing original index for id ' + id);
      return [];
    }
    const neighborIndices = rawEmbedding.neighbors.neighbors[originalIndex];
    if (!neighborIndices) {
      return [];
    }

    return neighborIndices
      .map((neighborIndex) => +idByOriginalIndex[neighborIndex])
      .filter((neighborId) => metadataById.has(neighborId));
  });
  console.timeEnd(`[timing] loadNeighbors map neighbors (${embeddingName})`);

  CachedNeighbors.set(embeddingName, { data: neighbors, timestamp: Date.now() });
  console.timeEnd(`[timing] loadNeighbors total (${embeddingName})`);
  return neighbors;
};