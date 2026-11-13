'use strict';
// Construye el marcador (bookmarklet) de RaulitoShow IA para tablet:
//   extension/engine.js + tablet/raulitoshow-panel.js  →  tablet/raulitoshow.bookmarklet.txt
// y lo inserta en la página de instalación tablet/instalar-raulitoshow.html (marca {{BOOKMARKLET}}).
// Requiere terser (solo para construir; no es dependencia de la app):
//   YA_TERSER=/ruta/a/node_modules/terser node tools/build-bookmarklet.js
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const terser = require(process.env.YA_TERSER || 'terser');

(async () => {
  const src = '(()=>{' + fs.readFileSync(path.join(root, 'extension/engine.js'), 'utf8') + '\n' +
    fs.readFileSync(path.join(root, 'tablet/raulitoshow-panel.js'), 'utf8') + '\n})();';
  const out = await terser.minify(src, { compress: { passes: 2 }, mangle: true, format: { ascii_only: true, comments: false } });
  const code = out.code;
  if (/<\/script/i.test(code)) throw new Error('El código contiene </script>');
  // Codificación mínima: solo % (los javascript: se descodifican al ejecutarse). Más corto que encodeURIComponent.
  if (/[\r\n]/.test(code)) throw new Error('El código minificado contiene saltos de línea');
  const bookmarklet = 'javascript:' + code.replace(/%/g, '%25');
  fs.writeFileSync(path.join(root, 'tablet/raulitoshow.bookmarklet.txt'), bookmarklet + '\n');
  const tplPath = path.join(root, 'tablet/instalar-raulitoshow.template.html');
  const page = fs.readFileSync(tplPath, 'utf8').replace('{{BOOKMARKLET}}', () => JSON.stringify(bookmarklet).replace(/</g, '\\u003c'));
  fs.writeFileSync(path.join(root, 'tablet/instalar-raulitoshow.html'), page);
  console.log(`Bookmarklet: ${bookmarklet.length} caracteres (código ${code.length})`);
})().catch(e => { console.error(e); process.exit(1); });
