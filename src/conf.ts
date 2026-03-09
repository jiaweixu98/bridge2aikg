process.env.IS_DOCKER = 'false';
process.env.DATA_DIR = 'work/data';
process.env.MAL_CLIENT_ID = '3134d8e904ce980c0af0940a18238f24';
process.env.MAL_CLIENT_SECRET = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';
process.env.ADMIN_API_TOKEN = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';
process.env.MYSQL_HOST = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';
process.env.MYSQL_USER = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';
process.env.MYSQL_PASSWORD = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';
process.env.MYSQL_DATABASE = 'c9b0acd081a866ff6f88f2cc58801cf1dfecf347534ca9043ad18f07b1a201d0';

const loadEnv = (key: string, defaultValue?: string) => {
  const value = process.env[key];
  if (!value) {
    if (defaultValue) {
      return defaultValue;
    } else {
      throw new Error(`Missing environment variable ${key}`);
    }
  }
  return value;
};

export const IS_DOCKER = loadEnv('IS_DOCKER', 'false') === 'true';
export const DATA_DIR = loadEnv('DATA_DIR', 'work/data');

export const MAL_CLIENT_ID = loadEnv('MAL_CLIENT_ID');
export const MAL_CLIENT_SECRET = loadEnv('MAL_CLIENT_SECRET');

export const MAL_API_BASE_URL = 'https://api.myanimelist.net/v2';

export const ADMIN_API_TOKEN = loadEnv('ADMIN_API_TOKEN');

export const MYSQL_HOST = loadEnv('MYSQL_HOST');
export const MYSQL_USER = loadEnv('MYSQL_USER');
export const MYSQL_PASSWORD = loadEnv('MYSQL_PASSWORD');
export const MYSQL_DATABASE = loadEnv('MYSQL_DATABASE');

// Base URL to load data files over HTTP when filesystem paths are unavailable (e.g., on Vercel functions)
// If not provided, defaults to serving from the static assets path `/data`.
export const DATA_HTTP_BASE = process.env.PUBLIC_DATA_BASE_URL || '/data';

// Resolve site origin for server-side fetch absolute URLs (needed on Vercel)
const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined;
export const SITE_ORIGIN = process.env.PUBLIC_SITE_URL || vercelOrigin || 'http://127.0.0.1:5173';

export const buildDataUrl = (relativePath: string): string => {
  const trimmedBase = DATA_HTTP_BASE.replace(/\/$/, '');
  if (/^https?:\/\//i.test(trimmedBase)) {
    return `${trimmedBase}/${relativePath}`;
  }
  const trimmedRel = relativePath.replace(/^\//, '');
  const basePath = trimmedBase.startsWith('/') ? trimmedBase : `/${trimmedBase}`;
  return `${SITE_ORIGIN}${basePath}/${trimmedRel}`;
};
