// Configuración compartida de la extensión YOUTUBE AUTOMATIZADO (panel, contenido y servicio).
// eslint-disable-next-line no-var
var YA_CONFIG = {
  // Páginas de Google Flow donde trabaja RaulitoShow IA: flow.google.com (actual) y labs.google (anterior).
  FLOW_MATCHES: ['https://flow.google.com/*', 'https://labs.google/fx/tools/flow*', 'https://labs.google/fx/*/tools/flow*'],
  FLOW_URL: 'https://flow.google.com/',
  // App local de YOUTUBE AUTOMATIZADO (almacenamiento de proyectos compartido con el Editor).
  APP_URL: 'http://127.0.0.1:5317',
  // Tiempo máximo de espera de una generación de Flow (los videos pueden tardar varios minutos).
  GENERATION_TIMEOUT_MS: 10 * 60 * 1000,
};
