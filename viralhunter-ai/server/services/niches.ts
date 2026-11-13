// Catálogo de nichos con consultas en español y en inglés (para detectar formatos aún no replicados en español).
export interface NicheSeed {
  id: string;
  label: string;
  es: string;
  en: string;
}

export const NICHE_CATALOG: NicheSeed[] = [
  { id: "christian", label: "Historias cristianas", es: "historias bíblicas animadas", en: "bible stories animated" },
  { id: "mystery", label: "Misterios sin resolver", es: "misterios sin resolver", en: "unsolved mysteries explained" },
  { id: "finance", label: "Finanzas personales", es: "finanzas personales consejos dinero", en: "personal finance money tips" },
  { id: "motivation", label: "Motivación y estoicismo", es: "estoicismo motivación", en: "stoicism motivation" },
  { id: "psychology", label: "Psicología", es: "psicología datos curiosos", en: "psychology facts" },
  { id: "history", label: "Historia narrada", es: "historia documental narrado", en: "history documentary narrated" },
  { id: "ai", label: "Inteligencia artificial", es: "inteligencia artificial herramientas", en: "ai tools tutorial" },
  { id: "curiosities", label: "Curiosidades", es: "curiosidades que no sabías", en: "facts you didn't know" },
  { id: "true_crime", label: "Casos reales", es: "casos reales true crime", en: "true crime case documentary" },
  { id: "space", label: "Espacio y universo", es: "universo espacio documental", en: "space universe documentary" },
  { id: "horror", label: "Relatos de terror", es: "relatos de terror reales", en: "scary stories true horror" },
  { id: "health", label: "Salud y longevidad", es: "salud consejos médico longevidad", en: "health longevity doctor explains" },
  { id: "kids", label: "Cuentos infantiles", es: "cuentos infantiles para dormir", en: "bedtime stories for kids" },
  { id: "business", label: "Negocios y emprendimiento", es: "historia de empresas emprendimiento", en: "business case study story" },
  { id: "geography", label: "Geografía y países", es: "geografía países explicados", en: "geography explained countries" },
  { id: "animals", label: "Animales asombrosos", es: "animales increíbles documental", en: "amazing animals facts" },
  { id: "ancient", label: "Civilizaciones antiguas", es: "civilizaciones antiguas misterios", en: "ancient civilizations mysteries" },
  { id: "self_improvement", label: "Desarrollo personal", es: "hábitos desarrollo personal", en: "self improvement habits" },
];

/** Selección determinista de los nichos del día (rotación por fecha UTC): reproducible y auditable. */
export function nichesOfTheDay(date = new Date(), count = 3): NicheSeed[] {
  const dayNumber = Math.floor(date.getTime() / 86400_000);
  const n = NICHE_CATALOG.length;
  const out: NicheSeed[] = [];
  // paso coprimo con n para recorrer todo el catálogo sin repetir en días consecutivos
  const stepSize = 7;
  for (let i = 0; out.length < count && i < n; i++) {
    const idx = (dayNumber * count + i * stepSize) % n;
    const seed = NICHE_CATALOG[idx];
    if (!out.includes(seed)) out.push(seed);
  }
  return out;
}
