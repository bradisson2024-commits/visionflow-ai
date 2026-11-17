// Galería de estilos: cada estilo es un perfil visual que el generador aplica a CADA escena (prompt base, paleta,
// iluminación, cámara, tipo de personaje y elementos a evitar). Todos son originales: sin personajes, marcas ni
// recursos de terceros. El usuario puede crear estilos nuevos.
import { sql } from '../db/index.js';

export const BUILTIN = [
  ['cinematic-stickman', 'Cinematic Stickman', 'Personajes stickman expresivos en escenas con encuadre y luz de cine.', {
    base: 'cinematic stick figure illustration: characters are expressive stickmen with round heads and simple limbs, placed in richly detailed cinematic environments', palette: 'deep teal and warm orange cinematic grade', lighting: 'dramatic rim light, volumetric haze', camera: 'wide cinematic framing, rule of thirds, shallow depth of field on backgrounds', characters: 'stick figures with consistent accessories so each one is recognizable', avoid: 'realistic human faces, text, logos' }],
  ['epica-biblica', 'Épica Bíblica', 'Épica religiosa e histórica con luz dorada y personajes de época.', {
    base: 'epic biblical-era painting style, ancient Middle Eastern landscapes and historical figures in period robes', palette: 'gold, sand, deep blue and crimson', lighting: 'divine god rays, golden hour, strong chiaroscuro', camera: 'grand low-angle compositions, vast skies', characters: 'dignified period characters with consistent robes and features', avoid: 'modern objects, text, logos, anachronisms' }],
  ['terror-gotico', 'Terror Gótico', 'Ilustración oscura con sombras, escenarios inquietantes y atmósfera de terror.', {
    base: 'gothic horror illustration, decaying mansions, foggy graveyards, candlelit interiors', palette: 'desaturated blacks, cold greys, sickly green and blood red accents', lighting: 'low-key lighting, long shadows, moonlight', camera: 'dutch angles, claustrophobic framing', characters: 'pale, gaunt figures with consistent period clothing', avoid: 'gore, text, logos, bright cheerful colors' }],
  ['videojuego-urbano', 'Estilo videojuego urbano', 'Estética de videojuego de mundo abierto con ciudad y personajes originales.', {
    base: 'stylized open-world video game render of an original modern city, game-like 3D look', palette: 'saturated sunset magenta, cyan and neon', lighting: 'golden hour or neon night lighting', camera: 'third-person over-the-shoulder and aerial establishing shots', characters: 'original stylized street characters, never existing game characters', avoid: 'real game logos, HUD from real games, real brands, text' }],
  ['epoca-romana', 'Época Romana', 'Coliseos, legiones, senadores e imperio con rigor histórico.', {
    base: 'historical Roman Empire scene, marble architecture, legions, forums and colosseums, historically plausible details', palette: 'marble white, terracotta, imperial red and bronze', lighting: 'Mediterranean sunlight, dusty atmosphere', camera: 'epic wide shots and heroic medium shots', characters: 'Roman citizens, legionaries and senators in accurate period clothing', avoid: 'modern elements, text, logos' }],
  ['military-spec-ops', 'Military Spec-Ops', 'Cine militar táctico con equipos, misiones nocturnas y tensión.', {
    base: 'cinematic military special operations scene, tactical gear, realistic environments', palette: 'olive, desert tan, night-vision green, steel blue', lighting: 'hard sunlight or low-light night operations, muzzle-free tension', camera: 'handheld documentary framing, telephoto compression', characters: 'operators with consistent unit gear, faces partly covered', avoid: 'real unit insignia, real brands, gore, text' }],
  ['analog-horror', 'Analog Horror', 'Estética VHS, ruido, grano y terror retro de cinta encontrada.', {
    base: 'analog horror found-footage frame, 1990s VHS camcorder look, unsettling ordinary places', palette: 'washed-out colors, crushed blacks, magenta and green chroma shift', lighting: 'flat on-camera light, flickering fluorescents', camera: 'static surveillance or camcorder framing, 4:3 feeling inside the frame', characters: 'blurry distant figures, faces rarely clear', avoid: 'readable text, logos, gore', post: 'vhs' }],
  ['anime-japones', 'Anime Japonés', 'Ilustración anime original con personajes consistentes y fondos detallados.', {
    base: 'original Japanese anime illustration, cel shading, detailed painted backgrounds', palette: 'vibrant clean colors, soft sky gradients', lighting: 'bright anime lighting with bloom', camera: 'dynamic anime framing, expressive close-ups', characters: 'original anime characters with consistent hairstyle, eye color and outfit', avoid: 'existing anime characters, text, logos, watermarks' }],
  ['vector-flat', 'Vector Flat Design', 'Formas geométricas, colores planos y gráficos limpios explicativos.', {
    base: 'flat vector illustration, geometric shapes, clean infographic explainer style', palette: 'limited modern palette of navy, coral, mint and mustard', lighting: 'no realistic lighting, flat fills with subtle shadows', camera: 'centered, balanced compositions with clear hierarchy', characters: 'simple geometric people with consistent colors', avoid: 'gradients overload, photorealism, text, logos' }],
  ['dark-fantasy', 'Dark Fantasy', 'Fantasía oscura con criaturas, castillos y mundos épicos.', {
    base: 'dark fantasy concept art, ancient castles, cursed forests, mythical creatures', palette: 'deep purples, charcoal, ember orange', lighting: 'moody torchlight, stormy skies, magical glow', camera: 'epic establishing shots and dramatic low angles', characters: 'original knights, sorcerers and creatures with consistent armor and features', avoid: 'existing franchises, text, logos' }],
  ['animacion-2d', 'Animación 2D', 'Ilustración de dibujos animados 2D con trazo limpio, lista para animar.', {
    base: '2D cartoon animation frame, clean line art, flat cel colors, expressive poses', palette: 'bright friendly colors', lighting: 'simple cel shading', camera: 'TV animation framing, clear silhouettes', characters: 'original cartoon characters with consistent design sheet features', avoid: 'existing cartoon characters, text, logos' }],
  ['animacion-3d', 'Animación 3D', 'Personajes y escenarios 3D estilizados de película de animación.', {
    base: 'stylized 3D animated film still, soft subsurface skin, detailed stylized environments', palette: 'warm cinematic colors', lighting: 'global illumination, soft key light, rim light', camera: 'feature-film framing, shallow depth of field', characters: 'original stylized 3D characters with consistent proportions and outfits', avoid: 'existing animated characters, text, logos' }],
  ['documental', 'Documental Cinematográfico', 'Imágenes realistas con luz natural y estética de documental.', {
    base: 'photorealistic documentary photograph, real-world locations, authentic details', palette: 'natural, slightly desaturated documentary grade', lighting: 'natural available light', camera: '35mm documentary framing, candid observational shots', characters: 'ordinary people, consistent clothing per character', avoid: 'staged glamour, text, logos, watermarks' }],
  ['realismo-cinematografico', 'Realismo Cinematográfico', 'Apariencia realista con composición, color y óptica de cine.', {
    base: 'photorealistic cinematic film still, anamorphic lens, production design quality', palette: 'cinematic color grade with controlled contrast', lighting: 'motivated cinematic lighting, practical lights', camera: 'anamorphic widescreen composition, deliberate blocking', characters: 'realistic actors-like characters with consistent wardrobe', avoid: 'real celebrities, text, logos, watermarks' }],
];

export async function seedStyles() {
  let sort = 10;
  for (const [id, name, description, profile] of BUILTIN) {
    await sql`insert into styles(id, name, description, profile, builtin, sort) values (${id}, ${name}, ${description}, ${sql.json(profile)}, true, ${sort})
      on conflict (id) do update set name = excluded.name, description = excluded.description, profile = excluded.profile, sort = excluded.sort`;
    sort += 10;
  }
}

export const listStyles = (userId) => sql`select * from styles where builtin or owner_id = ${userId} order by sort, created_at`;
export async function getStyle(id) { const [s] = await sql`select * from styles where id = ${id}`; return s; }

export async function createStyle(userId, { name, description, base, palette, lighting, camera, characters, avoid }) {
  const id = `u-${String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)}-${Date.now().toString(36)}`;
  const [s] = await sql`insert into styles(id, name, description, profile, owner_id, sort) values (${id}, ${name}, ${description}, ${sql.json({ base, palette, lighting, camera, characters, avoid })}, ${userId}, 1000) returning *`;
  return s;
}

/** Texto de estilo que se añade a cada prompt de imagen. */
export function stylePrompt(style) {
  const p = style.profile;
  return [`Visual style: ${p.base}`, p.palette && `Color palette: ${p.palette}`, p.lighting && `Lighting: ${p.lighting}`, p.camera && `Camera: ${p.camera}`, p.characters && `Characters: ${p.characters}`, `Avoid: ${p.avoid || 'text, logos, watermarks'}; no written words in the image`].filter(Boolean).join('. ');
}
