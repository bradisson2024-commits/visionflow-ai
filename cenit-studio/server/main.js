// Cenit Studio — servidor (API + interfaz + trabajador de la cola + planificador semanal).
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { buildApp } from './app.js';
import { startWorker } from './core/jobs.js';
import { startScheduler } from './modules/weekly.js';
import './modules/visuals.js';
import './modules/voices.js';
import './modules/render.js';
import './modules/inspired.js';

await migrate();
const app = await buildApp();
await app.listen({ port: config.port, host: process.env.HOST || '127.0.0.1' });
if (config.runWorker) { await startWorker(); startScheduler(); }
console.log(`\n  Cenit Studio → http://localhost:${config.port}\n`);
