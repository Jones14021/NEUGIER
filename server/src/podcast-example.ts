import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { synthesizePodcast } from './podcast-tts';

const models: Record<string, string> = { '3.8': 'gemini-3.8-flash-tts', '3.1': 'gemini-3.1-flash-tts-preview' };
const dialogue = `Sam: [laughing] Willkommen zu unserem kleinen Reisepodcast! Heute entdecken wir die Küste von Neuseeland.
Alex: [short pause] Stell dir vor, wir fahren am Meer entlang und halten an einem ruhigen Strand.
Sam: [uhm] Und danach gibt es hoffentlich einen guten Kaffee?
Alex: [sigh] Unbedingt. Ein schöner Ausblick und ein bisschen Zeit zum Durchatmen.`;

export async function generateExample(args: string[], synthesize = synthesizePodcast): Promise<string> {
  const variant = args[0] || '3.8';
  const model = models[variant];
  if (!model || args.length > 2) throw new Error('Aufruf: ./podcast-example.sh [3.8|3.1] [ausgabedatei.mp3]');
  const output = path.resolve(args[1] || `podcast-beispiel-${variant}.mp3`);
  if (fs.existsSync(output)) throw new Error('Die Ausgabedatei existiert bereits; bitte einen anderen Dateinamen wählen.');
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.GOOGLE_TTS_CLIENT_EMAIL || !process.env.GOOGLE_TTS_PRIVATE_KEY) {
    throw new Error('GOOGLE_CLOUD_PROJECT, GOOGLE_TTS_CLIENT_EMAIL und GOOGLE_TTS_PRIVATE_KEY in .env ausfüllen.');
  }
  const audio = await synthesize(dialogue, model);
  fs.writeFileSync(output, audio, { flag: 'wx', mode: 0o600 });
  return output;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (fs.existsSync('.env')) process.loadEnvFile('.env');
  generateExample(process.argv.slice(2)).then((output) => console.log(`Beispiel erstellt: ${output}`)).catch((error: Error) => {
    console.error(`Beispiel fehlgeschlagen: ${error.message}`);
    process.exitCode = 1;
  });
}