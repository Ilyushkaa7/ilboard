const $ = s => document.querySelector(s);
const MAX_BOARDS = 4;
const DEFAULT_COLOR = '#2563eb';
const STORAGE_KEY = 'ilboard.project.v1';
const chipIcon = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="3"/><path d="M9 2v3m6-3v3M9 19v3m6-3v3M2 9h3m-3 6h3m14-6h3m-3 6h3"/></svg>';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const quoted = s => JSON.stringify(s);
const regexEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let boards = [], selectedId, showAll = false, running = false, ready = false, worker, workerFailed = false, pendingPaint = 0, toastTimer, saveTimer, lastProgram = '', bootSequence = 0;
const buttonTimers = new Map();
let colorTokens = [], colorRange = null, colorSource = '';
function makeBoard(name = 'main', size = 10) {
  return { id: crypto.randomUUID(), name, size, pixels: Array(size * size).fill(null), brightness: 100, inputs: { A: false, B: false, light: 70, temperature: 22, distance: 50 } };
}
const selected = () => boards.find(b => b.id === selectedId) || boards[0];
function validColor(value) { return typeof value === 'string' && CSS.supports('color', value) ? value : DEFAULT_COLOR; }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('show'); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600); }
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ code: $('#editor').value, boards: boards.map(b => ({ ...b, inputs: { ...b.inputs, A: false, B: false } })), selectedId, showAll })); }
  catch { /* The .ilpy export remains available if browser storage is full. */ }
}
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 250); }
function log(message, type = '') {
  const node = document.createElement('div'); node.textContent = message; node.className = type; $('#output').append(node);
  while ($('#output').children.length > 150) $('#output').firstChild.remove();
  $('#output').scrollTop = $('#output').scrollHeight;
}
function theme(mode) {
  document.documentElement.dataset.theme = mode;
  const dark = mode === 'dark';
  $('#theme').innerHTML = dark ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M20.5 13.3A8.7 8.7 0 0 1 10.7 3.5a8.7 8.7 0 1 0 9.8 9.8Z"/></svg>';
  $('#theme').ariaLabel = dark ? 'Включить светлую тему' : 'Включить тёмную тему'; $('#theme').title = dark ? 'Светлая тема' : 'Тёмная тема';
  try { localStorage.setItem('ilboard.theme', mode); } catch {}
}
function highlightCode() {
  const source = $('#editor').value;
  const pattern = /#[^\n]*|(?:"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|\b(?:from|import|as|for|in|while|if|elif|else|def|return|class|try|except|finally|with|raise|and|or|not|is|lambda|pass|break|continue|True|False|None|async|await|yield)\b|\b\d+(?:\.\d+)?\b|\b(?:Board|sleep|wait|print|range|len|str|int|float|round|min|max|list|enumerate)\b/g;
  let result = '', end = 0;
  colorTokens = [];
  for (const m of source.matchAll(pattern)) {
    result += esc(source.slice(end, m.index));
    const t = m[0], kind = t[0] === '#' ? 'comment' : /^['"]/.test(t) ? 'string' : /^\d/.test(t) ? 'number' : /^(Board|sleep|wait|print|range|len|str|int|float|round|min|max|list|enumerate)$/.test(t) ? 'fn' : 'keyword';
    if (kind === 'string' && /^(['"])[^'"\n]+\1$/.test(t) && CSS.supports('color', t.slice(1, -1))) colorTokens.push({ start: m.index + 1, end: m.index + t.length - 1, value: t.slice(1, -1) });
    result += `<span class="token-${kind}">${esc(t)}</span>`; end = m.index + t.length;
  }
  $('#highlight code').innerHTML = result + esc(source.slice(end)) + '\n';
  $('#gutter').textContent = Array.from({ length: source.split('\n').length }, (_, i) => i + 1).join('\n');
  syncScroll(); cursor();
}
function syncScroll() { $('#highlight').scrollTop = $('#editor').scrollTop; $('#highlight').scrollLeft = $('#editor').scrollLeft; $('#gutter').scrollTop = $('#editor').scrollTop; positionColorMarkers(); }
const colorButton = document.createElement('button');
colorButton.id = 'pickColor'; colorButton.className = 'icon-button'; colorButton.ariaLabel = 'Вставить цвет'; colorButton.title = 'Вставить цвет';
colorButton.innerHTML = '<span class="toolbar-color-swatch"></span>';
$('.editor-toolbar > div').prepend(colorButton);
const colorMarkers = document.createElement('div'); colorMarkers.id = 'colorMarkers'; $('.code-content').append(colorMarkers);
function positionColorMarkers() {
  const editor = $('#editor'), font = getComputedStyle(editor), canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = font.font;
  const charWidth = ctx.measureText('M').width, lineHeight = parseFloat(font.lineHeight), height = editor.clientHeight;
  colorMarkers.innerHTML = colorTokens.map((token, i) => {
    const before = editor.value.slice(0, token.start).split('\n'), line = before.length - 1;
    const column = before.at(-1).replace(/\t/g, '    ').length, top = line * lineHeight - editor.scrollTop + lineHeight - 7;
    if (top < -8 || top >= height - 5) return '';
    return `<button class="color-marker" data-color-token="${i}" aria-label="Изменить цвет ${esc(token.value)}" title="${esc(token.value)}" style="left:${column * charWidth - editor.scrollLeft}px;top:${top}px;width:${Math.max(12, (token.end - token.start) * charWidth)}px;--swatch:${esc(token.value)}"></button>`;
  }).join('');
}
function toHex(color) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
  return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('');
}
function setPickerColor(value) { $('#colorWell').value = value; $('#colorHex').value = value; $('#colorHex').removeAttribute('aria-invalid'); }
function openColorPicker(anchor, token = null) {
  const editor = $('#editor'), start = editor.selectionStart, end = editor.selectionEnd;
  token ||= colorTokens.find(t => start >= t.start - 1 && end <= t.end + 1);
  colorSource = editor.value;
  colorRange = token ? { start: token.start, end: token.end, quoted: true } : { start, end, quoted: false };
  const picked = token ? toHex(token.value) : DEFAULT_COLOR;
  setPickerColor(picked); $('#applyColor').textContent = token ? 'Применить' : 'Вставить';
  const picker = $('#colorPicker'), rect = anchor.getBoundingClientRect(); picker.hidden = false;
  picker.style.left = `${Math.max(12, Math.min(innerWidth - 254, rect.left))}px`;
  picker.style.top = `${Math.max(12, Math.min(innerHeight - picker.offsetHeight - 12, rect.bottom + 9))}px`;
}
colorButton.onmousedown = e => e.preventDefault();
colorButton.onclick = () => openColorPicker(colorButton);
colorMarkers.onclick = e => { const marker = e.target.closest('[data-color-token]'); if (marker) openColorPicker(marker, colorTokens[+marker.dataset.colorToken]); };
$('#colorPalette').innerHTML = ['#2563eb','#06b6d4','#22c55e','#eab308','#f97316','#ef4444','#ec4899','#8b5cf6','#ffffff','#111827'].map(color => `<button aria-label="Цвет ${color}" data-preset="${color}" style="background:${color}"></button>`).join('');
$('#colorPalette').onclick = e => { const p = e.target.closest('[data-preset]'); if (p) setPickerColor(p.dataset.preset); };
$('#colorWell').oninput = e => setPickerColor(e.target.value);
$('#colorHex').oninput = e => { const valid = /^#[0-9a-f]{6}$/i.test(e.target.value); e.target.setAttribute('aria-invalid', !valid); if (valid) $('#colorWell').value = e.target.value; };
$('#closeColor').onclick = () => { $('#colorPicker').hidden = true; };
$('#applyColor').onclick = () => {
  let hex = $('#colorHex').value.trim(); if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('');
  if (!/^#[0-9a-f]{6}$/i.test(hex)) { $('#colorHex').setAttribute('aria-invalid', 'true'); $('#colorHex').focus(); return; }
  if ($('#editor').value !== colorSource) { $('#colorPicker').hidden = true; toast('Код изменился — выбери цвет ещё раз'); return; }
  const text = colorRange.quoted ? hex : quoted(hex), editor = $('#editor');
  editor.focus(); editor.setSelectionRange(colorRange.start, colorRange.end);
  // Keep the color change in the editor's native undo history when supported.
  if (!document.execCommand('insertText', false, text)) editor.setRangeText(text, colorRange.start, colorRange.end, 'end');
  $('#colorPicker').hidden = true; highlightCode(); scheduleSave();
};
$('#colorHex').onkeydown = e => { if (e.key === 'Enter') $('#applyColor').click(); };
document.addEventListener('pointerdown', e => { if (!$('#colorPicker').hidden && !e.target.closest('#colorPicker, #pickColor, .color-marker')) $('#colorPicker').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#colorPicker').hidden = true; });
window.addEventListener('resize', () => { positionColorMarkers(); $('#colorPicker').hidden = true; });
document.fonts.ready.then(positionColorMarkers);
function cursor() { const before = $('#editor').value.slice(0, $('#editor').selectionStart).split('\n'); $('#cursorPosition').textContent = `${before.length}:${before.at(-1).length + 1}`; }
function setCode(value) { $('#editor').value = value; lastProgram = value; highlightCode(); persist(); }
function renderTabs() {
  $('#boardTabs').innerHTML = boards.map(b => `<button class="board-tab ${b.id === selectedId ? 'active' : ''}" data-tab="${b.id}" role="tab" aria-selected="${b.id === selectedId}" title="${esc(b.name)}">${chipIcon}<span>${esc(b.name)}</span></button>`).join('');
  $('#addBoard').disabled = boards.length >= MAX_BOARDS;
  $('#viewAll').disabled = boards.length < 2; $('#viewAll').classList.toggle('active', showAll);
  $('#removeBoard').disabled = boards.length <= 1;
}
function renderSettings() {
  const b = selected(); $('#boardName').value = b.name; $('#boardSize').value = b.size; $('#sensorBoardName').textContent = b.name;
  for (const sensor of ['light', 'temperature', 'distance']) { $(`#${sensor}`).value = b.inputs[sensor]; sensorValue(sensor, b.inputs[sensor]); }
}
function sensorValue(key, value) { $(`#${key}Value`).textContent = `${value}${{ light: '%', temperature: '°', distance: ' см' }[key]}`; }
function buttonMarkup(b, key, x) {
  return `<g class="hardware-button ${b.inputs[key] ? 'pressed' : ''}" role="button" tabindex="0" aria-label="Кнопка ${key}, плата ${esc(b.name)}" aria-pressed="${b.inputs[key]}" data-board="${b.id}" data-key="${key}" transform="translate(${x} 235)"><rect x="-26" y="-26" width="52" height="52" rx="9" fill="#9aa5b5"/><circle cx="-19" cy="-19" r="2" fill="#d2dae7"/><circle cx="19" cy="19" r="2" fill="#d2dae7"/><rect class="button-face" x="-19" y="-19" width="38" height="38" rx="9" fill="#2d3646" stroke="#475268"/><text y="6" text-anchor="middle" fill="#e0e9f7" font-size="18" font-weight="600">${key}</text></g>`;
}
function boardSVG(b) {
  const step = 300 / b.size, r = Math.min(10, step * 0.31), start = 150 + step / 2, top = 87 + step / 2;
  let lights = '';
  for (let y = 0; y < b.size; y++) for (let x = 0; x < b.size; x++) {
    const value = b.pixels[y * b.size + x], on = value !== null;
    const cx = start + x * step, cy = top + y * step;
    lights += `<g data-pixel="${y * b.size + x}"><circle class="halo" cx="${cx}" cy="${cy}" r="${r * 1.9}" fill="${on ? esc(validColor(value)) : 'none'}" opacity="${0.42 * b.brightness / 100}"/><circle class="led" cx="${cx}" cy="${cy}" r="${r}" fill="${on ? esc(validColor(value)) : '#303b4d'}" opacity="${on ? b.brightness / 100 : 1}"/><circle class="led-core" cx="${cx - r * .17}" cy="${cy - r * .2}" r="${r * .4}" fill="${on ? '#ffffff' : '#485467'}" opacity="${on ? .88 * b.brightness / 100 : .35}"/><rect class="pixel-hit" data-board="${b.id}" data-index="${y * b.size + x}" x="${cx - step / 2}" y="${cy - step / 2}" width="${step}" height="${step}" fill="transparent"/></g>`;
  }
  return `<svg viewBox="0 0 600 490" role="group" aria-label="ilboard ${esc(b.name)}, матрица ${b.size} на ${b.size}"><defs><linearGradient id="pcb-${b.id}" x2="0" y2="1"><stop stop-color="#202a3c"/><stop offset="1" stop-color="#141c2a"/></linearGradient><linearGradient id="gold-${b.id}" x2="0" y2="1"><stop stop-color="#e2c980"/><stop offset="1" stop-color="#b79549"/></linearGradient></defs><rect x="6" y="16" width="588" height="462" rx="34" fill="#0d1523"/><rect x="6" y="9" width="588" height="462" rx="34" fill="url(#pcb-${b.id})" stroke="#3b475e" stroke-width="2"/>
<path d="M39 10H155l-26 27H6v6Q6 10 39 10" fill="#2563eb"/><path d="M146 10h20l-27 27h-20Z" fill="#4b82f0"/><path d="M538 10h26q30 0 30 30v39l-56-56Z" fill="#2563eb"/>
<rect x="266" y="0" width="68" height="27" rx="5" fill="#9ba6b9" stroke="#59677e"/><rect x="277" y="0" width="46" height="15" rx="3" fill="#253044"/><rect x="286" y="4" width="28" height="5" rx="2" fill="#131c2c"/>
<text x="39" y="66" fill="#e3ebf7" font-size="23" font-weight="600" letter-spacing="-.8">ilboard</text><text x="560" y="62" text-anchor="end" fill="#8394ae" font-size="15">${b.size} × ${b.size}</text>
<rect x="140" y="77" width="320" height="320" rx="15" fill="#111a28" stroke="#2d3a50"/>
${lights}${buttonMarkup(b, 'A', 76)}${buttonMarkup(b, 'B', 524)}
<path d="M48 114h51v47h21m-72 161h52v43h20M550 114h-50v47h-20m70 161h-50v43h-20" stroke="#34415a" stroke-width="1.6" fill="none"/><g fill="#4d5e78"><circle cx="48" cy="114" r="3"/><circle cx="48" cy="322" r="3"/><circle cx="550" cy="114" r="3"/><circle cx="550" cy="322" r="3"/></g>
<text x="300" y="425" text-anchor="middle" fill="#8293ad" font-size="14" letter-spacing="1.5">${esc(b.name)}</text><circle cx="49" cy="413" r="7" fill="#111a28" stroke="#657187" stroke-width="3"/><circle cx="551" cy="413" r="7" fill="#111a28" stroke="#657187" stroke-width="3"/>
${Array.from({ length: 12 }, (_, i) => `<rect x="${46 + i * 43}" y="443" width="35" height="28" rx="2" fill="url(#gold-${b.id})"/><path d="M${63.5 + i * 43} 446v22" stroke="#f0db9a" stroke-width="1" opacity=".45"/>`).join('')}
<rect x="100" y="463" width="3" height="9" fill="#111a28"/><rect x="497" y="463" width="3" height="9" fill="#111a28"/></svg>`;
}
function renderBoards() {
  $('#boardArea').classList.toggle('all', showAll && boards.length > 1);
  const visible = showAll && boards.length > 1 ? boards : [selected()];
  $('#boardArea').innerHTML = visible.map(b => `<div class="board-card" data-card="${b.id}">${boardSVG(b)}${showAll ? `<div class="board-caption">${esc(b.name)}</div>` : ''}</div>`).join('');
}
function paint() {
  pendingPaint = 0;
  for (const card of $('#boardArea').children) {
    const b = boards.find(b => b.id === card.dataset.card); if (!b) continue;
    const pixels = card.querySelectorAll('[data-pixel]');
    if (pixels.length !== b.size ** 2) { renderBoards(); return; }
    pixels.forEach((g, i) => {
      const v = b.pixels[i], on = v !== null, color = on ? validColor(v) : '#303b4d';
      g.children[0].setAttribute('fill', on ? color : 'none'); g.children[0].setAttribute('opacity', .42 * b.brightness / 100);
      g.children[1].setAttribute('fill', color); g.children[1].setAttribute('opacity', on ? b.brightness / 100 : 1);
      g.children[2].setAttribute('fill', on ? '#ffffff' : '#485467'); g.children[2].setAttribute('opacity', on ? .88 * b.brightness / 100 : .35);
    });
    card.querySelectorAll('[data-key]').forEach(g => { g.classList.toggle('pressed', b.inputs[g.dataset.key]); g.setAttribute('aria-pressed', b.inputs[g.dataset.key]); });
  }
  scheduleSave();
}
function schedulePaint() { if (!pendingPaint) pendingPaint = requestAnimationFrame(paint); }
function selectBoard(id) { selectedId = id; renderTabs(); renderSettings(); renderBoards(); persist(); }
function nextName() { for (let i = 2; i < 100; i++) if (!boards.some(b => b.name === `board${i}`)) return `board${i}`; }
function syncDeclarations(oldName, newName, size) {
  const pattern = new RegExp(`\\bBoard\\(\\s*(["'])${regexEsc(oldName)}\\1(?:\\s*,\\s*size\\s*=\\s*\\d+)?\\s*\\)`, 'g');
  const old = $('#editor').value;
  const changed = old.replace(pattern, `Board(${quoted(newName)}, size=${size})`);
  if (changed !== old) { $('#editor').value = changed; highlightCode(); }
}
function insertConstructor(b) {
  let code = $('#editor').value;
  if (!/from\s+ilboard\s+import[^\n]*\bBoard\b/.test(code)) code = 'from ilboard import Board\n' + code;
  const rows = code.split('\n'); let index = rows.findIndex(line => line.trim() && !/^(?:from |import |#)/.test(line)); if (index < 0) index = rows.length;
  rows.splice(index, 0, `${b.name} = Board(${quoted(b.name)}, size=${b.size})`);
  $('#editor').value = rows.join('\n'); highlightCode();
}
function addBoard() {
  if (boards.length >= MAX_BOARDS) return;
  stop(false); const b = makeBoard(nextName(), 10); boards.push(b); selectedId = b.id; insertConstructor(b); renderTabs(); renderSettings(); renderBoards(); persist();
}
function boardEvent(data) {
  let b = boards.find(b => b.name === data.name);
  if (data.action === 'create') {
    if (!b && boards.length < MAX_BOARDS) { b = makeBoard(data.name, data.size); boards.push(b); renderTabs(); renderBoards(); }
    return;
  }
  if (!b) return;
  switch (data.action) {
    case 'pixel': if (data.x >= 0 && data.x < b.size && data.y >= 0 && data.y < b.size) b.pixels[data.y * b.size + data.x] = data.color; break;
    case 'frame': if (data.pixels.length === b.size ** 2) b.pixels = data.pixels; break;
    case 'fill': b.pixels.fill(data.color); break;
    case 'resize': b.size = data.size; b.pixels = Array(data.size ** 2).fill(null); if (b.id === selectedId) renderSettings(); renderBoards(); break;
    case 'brightness': b.brightness = data.value; break;
  }
  schedulePaint();
}
function pushInputs() { if (worker) worker.postMessage({ type: 'input', boards: boards.map(({ name, inputs }) => ({ name, inputs })) }); }
function setButton(id, key, pressed) {
  const b = boards.find(b => b.id === id); if (!b) return;
  const token = `${id}-${key}`; clearTimeout(buttonTimers.get(token));
  b.inputs[key] = pressed; pushInputs(); schedulePaint();
  if (!pressed) buttonTimers.delete(token);
}
function pulseButton(id, key) { setButton(id, key, true); buttonTimers.set(`${id}-${key}`, setTimeout(() => setButton(id, key, false), 450)); }
function boot() {
  ready = false; workerFailed = false; const generation = ++bootSequence;
  $('#runtimeStatus').textContent = 'Загрузка Python…'; $('#runtimeDot').className = '';
  worker = new Worker('python-worker.js?v=20261118-offline');
  worker.onmessage = ({ data }) => {
    if (generation !== bootSequence) return;
    if (data.type === 'ready') { ready = true; $('#runtimeStatus').textContent = 'Python готов'; $('#runtimeDot').className = 'ready'; pushInputs(); return; }
    if (data.type === 'board') { boardEvent(data.value); return; }
    if (data.type === 'stdout' || data.type === 'stderr') { log(data.value, data.type === 'stderr' ? 'log-error' : ''); return; }
    if (data.type === 'done') { running = false; runUI(); log('Завершено', 'log-muted'); return; }
    if (data.type === 'error') { running = false; runUI(); log(friendlyError(data.value), 'log-error'); return; }
    if (data.type === 'load-error') runtimeError();
  };
  worker.onerror = runtimeError;
}
function runtimeError() { ready = false; workerFailed = true; running = false; runUI(); $('#runtimeStatus').textContent = 'Python не загружен'; $('#runtimeDot').className = 'error'; log('Не удалось загрузить Python. Проверь интернет и нажми «Запустить», чтобы повторить.', 'log-error'); }
function runUI() { $('#run').disabled = running; $('#stop').disabled = !running; $('#run span').textContent = running ? 'Выполняется' : 'Запустить'; $('#addBoard').disabled = running || boards.length >= MAX_BOARDS; }
function run() {
  if (running) return;
  if (!ready) { if (workerFailed) { worker.terminate(); boot(); } toast('Python загружается…'); return; }
  running = true; $('#output').replaceChildren(); runUI();
  worker.postMessage({ type: 'run', code: $('#editor').value, boards: boards.map(b => ({ name: b.name, size: b.size, pixels: b.pixels, brightness: b.brightness, inputs: b.inputs })) });
}
function stop(message = true) {
  if (running) { worker.terminate(); running = false; boot(); if (message) log('Остановлено', 'log-muted'); }
  runUI(); persist();
}
function friendlyError(text) {
  const line = [...text.matchAll(/File "main\.ilpy", line (\d+)/g)].at(-1)?.[1];
  const error = text.split('\n').filter(s => /\w*Error:/.test(s)).at(-1) || text.split('\n').filter(Boolean).at(-1);
  return `${line ? 'Строка ' + line + '\n' : ''}${error}`;
}
function modal(title, body) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = body; $('#modal').showModal(); }
function confirmReplace(action) {
  if ($('#editor').value === lastProgram || !$('#editor').value.trim()) { action(); return; }
  modal('Заменить код?', '<p>Текущий код будет заменён. Его можно сначала скачать в .ilpy.</p><div class="modal-actions"><button id="cancelReplace" class="button">Отмена</button><button id="confirmReplace" class="button primary">Заменить</button></div>');
  $('#cancelReplace').onclick = () => $('#modal').close(); $('#confirmReplace').onclick = () => { $('#modal').close(); action(); };
}
function example(kind) {
  const b = selected(), init = `from ilboard import Board, sleep\n\nmain = Board(${quoted(b.name)}, size=${b.size})\n\n`;
  const examples = {
    letters: init + 'main.color("#2563eb")\n\nfor symbol in ["А", "Б", "В", "1", "2", "3"]:\n    main.text(symbol)\n    sleep(1)\n\nmain.text("♥")',
    rainbow: init + 'colors = ["#2563eb", "#8b5cf6", "#ef4444", "#f59e0b", "#22c55e"]\n\nwhile True:\n    for color in colors:\n        main.text("♥", color)\n        sleep(0.8)',
    buttons: init + 'while True:\n    if main.button("A"):\n        main.text("А", "#2563eb")\n    elif main.button("B"):\n        main.text("Б", "#ef4444")\n    else:\n        main.text("♥", "#2563eb")\n    sleep(0.05)',
    sensors: init + 'while True:\n    temperature = round(main.temperature())\n\n    if main.distance() < 25:\n        color = "#ef4444"\n    elif temperature > 30:\n        color = "#f59e0b"\n    else:\n        color = "#2563eb"\n\n    main.brightness(main.light())\n    main.number(temperature, color)\n    sleep(0.1)',
    scroll: init + 'main.color("#2563eb")\n\nwhile True:\n    main.scroll("ПРИВЕТ, ILBOARD!", speed=0.08)\n    sleep(0.5)'
  };
  if (kind === 'boards') {
    const configs = boards.map(b => ({ name: b.name, size: b.size }));
    for (let i = 2; configs.length < 4; i++) if (!configs.some(b => b.name === `board${i}`)) configs.push({ name: `board${i}`, size: 10 });
    return 'from ilboard import Board, sleep\n\n' + configs.map((b, i) => `b${i + 1} = Board(${quoted(b.name)}, size=${b.size})`).join('\n') + '\n\nboards = [b1, b2, b3, b4]\ncolors = ["#2563eb", "#8b5cf6", "#ef4444", "#22c55e"]\n\nwhile True:\n    for number, board in enumerate(boards):\n        board.number(number + 1, colors[number])\n    sleep(1)\n\n    for board in boards:\n        board.text("♥")\n    sleep(1)';
  }
  return examples[kind];
}
$('#boardSize').innerHTML = Array.from({ length: 16 }, (_, i) => `<option value="${i + 5}">${i + 5} × ${i + 5}</option>`).join('');
$('#boardTabs').onclick = e => { const t = e.target.closest('[data-tab]'); if (t) selectBoard(t.dataset.tab); };
$('#addBoard').onclick = addBoard;
$('#viewAll').onclick = () => { showAll = !showAll; renderTabs(); renderBoards(); persist(); };
function renameBoard(e) {
  const name = e.target.value.trim(), b = selected();
  if (!name || name.length > 24 || boards.some(other => other.id !== b.id && other.name === name)) { toast('Укажи уникальное имя платы'); e.target.value = b.name; return; }
  if (name === b.name) return;
  stop(false); syncDeclarations(b.name, name, b.size); b.name = name; renderTabs(); renderSettings(); renderBoards(); persist();
}
$('#boardName').onchange = renameBoard;
$('#boardName').onkeydown = e => { if (e.key === 'Enter') { renameBoard(e); e.target.blur(); } if (e.key === 'Escape') { e.target.value = selected().name; e.target.blur(); } };
$('#boardSize').onchange = e => { stop(false); const b = selected(); b.size = +e.target.value; b.pixels = Array(b.size ** 2).fill(null); syncDeclarations(b.name, b.name, b.size); renderBoards(); persist(); };
$('#clearBoard').onclick = () => { stop(false); selected().pixels.fill(null); schedulePaint(); };
$('#removeBoard').onclick = () => { if (boards.length <= 1) return; const b = selected(); modal('Удалить плату?', `<p>${esc(b.name)}</p><div class="modal-actions"><button id="cancelRemove" class="button">Отмена</button><button id="confirmRemove" class="button primary">Удалить</button></div>`); $('#cancelRemove').onclick = () => $('#modal').close(); $('#confirmRemove').onclick = () => { $('#modal').close(); stop(false); boards = boards.filter(item => item.id !== b.id); selectedId = boards[0].id; if (boards.length < 2) showAll = false; renderTabs(); renderSettings(); renderBoards(); persist(); }; };
for (const key of ['light', 'temperature', 'distance']) $(`#${key}`).oninput = e => { selected().inputs[key] = +e.target.value; sensorValue(key, +e.target.value); pushInputs(); scheduleSave(); };
$('#boardArea').onpointerdown = e => { const button = e.target.closest('[data-key]'); if (button) { e.preventDefault(); setButton(button.dataset.board, button.dataset.key, true); button.setPointerCapture(e.pointerId); } };
$('#boardArea').onpointerup = e => { const button = e.target.closest('[data-key]'); if (button) pulseButton(button.dataset.board, button.dataset.key); };
$('#boardArea').onpointercancel = e => { const button = e.target.closest('[data-key]'); if (button) setButton(button.dataset.board, button.dataset.key, false); };
$('#boardArea').onclick = e => {
  const pixel = e.target.closest('[data-index]'); if (!pixel || running) return;
  const b = boards.find(b => b.id === pixel.dataset.board); if (!b) return;
  const index = +pixel.dataset.index; b.pixels[index] = b.pixels[index] === null ? DEFAULT_COLOR : null; schedulePaint();
};
$('#boardArea').onkeydown = e => { const button = e.target.closest('[data-key]'); if (button && [' ', 'Enter'].includes(e.key) && !e.repeat) { e.preventDefault(); pulseButton(button.dataset.board, button.dataset.key); } };
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); run(); }
  if (e.shiftKey && e.key === 'Escape') stop();
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || $('#modal').open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['KeyA', 'KeyB'].includes(e.code) && !e.repeat) setButton(selectedId, e.code.at(-1), true);
});
document.addEventListener('keyup', e => { if (['KeyA', 'KeyB'].includes(e.code)) for (const b of boards) if (b.inputs[e.code.at(-1)]) pulseButton(b.id, e.code.at(-1)); });
window.addEventListener('blur', () => { for (const b of boards) for (const key of ['A', 'B']) setButton(b.id, key, false); });
$('#editor').oninput = () => { highlightCode(); scheduleSave(); };
$('#editor').onscroll = syncScroll; $('#editor').onclick = cursor; $('#editor').onkeyup = cursor;
$('#editor').onkeydown = e => {
  const el = e.target;
  if (e.key === 'Tab') {
    e.preventDefault(); const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) el.setRangeText('    ', start, end, 'end');
    else { const lineStart = el.value.lastIndexOf('\n', start - 1) + 1, chunk = el.value.slice(lineStart, end); const replacement = chunk.split('\n').map(line => e.shiftKey ? line.replace(/^ {1,4}/, '') : '    ' + line).join('\n'); el.setRangeText(replacement, lineStart, end, 'select'); }
    highlightCode(); scheduleSave();
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault(); const before = el.value.slice(0, el.selectionStart).split('\n').at(-1), indent = before.match(/^\s*/)[0] + (before.trimEnd().endsWith(':') ? '    ' : '');
    el.setRangeText('\n' + indent, el.selectionStart, el.selectionEnd, 'end'); highlightCode(); scheduleSave();
  }
};
$('#run').onclick = run; $('#stop').onclick = () => stop();
$('#clearConsole').onclick = () => $('#output').replaceChildren();
$('#toggleConsole').onclick = () => { const collapsed = $('.console').classList.toggle('collapsed'); $('#toggleConsole').ariaExpanded = !collapsed; $('#consoleChevron').textContent = collapsed ? '⌃' : '⌄'; };
$('#theme').onclick = () => theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
$('#examples').onchange = e => { const kind = e.target.value; e.target.value = ''; if (!kind) return; confirmReplace(() => { stop(false); setCode(example(kind)); if (kind === 'boards') { showAll = true; renderTabs(); renderBoards(); } }); };
$('#export').onclick = () => { const url = URL.createObjectURL(new Blob([$('#editor').value], { type: 'text/x-python;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'main.ilpy'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('#import').onclick = () => $('#file').click();
async function importFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.ilpy')) { toast('Выбери файл .ilpy'); return; }
  if (file.size > 1024 * 1024) { toast('Файл слишком большой'); return; }
  try { const code = await file.text(); stop(false); setCode(code.replace(/^\uFEFF/, '')); } catch { toast('Не удалось прочитать файл'); }
}
$('#file').onchange = e => { const file = e.target.files[0]; e.target.value = ''; importFile(file); };
$('#editor').addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
$('#editor').addEventListener('drop', e => { if (e.dataTransfer.files.length) { e.preventDefault(); importFile(e.dataTransfer.files[0]); } });
$('#closeModal').onclick = () => $('#modal').close(); $('#modal').onclick = e => { if (e.target === $('#modal')) $('#modal').close(); };
$('#api').onclick = () => modal('Python · ilboard', `<pre>from ilboard import Board, sleep\n\nmain = Board("main", size=10)\nmain.text("А", "#2563eb")\nsleep(1)</pre><table><tbody>${[
  ['Board("имя", size=10)', 'Создать плату или обратиться к существующей. До 4 плат; размер 5–20.'],
  ['main.pixel(x, y, color)', 'Цвет светодиода. Координаты от 0.'],
  ['main.fill(color) / main.clear()', 'Залить матрицу / погасить светодиоды.'],
  ['main.text("А") / main.number(42)', 'Буквы и цифры. Русский и английский алфавиты.'],
  ['main.scroll("ПРИВЕТ")', 'Бегущая строка. speed=0.09 задаёт паузу между кадрами.'],
  ['main.show(["010", "111", "010"])', 'Рисунок: 1 — включено, 0 — выключено.'],
  ['main.color("blue")', 'Цвет следующих команд. HEX, имя или (R, G, B).'],
  ['main.brightness(80)', 'Яркость: 0–100.'],
  ['main.button("A")', 'Нажата ли кнопка A или B.'],
  ['main.light()', 'Датчик света: 0–100.'],
  ['main.temperature()', 'Температура в градусах.'],
  ['main.distance()', 'Расстояние в сантиметрах.'],
  ['sleep(1)', 'Пауза в секундах.']
].map(([code, description]) => `<tr><td><code>${esc(code)}</code></td><td>${description}</td></tr>`).join('')}</tbody></table>`);
try {
  const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  if (data && Array.isArray(data.boards) && data.boards.length >= 1 && data.boards.length <= 4 && typeof data.code === 'string') {
    const names = new Set();
    for (const raw of data.boards) {
      if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 24 || names.has(raw.name) || !Number.isInteger(raw.size) || raw.size < 5 || raw.size > 20) throw Error('Invalid board');
      names.add(raw.name); const b = makeBoard(raw.name, raw.size); b.id = typeof raw.id === 'string' && /^[\w-]+$/.test(raw.id) ? raw.id : b.id;
      if (Array.isArray(raw.pixels) && raw.pixels.length === b.size ** 2) b.pixels = raw.pixels.map(c => c === null ? null : validColor(c));
      b.brightness = Number.isFinite(raw.brightness) ? Math.max(0, Math.min(100, raw.brightness)) : 100;
      for (const [key, min, max] of [['light', 0, 100], ['temperature', -20, 60], ['distance', 0, 200]]) if (Number.isFinite(raw.inputs?.[key])) b.inputs[key] = Math.max(min, Math.min(max, raw.inputs[key]));
      boards.push(b);
    }
    selectedId = boards.some(b => b.id === data.selectedId) ? data.selectedId : boards[0].id; showAll = Boolean(data.showAll) && boards.length > 1; $('#editor').value = data.code;
  }
} catch { boards = []; }
if (!boards.length) {
  boards = [makeBoard()]; selectedId = boards[0].id;
  const heart = ['0000000000', '0011001100', '0111111110', '0111111110', '0111111110', '0011111100', '0001111000', '0000110000', '0000000000', '0000000000'];
  boards[0].pixels = heart.join('').split('').map(p => p === '1' ? DEFAULT_COLOR : null);
  $('#editor').value = example('letters');
}
lastProgram = $('#editor').value;
let initialTheme = 'light'; try { const stored = localStorage.getItem('ilboard.theme'); if (stored === 'dark' || stored === 'light') initialTheme = stored; } catch {}
theme(initialTheme); highlightCode(); renderTabs(); renderSettings(); renderBoards(); boot();
window.addEventListener('beforeunload', persist);
