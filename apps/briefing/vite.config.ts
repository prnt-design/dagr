import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadArchive } from './src/archive.js';

export default defineConfig({
  plugins: [react(), {
    name: 'private-report-feed',
    async configureServer(server) {
      const configured = process.env.DAGR_REPORTS_DIR;
      if (!configured || !isAbsolute(configured)) throw new Error('Set DAGR_REPORTS_DIR to an absolute private directory outside the checkout');
      const directory = await realpath(configured);
      const checkout = await realpath(resolve('../..'));
      const inside = relative(checkout, directory);
      if (!inside.startsWith('..') && !isAbsolute(inside)) throw new Error('Reports must be outside the checkout');
      server.middlewares.use('/api/reports', async (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json');
        try {
          if (req.url !== '/' && req.url !== '') { res.statusCode = 404; res.end('{}'); return; }
          const feed = await loadArchive(directory);
          res.end(JSON.stringify(feed));
        } catch { res.statusCode = 500; res.end(JSON.stringify({ error: 'Private archive unavailable' })); }
      });
    },
  }],
});
