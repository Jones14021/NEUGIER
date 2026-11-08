import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function versionedWorker(): Plugin {
  let version = '';
  let assets: string[] = [];
  let root = '';
  return {
    name: 'versioned-service-worker',
    apply: 'build',
    configResolved(config) { root = config.root; },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256');
      assets = Object.keys(bundle).filter((file) => file.startsWith('assets/') && /\.(js|css)$/.test(file)).sort();
      for (const file of Object.keys(bundle).sort()) {
        const item = bundle[file];
        hash.update(file).update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const file of ['sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png']) hash.update(fs.readFileSync(path.join(root, 'public', file)));
      version = hash.digest('hex').slice(0, 16);
    },
    writeBundle(options) {
      const worker = path.join(options.dir ?? path.join(root, 'dist'), 'sw.js');
      const content = fs.readFileSync(worker, 'utf8')
        .replaceAll('__APP_VERSION__', version)
        .replace('"__BUILD_ASSETS__"', assets.map((asset) => JSON.stringify(`/${asset}`)).join(', '));
      fs.writeFileSync(worker, content);
    },
  };
}

export default defineConfig({
  plugins: [react(), versionedWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/uploads': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
