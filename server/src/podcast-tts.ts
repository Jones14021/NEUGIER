import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GoogleAuth, JWT } from 'google-auth-library';

const STYLE = 'Zwei Hosts sprechen auf Deutsch natürlich, neugierig und lebendig miteinander. Sam klingt begeistert, Alex ruhig und kenntnisreich. Variiere Tempo und Betonung passend zum Inhalt, sprich Ortsnamen sorgfältig und nutze Lachen und Pausen sparsam.';

export function googlePodcastAuth(env: NodeJS.ProcessEnv = process.env): GoogleAuth {
  const email = env.GOOGLE_TTS_CLIENT_EMAIL?.trim();
  const privateKey = env.GOOGLE_TTS_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  if (!!email !== !!privateKey) throw new Error('GOOGLE_TTS_CLIENT_EMAIL und GOOGLE_TTS_PRIVATE_KEY müssen beide gesetzt sein.');
  if (email && !env.GOOGLE_CLOUD_PROJECT?.trim()) throw new Error('GOOGLE_CLOUD_PROJECT muss für die TTS-Dienstkonto-Anmeldung gesetzt sein.');
  return new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    ...(env.GOOGLE_CLOUD_PROJECT?.trim() ? { projectId: env.GOOGLE_CLOUD_PROJECT.trim() } : {}),
    ...(email && privateKey ? { authClient: new JWT({ email, key: privateKey, scopes: ['https://www.googleapis.com/auth/cloud-platform'] }) } : {}),
  });
}

export function splitDialogue(dialogue: string, singleSpeaker: boolean): { text: string; speaker?: 'Sam' | 'Alex' }[] {
  const chunks: { text: string; speaker?: 'Sam' | 'Alex' }[] = [];
  for (const line of dialogue.split('\n')) {
    const match = /^(Sam|Alex):\s*(.+)$/.exec(line);
    if (!match) throw new Error('Ungültiger Sprecher im Podcast-Skript.');
    const speaker = match[1] as 'Sam' | 'Alex';
    for (const sentence of match[2].split(/(?<=[.!?])\s+/u)) {
      const content = sentence.trim();
      if (!content) continue;
      const text = singleSpeaker ? content : `${speaker}: ${content}`;
      if (Buffer.byteLength(text, 'utf8') > 3800) throw new Error('Ein Satz im Podcast-Skript ist zu lang.');
      const previous = chunks.at(-1);
      if (previous && (!singleSpeaker || previous.speaker === speaker) && Buffer.byteLength(`${previous.text}\n${text}`, 'utf8') <= 3800) previous.text += `\n${text}`;
      else chunks.push({ text, ...(singleSpeaker ? { speaker } : {}) });
    }
  }
  if (!chunks.length) throw new Error('Das Podcast-Skript ist leer.');
  return chunks;
}

function agentParts(text: string) {
  return text.split('\n').map((line) => {
    const match = /^(Sam|Alex):\s*(.+)$/.exec(line);
    if (!match) throw new Error('Ungültiger Sprecher im Podcast-Skript.');
    const whisper = /\[whispering\]/i.test(match[2]);
    const spoken = match[2].replace(/\[laughing\]/gi, '<laugh>').replace(/\[sigh\]/gi, '<sigh>')
      .replace(/\[short pause\]/gi, '<short pause>').replace(/\[uhm\]/gi, 'ähm').replace(/\[whispering\]/gi, '');
    return { text: spoken.trim(), speechMetadata: { speaker: match[1], style: whisper ? 'whispering' : 'natural, warm and conversational' } };
  });
}

async function audioRequest(url: string, token: string, project: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': project, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error(`Google TTS (${response.status}): ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

async function encodeAudio(parts: Buffer[], inputFormat: 'wav' | 'mp3'): Promise<Buffer> {
  if (parts.length === 1 && inputFormat === 'mp3') return parts[0];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'neugier-podcast-'));
  try {
    parts.forEach((part, index) => fs.writeFileSync(path.join(directory, `${index}.${inputFormat}`), part, { mode: 0o600 }));
    fs.writeFileSync(path.join(directory, 'files.txt'), parts.map((_part, index) => `file '${index}.${inputFormat}'`).join('\n'), { mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const args = ['-nostdin', '-v', 'error', '-f', 'concat', '-safe', '1', '-i', path.join(directory, 'files.txt')];
      args.push(...(inputFormat === 'wav' ? ['-codec:a', 'libmp3lame', '-b:a', '64k'] : ['-c', 'copy']), path.join(directory, 'result.mp3'));
      const process = spawn('ffmpeg', args);
      let stderr = '';
      process.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      process.on('error', reject);
      process.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Audio-Zusammenführung fehlgeschlagen: ${stderr.slice(0, 300)}`)));
    });
    return fs.readFileSync(path.join(directory, 'result.mp3'));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

export async function synthesizePodcast(dialogue: string, model: string, credentials?: { project: string; token: string }): Promise<Buffer> {
  const agent = /^gemini-3\.8-/i.test(model);
  const singleSpeaker = model === 'gemini-2.5-flash-lite-preview-tts';
  const chunks = splitDialogue(dialogue, singleSpeaker);
  const auth = googlePodcastAuth();
  const project = credentials?.project || process.env.GOOGLE_CLOUD_PROJECT || await auth.getProjectId();
  const token = credentials?.token || await auth.getAccessToken();
  if (!token || !project) throw new Error('Google Cloud Zugangsdaten oder Projekt-ID für TTS fehlen.');
  const location = process.env.GOOGLE_TTS_AGENT_LOCATION || 'global';
  if (agent && !['global', 'us', 'eu'].includes(location)) throw new Error('GOOGLE_TTS_AGENT_LOCATION muss global, us oder eu sein.');
  const audio: Buffer[] = [];
  for (const chunk of chunks) {
    if (agent) {
      const host = location === 'global' ? 'aiplatform.googleapis.com' : `aiplatform.${location}.rep.googleapis.com`;
      const url = `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${location}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
      const body = { contents: [{ role: 'user', parts: agentParts(chunk.text) }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { multiSpeakerVoiceConfig: { speakerVoiceConfigs: [{ speaker: 'Sam', voiceConfig: { voice: 'Kore' } }, { speaker: 'Alex', voiceConfig: { voice: 'Charon' } }] } } } };
      const result = await audioRequest(url, token, project, body) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
      const inline = result.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
      if (!inline?.data) throw new Error('Agent Platform hat kein Audio zurückgegeben.');
      const wav = Buffer.from(inline.data, 'base64');
      if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Agent Platform hat kein gültiges WAV-Audio zurückgegeben.');
      audio.push(wav);
    } else {
      const voice = singleSpeaker
        ? { languageCode: 'de-DE', modelName: model, name: chunk.speaker === 'Sam' ? 'Kore' : 'Charon' }
        : { languageCode: 'de-DE', modelName: model, multiSpeakerVoiceConfig: { speakerVoiceConfigs: [{ speakerAlias: 'Sam', speakerId: 'Kore' }, { speakerAlias: 'Alex', speakerId: 'Charon' }] } };
      const result = await audioRequest('https://texttospeech.googleapis.com/v1/text:synthesize', token, project, { input: { prompt: STYLE, text: chunk.text }, voice, audioConfig: { audioEncoding: 'MP3' } }) as { audioContent?: string };
      if (!result.audioContent) throw new Error('Google TTS hat kein Audio zurückgegeben.');
      audio.push(Buffer.from(result.audioContent, 'base64'));
    }
  }
  return encodeAudio(audio, agent ? 'wav' : 'mp3');
}