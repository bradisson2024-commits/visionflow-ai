// Plantillas rápidas: cambian la estructura narrativa y la planificación visual del vídeo.
export const TEMPLATES = {
  top5: { name: 'Top 5', structure: ['Gancho que promete el puesto nº 1', 'Puesto 5', 'Puesto 4', 'Puesto 3', 'Puesto 2', 'Giro antes del nº 1', 'Puesto 1', 'Cierre con pregunta al público'], tone: 'enérgico, comparativo, con cuenta atrás', visual: 'cada puesto abre con un plano de presentación del elemento y cierra con un detalle llamativo', pacing: 'rápido' },
  dato: { name: 'Dato curioso', structure: ['Pregunta sorprendente', 'Respuesta corta inesperada', 'Explicación paso a paso', 'Ejemplo concreto', 'Dato extra', 'Cierre memorable'], tone: 'curioso y cercano', visual: 'primeros planos del objeto del dato y diagramas visuales sencillos', pacing: 'rápido' },
  truecrime: { name: 'True Crime', structure: ['Escena del hecho en presente', 'Quiénes eran', 'Cronología', 'Pistas e investigación', 'Giro', 'Resolución o caso abierto', 'Reflexión final'], tone: 'sobrio, respetuoso, con suspense, sin morbo', visual: 'lugares, objetos y documentos; nada de violencia explícita', pacing: 'normal' },
  tutorial: { name: 'Tutorial', structure: ['Resultado final que se va a conseguir', 'Materiales o requisitos', 'Paso 1', 'Paso 2', 'Paso 3', 'Errores comunes', 'Resumen'], tone: 'claro, didáctico, directo', visual: 'cada paso con su acción concreta en primer plano', pacing: 'normal' },
  conspiracion: { name: 'Conspiración', structure: ['Pregunta inquietante', 'La versión oficial', 'Las dudas', 'Lo que dicen los datos', 'Lo que sigue sin explicar', 'Conclusión crítica'], tone: 'intrigante pero honesto: separa hechos comprobados de especulaciones', visual: 'archivos, mapas, siluetas y lugares en penumbra', pacing: 'normal' },
  storytelling: { name: 'Storytelling', structure: ['Personaje y su deseo', 'Mundo normal', 'Detonante', 'Obstáculos crecientes', 'Momento más bajo', 'Clímax', 'Transformación y moraleja'], tone: 'narrativo, emocional, en tercera persona', visual: 'el protagonista presente en casi todas las escenas, con continuidad de vestuario', pacing: 'normal' },
  documental: { name: 'Documental', structure: ['Apertura con imagen poderosa', 'Contexto', 'Desarrollo cronológico', 'Testimonio o dato clave', 'Consecuencias', 'Cierre reflexivo'], tone: 'informativo, pausado, con autoridad', visual: 'planos generales de lugares y detalles de época', pacing: 'lento' },
  biblica: { name: 'Historia bíblica', structure: ['Contexto histórico y lugar', 'Personajes', 'El conflicto', 'La prueba', 'La intervención decisiva', 'Desenlace', 'Enseñanza'], tone: 'solemne, respetuoso, fiel al relato', visual: 'paisajes de época, vestuario histórico y luz épica', pacing: 'lento' },
  misterio: { name: 'Misterio', structure: ['Enigma inicial', 'Primeras pistas', 'Hipótesis', 'Pista que lo cambia todo', 'Revelación', 'Pregunta abierta'], tone: 'de suspense, revelación gradual', visual: 'penumbra, objetos clave y lugares inquietantes', pacing: 'normal' },
  ciencia: { name: 'Ciencia', structure: ['Fenómeno sorprendente', 'Pregunta científica', 'Explicación con analogía', 'Experimento o evidencia', 'Implicaciones', 'Cierre asombroso'], tone: 'divulgativo, entusiasta, riguroso', visual: 'diagramas, escalas, fenómenos naturales y laboratorios', pacing: 'normal' },
};

export function templateInstructions(id) {
  const t = TEMPLATES[id];
  if (!t) return 'Estructura libre: gancho fuerte, desarrollo con revelaciones progresivas y cierre memorable.';
  return `PLANTILLA «${t.name}». Estructura obligatoria, en este orden: ${t.structure.map((s, i) => `${i + 1}) ${s}`).join('; ')}. Tono: ${t.tone}. Planificación visual: ${t.visual}.`;
}
