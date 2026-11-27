// Catálogo de 38 estilos visuales.
//
// Nombres VERIFICADOS en las referencias (según la especificación del proyecto): 15.
// Las descripciones y los prompts de generación de cada estilo los ha escrito este
// proyecto (los prompts internos de la herramienta original no son visibles).
// Las 23 ranuras restantes quedan como "pendiente de verificación": no tienen nombre
// inventado y no se pueden seleccionar hasta que el usuario las complete en el
// propio Catálogo (botón «Definir estilo») tras revisar la referencia.
import { all, get, run, now, mediaUrl } from './db.js';

export const TOTAL_STYLES = 38;

const VERIFIED = [
  {
    id: 'fantasia-magica', name: 'Fantasía Mágica', motif: 'castle',
    description: 'Ilustración de fantasía luminosa, con magia, criaturas y paisajes encantados.',
    prompt: 'painterly high-fantasy digital illustration, enchanted atmosphere, glowing magical particles, rich detailed brushwork, storybook epic composition',
    palette: 'violetas profundos, turquesa, dorado cálido', paletteHex: ['#2b1b5a', '#6c3fc4', '#38c6c0', '#f4c95d'],
    lighting: 'luz mágica volumétrica, destellos y rayos de luz suaves',
    character_design: 'personajes de fantasía con proporciones ligeramente estilizadas, vestuario detallado',
    environment: 'bosques encantados, castillos, ruinas antiguas, cielos estrellados',
  },
  {
    id: 'terror', name: 'Terror', motif: 'moon',
    description: 'Atmósfera oscura y perturbadora, sombras marcadas y tensión constante.',
    prompt: 'dark horror illustration, eerie unsettling atmosphere, deep shadows, muted desaturated colors, fog, cinematic dread, high contrast',
    palette: 'negros, grises fríos, verde enfermizo, rojo apagado', paletteHex: ['#0b0d0f', '#2a3135', '#55705f', '#7a1d1d'],
    lighting: 'claroscuro extremo, luz de luna fría, contraluces inquietantes',
    character_design: 'figuras parcialmente ocultas en sombra, expresiones de miedo marcadas',
    environment: 'casas abandonadas, pasillos oscuros, bosques con niebla, sótanos',
  },
  {
    id: 'infografia', name: 'Infografía', motif: 'chart',
    description: 'Visuales explicativos tipo infografía: iconos, diagramas y composición clara.',
    prompt: 'clean flat vector infographic illustration, clear visual explanation, icons and simple diagrams, generous negative space, modern editorial design, no text',
    palette: 'azul, turquesa, amarillo y coral sobre fondo claro', paletteHex: ['#f5f7fa', '#2f6fde', '#22b8a6', '#ffb020'],
    lighting: 'plana y uniforme, sin sombras dramáticas',
    character_design: 'figuras humanas simplificadas tipo pictograma',
    environment: 'fondos limpios con elementos gráficos, mapas, gráficos y objetos simbólicos',
  },
  {
    id: '2d-stickman', name: '2D Stickman', motif: 'stickman',
    description: 'Personajes stickman expresivos en escenarios ilustrados con encuadre cinematográfico.',
    prompt: '2D stickman illustration: characters are stick figures with a simple round expressive head (clear eyes, eyebrows and mouth showing emotion), thin black line body and limbs, drawn with clean confident black outlines; placed inside a fully illustrated, detailed 2D cartoon background that explains the story; cinematic composition and camera framing; flat colors with soft shading; consistent line weight',
    palette: 'líneas negras, fondos ilustrados con colores planos cálidos y fríos según la escena', paletteHex: ['#fdfaf3', '#1b1b1b', '#e9a23b', '#4b86b4'],
    lighting: 'iluminación ilustrada acorde a la escena (día, noche, interior cálido, lluvia…)',
    character_design: 'stickman: cabeza redonda sencilla y expresiva, cuerpo y extremidades de línea simple; rasgos distintivos (peinado, prenda o accesorio de color) que se mantienen entre escenas',
    environment: 'escenarios 2D ilustrados y detallados: calles, habitaciones, oficinas, paisajes',
  },
  {
    id: '2d-personaje', name: '2D Personaje', motif: 'person',
    description: 'Ilustración 2D de personajes con rasgos completos, estilo cartoon narrativo.',
    prompt: '2D cartoon character illustration, fully drawn expressive characters with consistent design, clean outlines, cel shading, detailed illustrated backgrounds, animated series look',
    palette: 'colores vivos y saturados con fondos armónicos', paletteHex: ['#fff6e9', '#ff7a59', '#3aa0ff', '#2c3e50'],
    lighting: 'cel shading con sombras suaves, luz direccional clara',
    character_design: 'personajes 2D completos con proporciones cartoon y vestuario fijo',
    environment: 'escenarios 2D ilustrados coherentes con la historia',
  },
  {
    id: 'stickman-cinematico', name: 'Stickman Cinemático', motif: 'stickman-cine',
    description: 'Stickman con iluminación dramática, profundidad y encuadres de película.',
    prompt: 'cinematic stickman illustration, stick figure characters with simple expressive round heads, dramatic movie lighting, depth of field, atmospheric perspective, widescreen film still composition, detailed painted environments',
    palette: 'teal and orange cinematográfico, sombras profundas', paletteHex: ['#0f1c24', '#1f4e5f', '#e07b39', '#f2d0a4'],
    lighting: 'iluminación dramática de cine, contraluces, rayos volumétricos',
    character_design: 'stickman con silueta limpia y expresiones claras, rasgos de color distintivos',
    environment: 'escenarios pintados con profundidad y atmósfera',
  },
  {
    id: '3d-relajado', name: '3D Relajado', motif: 'blob3d',
    description: 'Render 3D suave y acogedor, formas redondeadas y colores pastel.',
    prompt: 'soft cozy 3D render, rounded friendly shapes, clay-like materials, pastel colors, gentle global illumination, calm relaxing mood, miniature diorama feel',
    palette: 'pasteles: melocotón, menta, lavanda, crema', paletteHex: ['#fff3e6', '#ffc9a9', '#a8e6cf', '#c3b1e1'],
    lighting: 'luz global suave, sombras difusas',
    character_design: 'personajes 3D redondeados y amables, proporciones chibi',
    environment: 'dioramas 3D acogedores y ordenados',
  },
  {
    id: '2d-boceto', name: '2D Boceto/Exploración', motif: 'sketch',
    description: 'Dibujo a lápiz o tinta tipo cuaderno de bocetos, trazos sueltos y exploratorios.',
    prompt: 'hand-drawn pencil and ink sketch, loose exploratory linework, sketchbook page feel, cross-hatching, light watercolor washes, visible construction lines',
    palette: 'grafito y tinta sobre papel crema con toques de acuarela', paletteHex: ['#f4efe4', '#3a3a3a', '#8c8c8c', '#c98b5f'],
    lighting: 'sombreado a lápiz, tramado',
    character_design: 'personajes dibujados a mano con trazos sueltos pero rasgos constantes',
    environment: 'escenarios esbozados con perspectiva a mano alzada',
  },
  {
    id: '3d-minimal', name: '3D Minimal', motif: 'cube',
    description: 'Escenas 3D minimalistas, geometría limpia y pocos elementos.',
    prompt: 'minimalist 3D render, clean simple geometry, few elements, matte materials, soft studio lighting, lots of negative space, modern isometric-inspired composition',
    palette: 'monocromática con un color de acento', paletteHex: ['#eef0f3', '#c9ced6', '#5b6472', '#ff6b4a'],
    lighting: 'luz de estudio suave y uniforme',
    character_design: 'figuras 3D simples y estilizadas sin detalles innecesarios',
    environment: 'espacios 3D vacíos y ordenados con objetos clave',
  },
  {
    id: 'pixel-retro', name: 'Pixel Retro', motif: 'pixel',
    description: 'Pixel art de videojuego retro, paleta limitada.',
    note: 'En la especificación aparece escrito «Pixel Reto»; se interpreta como «Pixel Retro». Verificar en la referencia.',
    prompt: 'retro pixel art, 16-bit video game style, limited color palette, crisp pixels, no anti-aliasing, detailed pixel backgrounds',
    palette: 'paleta limitada de 16 colores', paletteHex: ['#1a1c2c', '#5d275d', '#ef7d57', '#73eff7'],
    lighting: 'iluminación por bloques de color, dithering',
    character_design: 'sprites pixelados con rasgos consistentes',
    environment: 'escenarios tipo videojuego 16 bits',
  },
  {
    id: 'noir-detective', name: 'Noir Detective', motif: 'hat',
    description: 'Cine negro en blanco y negro, sombras duras y ambiente de misterio.',
    prompt: 'film noir detective illustration, black and white, hard shadows, venetian blind light patterns, rain-soaked streets, 1940s mystery atmosphere, high contrast ink',
    palette: 'blanco y negro de alto contraste', paletteHex: ['#0a0a0a', '#3b3b3b', '#9a9a9a', '#f0f0f0'],
    lighting: 'luz dura lateral, sombras de persiana, farolas',
    character_design: 'personajes con gabardina y sombrero, siluetas marcadas',
    environment: 'calles lluviosas, oficinas con humo, callejones',
  },
  {
    id: 'papercraft', name: 'Papercraft', motif: 'paper',
    description: 'Mundos hechos de papel recortado en capas, textura artesanal.',
    prompt: 'layered papercraft illustration, cut paper layers with depth, visible paper texture and soft drop shadows, handcrafted diorama look',
    palette: 'papeles de colores cálidos y suaves', paletteHex: ['#fbf3e4', '#f2a65a', '#6aa39b', '#e3655b'],
    lighting: 'sombras suaves entre capas de papel',
    character_design: 'personajes de papel recortado, formas simples',
    environment: 'escenarios en capas de papel con profundidad',
  },
  {
    id: 'cyberpunk-neon', name: 'Cyberpunk Neon', motif: 'city',
    description: 'Ciudades futuristas de neón, lluvia y tecnología.',
    prompt: 'cyberpunk neon illustration, futuristic megacity at night, glowing neon signs, rain reflections, holograms, high-tech atmosphere, magenta and cyan glow',
    palette: 'magenta, cian, violeta y negro', paletteHex: ['#0d0221', '#ff2a6d', '#05d9e8', '#7b2cbf'],
    lighting: 'neón intenso, reflejos en superficies mojadas',
    character_design: 'personajes con ropa tecnológica y accesorios luminosos',
    environment: 'calles futuristas, rascacielos, mercados nocturnos',
  },
  {
    id: 'documental-oscuro', name: 'Documental Oscuro', motif: 'film',
    description: 'Estética de documental serio y sombrío, realista y sobrio.',
    prompt: 'dark documentary style, realistic cinematic photography look, moody low-key lighting, desaturated film grain, serious investigative tone',
    palette: 'tonos tierra apagados y sombras profundas', paletteHex: ['#111214', '#3d3a34', '#7d6e5a', '#c2b59b'],
    lighting: 'clave baja, luz natural tenue',
    character_design: 'personas realistas, expresiones contenidas',
    environment: 'lugares reales: archivos, carreteras, edificios, paisajes',
  },
  {
    id: 'cosmos', name: 'Cosmos', motif: 'planet',
    description: 'Espacio profundo, planetas, nebulosas y escala cósmica.',
    prompt: 'cosmic space illustration, deep space, nebulae, planets and stars, sense of vast scale, luminous cosmic colors, cinematic sci-fi',
    palette: 'azul profundo, violeta, rosa nebular, blanco estelar', paletteHex: ['#05051a', '#1b1f6b', '#8e44ad', '#ff9ff3'],
    lighting: 'luz estelar, brillos de nebulosas',
    character_design: 'astronautas o figuras a escala cósmica',
    environment: 'espacio exterior, superficies planetarias, estaciones espaciales',
  },
];

function baseStyles() {
  const list = VERIFIED.map((s, i) => ({ ...s, slot: i + 1, verified: true }));
  for (let slot = list.length + 1; slot <= TOTAL_STYLES; slot++) {
    list.push({ id: `estilo-${String(slot).padStart(2, '0')}`, slot, verified: false, name: null, motif: 'pending', paletteHex: ['#f1f1ef', '#d9d7d0', '#bdb9ae', '#9c9789'] });
  }
  return list;
}

export function listStyles() {
  const overrides = Object.fromEntries(all('SELECT * FROM style_overrides').map(o => [o.style_id, o]));
  return baseStyles().map(s => {
    const o = overrides[s.id] || {};
    const merged = { ...s };
    for (const k of ['name', 'description', 'prompt', 'palette', 'lighting', 'character_design', 'environment']) if (o[k]) merged[k] = o[k];
    merged.preview_url = mediaUrl(o.preview_path) || null;
    merged.preview_path = o.preview_path || null;
    // Una ranura pendiente se puede usar en cuanto el usuario le da nombre y prompt.
    merged.defined_by_user = !s.verified && !!(o.name && o.prompt);
    merged.selectable = s.verified || merged.defined_by_user;
    return merged;
  });
}

export function getStyle(id) {
  const s = listStyles().find(x => x.id === id);
  if (!s) throw new Error('Estilo no encontrado: ' + id);
  if (!s.selectable) throw new Error('Este estilo está pendiente de verificación y aún no tiene definición.');
  return s;
}

export function updateStyle(id, patch) {
  const base = baseStyles().find(s => s.id === id);
  if (!base) throw new Error('Estilo no encontrado');
  const cur = get('SELECT * FROM style_overrides WHERE style_id = ?', id) || {};
  const fields = ['name', 'description', 'prompt', 'palette', 'lighting', 'character_design', 'environment', 'preview_path'];
  const val = {};
  for (const f of fields) val[f] = f in patch ? patch[f] : cur[f] ?? null;
  if (base.verified) val.name = null; // los nombres verificados no se renombran
  run(`INSERT INTO style_overrides(style_id, name, description, prompt, palette, lighting, character_design, environment, preview_path, updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(style_id) DO UPDATE SET name=excluded.name, description=excluded.description, prompt=excluded.prompt, palette=excluded.palette,
       lighting=excluded.lighting, character_design=excluded.character_design, environment=excluded.environment, preview_path=excluded.preview_path, updated_at=excluded.updated_at`,
    id, val.name, val.description, val.prompt, val.palette, val.lighting, val.character_design, val.environment, val.preview_path, now());
  return listStyles().find(s => s.id === id);
}

/** Bloque de estilo que se añade a TODAS las imágenes de un proyecto (consistencia visual). */
export function styleBlock(style) {
  return [
    `ART STYLE (keep identical in every image): ${style.prompt}.`,
    style.palette && `Color palette: ${style.palette}.`,
    style.lighting && `Lighting approach: ${style.lighting}.`,
    style.character_design && `Character design rules: ${style.character_design}.`,
    style.environment && `Environment style: ${style.environment}.`,
  ].filter(Boolean).join(' ');
}
