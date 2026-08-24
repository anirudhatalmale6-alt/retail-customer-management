import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runMigrations } from './lib/migrate.js';
import { requireAuth } from './middleware/auth.js';
import { router as authRouter } from './routes/auth.js';
import { router as customersRouter } from './routes/customers.js';
import { router as usersRouter } from './routes/users.js';
import { router as importsRouter } from './routes/imports.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'rcms-api' }));

app.use('/api/auth', authRouter);
app.use('/api/customers', requireAuth, customersRouter);
app.use('/api/users', requireAuth, usersRouter);
app.use('/api/import', requireAuth, importsRouter);

// Serve the built front end when it exists, so production is a single process.
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // Client-side routing: anything that is not an API call returns index.html.
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Central error handler. Real detail goes to the log; the client gets a message
// it can act on, never a stack trace or SQL text.
app.use((err, req, res, next) => {
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large (20 MB maximum)' });
  }
  console.error(`[api] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

const PORT = Number(process.env.PORT || 4000);

runMigrations()
  .then(() => {
    app.listen(PORT, () => console.log(`[api] listening on http://127.0.0.1:${PORT}`));
  })
  .catch((err) => {
    console.error('[api] startup failed:', err.message);
    process.exit(1);
  });
