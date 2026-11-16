// Módulo 13 · Paso 5: revisión automática de coherencia narración ↔ imagen.
import fs from 'node:fs';
import { visionProviderName } from './config.js';
import { generate } from './llm.js';
import { dhash, hamming } from './visuals.js';

export const PASS_SCORE = 7;

/** Revisión con IA de visión de una escena. Devuelve un veredicto con motivos. */
export async function reviewScene({ scene, imageFile, characters }) {
  const provider = visionProviderName();
  if (!provider) {
    return { state: 'revision_manual', reason: 'No hay IA con visión configurada: revisa y aprueba esta imagen a mano.', at: new Date().toISOString() };
  }
  const used = characters.filter((c) => scene.visual.characters.includes(c.id));
  const r = await generate({
    json: true, temperature: 0, images: [{ mime: 'image/png', data: fs.readFileSync(imageFile).toString('base64') }],
    system: 'Eres el revisor de calidad de un canal de videos con ilustraciones Stickman estáticas. Eres estricto y concreto.',
    prompt: `Narración que se escucha mientras aparece esta imagen:
«${scene.narration}»

Lo que la imagen debía mostrar: ${scene.visual.description}
Personajes que debían aparecer: ${used.map((c) => `${c.name} (${c.description})`).join('; ') || 'ninguno en particular'}
Estilo obligatorio: stickman dibujado a mano, 2D, estático, contornos negros, fondo crema/beige, detalles rojos y amarillos. Prohibido: fotorrealismo, 3D, texto ilegible dominante.

Evalúa y devuelve JSON:
{"describe": string (qué se ve realmente, una frase),
 "representa_narracion": boolean (¿un espectador entendería que la imagen ilustra ESTA frase?),
 "puntuacion": number (0–10),
 "estilo_correcto": boolean,
 "personajes_correctos": boolean (accesorios/colores coinciden con la descripción, o no se requerían),
 "problemas": [string],
 "correccion_sugerida_en": string (instrucción en inglés para regenerar la imagen corrigiendo los problemas; vacío si no hace falta)}`,
  });
  const d = r.data;
  const score = Number(d.puntuacion) || 0;
  const pass = !!d.representa_narracion && !!d.estilo_correcto && d.personajes_correctos !== false && score >= PASS_SCORE;
  return {
    state: pass ? 'aprobada_ia' : 'corregir',
    provider: r.provider,
    score,
    seen: d.describe,
    problems: d.problemas || [],
    fix: d.correccion_sugerida_en || '',
    flags: { narrative: !!d.representa_narracion, style: !!d.estilo_correcto, characters: d.personajes_correctos !== false },
    at: new Date().toISOString(),
  };
}

/** Imágenes casi idénticas en escenas distintas (repeticiones innecesarias). */
export async function findDuplicates(scenes, fileOf, threshold = 6) {
  const hashes = [];
  for (const s of scenes) {
    const f = fileOf(s);
    if (!fs.existsSync(f)) continue;
    hashes.push({ n: s.n, h: await dhash(f) });
  }
  const dups = [];
  for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) {
    const d = hamming(hashes[i].h, hashes[j].h);
    if (d <= threshold) dups.push({ a: hashes[i].n, b: hashes[j].n, distance: d });
  }
  return dups;
}

export const isApproved = (s) => ['aprobada_ia', 'aprobada_manual'].includes(s.review?.state);
