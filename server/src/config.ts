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
    /** copilot = GitHub Copilot SDK (Copilot-Abo), openai = beliebige OpenAI-kompatible API */
    provider: env.LLM_PROVIDER || 'copilot',
    baseUrl: env.LLM_BASE_URL || 'https://api.openai.com/v1',
    model: env.LLM_MODEL || (env.LLM_PROVIDER === 'openai' ? 'gpt-4.1' : 'auto'),
    /** Copilot: GitHub Fine-grained PAT; OpenAI-kompatibel: API-Key des Anbieters */
    apiKey: env.LLM_API_KEY || env.COPILOT_GITHUB_TOKEN || '',
    /** off | on (Copilot) bzw. off | tavily | native (OpenAI-kompatibel) */
    webSearch: env.LLM_WEB_SEARCH || (env.LLM_PROVIDER === 'openai' ? 'off' : 'on'),
  },
  tavilyApiKey: env.TAVILY_API_KEY || '',
  webDist: path.resolve(import.meta.dirname, '../../web/dist'),
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
