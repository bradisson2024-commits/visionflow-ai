// Proceso trabajador independiente (opcional): ejecuta la cola sin servir la web. Útil para escalar.
import { startWorker } from './core/jobs.js';
import { startScheduler } from './modules/weekly.js';
import './modules/projects.js';
import './modules/visuals.js';
import './modules/voices.js';
import './modules/render.js';
import './modules/inspired.js';
import './modules/produce.js';

await startWorker();
startScheduler();
console.log('Trabajador de Cenit Studio en marcha.');
