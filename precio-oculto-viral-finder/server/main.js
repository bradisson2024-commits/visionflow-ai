// EL PRECIO OCULTO VIRAL FINDER — punto de entrada.
import { openDb } from './db/index.js';
import { startWorker } from './core/jobs.js';
import './modules/production.js';
import { createServer } from './app.js';

const port = Number(process.env.PORT || 5730);
openDb();
startWorker();
createServer().listen(port, '127.0.0.1', () => {
  console.log(`\n  EL PRECIO OCULTO VIRAL FINDER\n  → http://localhost:${port}\n`);
});
