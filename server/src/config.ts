import path from 'node:path';

const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  dataDir: path.resolve(env.DATA_DIR || './data'),
  googleClientId: env.GOOGLE_CLIENT_ID || '',
  adminEmails: (env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  devLogin: env.DEV_LOGIN === 'true' || !env.GOOGLE_CLIENT_ID,
  mapsApiKey: env.GOOGLE_MAPS_API_KEY || '',
  mapsServerKey: env.GOOGLE_MAPS_SERVER_KEY || env.GOOGLE_MAPS_API_KEY || '',
  mapId: env.GOOGLE_MAPS_MAP_ID || 'DEMO_MAP_ID',
  llm: {
    baseUrl: env.LLM_BASE_URL || 'https://models.github.ai/inference',
    model: env.LLM_MODEL || 'openai/gpt-4.1',
    apiKey: env.LLM_API_KEY || '',
    /** off | tavily | native */
    webSearch: env.LLM_WEB_SEARCH || 'off',
  },
  tavilyApiKey: env.TAVILY_API_KEY || '',
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
