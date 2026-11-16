/* RaulitoShow IA — interceptor del selector de archivos (se ejecuta en el MUNDO PRINCIPAL de la página
 * de Flow). Cuando el motor lo "arma" (atributo data-ya-armed en <html>) y Flow intenta abrir el
 * selector de archivos (input.click(), input.showPicker() o window.showOpenFilePicker), en lugar de
 * abrir la ventana del sistema entrega el personaje de referencia guardado en el input oculto
 * #ya-ref-holder. Solo actúa una vez por armado; sin armar, todo funciona como siempre.
 */
(() => {
  if (window.__yaPickerInstalled) return;
  window.__yaPickerInstalled = true;
  const root = () => document.documentElement;
  const armed = () => root().hasAttribute('data-ya-armed');
  const disarm = () => root().removeAttribute('data-ya-armed');
  const holderFile = () => { const h = document.getElementById('ya-ref-holder'); return h && h.files && h.files[0]; };
  const done = how => document.dispatchEvent(new CustomEvent('ya-picked', { detail: how }));
  function fill(input) {
    const f = holderFile();
    if (!f) return false;
    disarm();
    const dt = new DataTransfer(); dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    done('input');
    return true;
  }
  const P = HTMLInputElement.prototype;
  const origClick = P.click;
  P.click = function () { if (this.type === 'file' && armed() && fill(this)) return; return origClick.apply(this, arguments); };
  if (P.showPicker) {
    const origShow = P.showPicker;
    P.showPicker = function () { if (this.type === 'file' && armed() && fill(this)) return; return origShow.apply(this, arguments); };
  }
  if (window.showOpenFilePicker) {
    const origOpen = window.showOpenFilePicker;
    window.showOpenFilePicker = async function () {
      if (armed()) { const f = holderFile(); if (f) { disarm(); done('fsapi'); return [{ kind: 'file', name: f.name, getFile: async () => f }]; } }
      return origOpen.apply(this, arguments);
    };
  }
  // Inputs de archivo activados por el usuario/página sin .click() (p. ej. <label for>): se rellenan al hacer clic.
  document.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest('input[type=file], label');
    if (!t || !armed()) return;
    const input = t.tagName === 'INPUT' ? t : (t.control && t.control.type === 'file' ? t.control : null);
    if (input && fill(input)) e.preventDefault();
  }, true);
})();
