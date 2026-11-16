// Eventos en vivo (SSE) + registro persistente por proyecto.
import { EventEmitter } from 'node:events';
import { run } from '../db/index.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

export function note(projectId, message, level = 'info') {
  const r = run('INSERT INTO events(project_id, level, message) VALUES(?,?,?)', projectId ?? null, level, String(message));
  bus.emit('event', { type: 'log', projectId, level, message: String(message), id: Number(r.lastInsertRowid), at: new Date().toISOString() });
}

export const signal = (type, data = {}) => bus.emit('event', { type, ...data, at: new Date().toISOString() });
