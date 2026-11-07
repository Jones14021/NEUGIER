import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { api } from './api';
import { config, uploadsDir } from './config';
import { attachRealtime } from './realtime';
import { seedIfEmpty } from './seed';

seedIfEmpty();

const app = express();
app.use('/api', api());
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }));

if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  // SPA-Fallback
  app.get(/^\/(?!api|uploads|ws).*/, (_req, res) => res.sendFile(path.join(config.webDist, 'index.html')));
}

const server = http.createServer(app);
attachRealtime(server);
server.listen(config.port, () => {
  console.log(`NEUGIER läuft auf http://localhost:${config.port}`);
  if (config.devLogin) console.log('Dev-Login aktiv (kein GOOGLE_CLIENT_ID gesetzt oder DEV_LOGIN=true)');
});
