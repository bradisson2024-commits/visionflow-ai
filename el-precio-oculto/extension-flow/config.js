// Configuración compartida de la extensión YOUTUBE AUTOMATIZADO (panel, contenido y servicio).
// eslint-disable-next-line no-var
var YA_CONFIG = {
  // Páginas de Google Flow donde trabaja RaulitoShow IA: flow.google.com (actual) y labs.google (anterior).
  FLOW_MATCHES: ['https://flow.google.com/*', 'https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
  FLOW_URL: 'https://flow.google.com/',
  // App local El Precio Oculto · Viral Finder (Módulo 13). Cambia el puerto si usas otro PORT en .env
  // (y añádelo también a host_permissions en manifest.json).
  APP_URL: 'http://127.0.0.1:8790',
  // Tiempo máximo de espera de una generación de Flow (los videos pueden tardar varios minutos).
  GENERATION_TIMEOUT_MS: 10 * 60 * 1000,
};
