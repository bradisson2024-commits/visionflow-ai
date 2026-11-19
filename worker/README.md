# Worker de procesamiento

Proceso Node.js separado que consume la cola BullMQ (Redis) y ejecuta FFmpeg, transcripción e IA.
Se implementa a partir de la Fase 3. Se ejecutará con `npm run worker`.
