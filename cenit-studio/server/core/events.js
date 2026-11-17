// Eventos en vivo para la interfaz (SSE), filtrados por usuario.
import { EventEmitter } from 'node:events';
export const events = new EventEmitter();
events.setMaxListeners(500);
export const emit = (ownerId, type, data = {}) => events.emit('e', { ownerId, type, ...data, at: new Date().toISOString() });
