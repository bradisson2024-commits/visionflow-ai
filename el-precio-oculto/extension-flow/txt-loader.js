/* RaulitoShow IA — lectura de archivos .TXT de prompts (compartido por el panel de la extensión y el de tablet).
 * Lee el archivo real del dispositivo respetando su codificación: UTF-8 (con o sin BOM), UTF-16 (con BOM)
 * o Windows-1252/ANSI (el formato del Bloc de notas antiguo, con tildes y ñ). El texto no se modifica:
 * solo se quita la marca BOM y se normalizan los saltos de línea de Windows (\r\n) a \n.
 */
// eslint-disable-next-line no-unused-vars
var RaulitoTxt = (() => {
  function decode(buf) {
    const b = new Uint8Array(buf);
    if (b[0] === 0xFF && b[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), encoding: 'UTF-16' };
    if (b[0] === 0xFE && b[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), encoding: 'UTF-16' };
    const start = b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF ? 3 : 0;
    try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(start)), encoding: 'UTF-8' }; }
    catch { return { text: new TextDecoder('windows-1252').decode(b), encoding: 'Windows-1252 (ANSI)' }; }
  }
  const isTxt = f => f && (/\.txt$/i.test(f.name) || f.type === 'text/plain');
  async function read(file) {
    if (!isTxt(file)) throw new Error(`«${file && file.name}» no es un archivo .txt.`);
    const { text, encoding } = decode(await file.arrayBuffer());
    return { text: text.replace(/\r\n?/g, '\n'), encoding };
  }
  const prompts = text => String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const pad = n => String(n).padStart(3, '0');
  function message(name, n) {
    if (!n) return `«${name}» no tiene ninguna línea con texto.`;
    return `✓ «${name}» cargado: ${n} ${n === 1 ? 'prompt' : 'prompts'} → escenas ${pad(1)}${n > 1 ? ' a ' + pad(n) : ''}.`;
  }
  return { read, prompts, message, isTxt, pad };
})();
