import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const data = path.resolve(process.env.EPO_DATA_DIR || path.join(root, 'data'));

export const paths = {
  root,
  data,
  web: path.join(root, 'web'),
  projects: path.join(data, 'proyectos'),
  music: path.join(data, 'musica'),
  mascot: path.join(data, 'mascota'),
  project: (slug, ...p) => path.join(data, 'proyectos', slug, ...p),
};
