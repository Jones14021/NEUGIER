import fs from 'node:fs';
import path from 'node:path';
import { CopilotClient, type CopilotSession } from '@github/copilot-sdk';
import { config } from './config';

async function createClient(token: string): Promise<CopilotClient> {
  const home = path.join(config.dataDir, 'copilot');
  fs.mkdirSync(home, { recursive: true });
  const client = new CopilotClient({
    mode: 'empty',
    gitHubToken: token,
    useLoggedInUser: false,
    baseDirectory: home,
    workingDirectory: home,
    logLevel: 'error',
  });
  try {
    await client.start();
  } catch (error) {
    await client.stop().catch(() => {});
    throw error;
  }
  return client;
}

export interface CopilotAnswer {
  content: string;
  sources: { title: string; url: string }[];
}

/**
 * Eine Anfrage über das GitHub Copilot SDK (nutzt das Copilot-Abo).
 * Websuche: eingebaute Tools `web_search` + `web_fetch`; sonst keine Tools (kein Dateisystem, keine Shell).
 */
export async function askCopilot(opts: {
  token: string;
  model: string;
  system: string;
  prompt: string;
  webSearch: boolean;
}): Promise<CopilotAnswer> {
  const c = await createClient(opts.token);
  let session: CopilotSession | null = null;
  try {
    session = await c.createSession({
      // In mode "empty" braucht jede Session ihre eigene Identität
      gitHubToken: opts.token,
      model: opts.model || 'auto',
      systemMessage: { mode: 'append', content: opts.system },
      availableTools: opts.webSearch ? ['builtin:web_search', 'builtin:web_fetch'] : [],
      enableCitations: true,
      infiniteSessions: { enabled: false },
      // Nur Web-Zugriffe erlauben, alles andere ablehnen
      onPermissionRequest: (req) => (req.kind === 'url' ? { kind: 'approve-once' } : { kind: 'reject', feedback: 'Nicht erlaubt' }),
    });
    const msg = await session.sendAndWait({ prompt: opts.prompt }, 180_000);
    const data = msg?.data;
    const sources = (data?.citations?.sources ?? [])
      .filter((s) => s.url)
      .map((s) => ({ title: s.title ?? s.url!, url: s.url! }));
    return { content: data?.content ?? '', sources };
  } finally {
    if (session) {
      const id = session.sessionId;
      await session.disconnect().catch(() => {});
      await c.deleteSession(id).catch(() => {});
    }
    await c.stop().catch(() => {});
  }
}
