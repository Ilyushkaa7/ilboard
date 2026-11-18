const boards = new Map();
let python, busy = false;
self.bridge = (type, value) => {
  const data = JSON.parse(value);
  if (data.action === 'create' && !boards.has(data.name)) boards.set(data.name, { A: false, B: false, light: 70, temperature: 22, distance: 50 });
  postMessage({ type, value: data });
};
self.read_input = (name, key) => boards.get(name)?.[key] ?? 0;
async function boot() {
  try {
    importScripts('vendor/pyodide/pyodide.js');
    python = await loadPyodide({ indexURL: new URL('vendor/pyodide/', self.location.href).href });
    python.setStdout({ batched: value => postMessage({ type: 'stdout', value }) });
    python.setStderr({ batched: value => postMessage({ type: 'stderr', value }) });
    const [runtime, font] = await Promise.all([fetch('runtime.py').then(r => {if (!r.ok) throw Error('runtime.py');return r.text();}), fetch('font.json').then(r => r.text())]);
    await python.runPythonAsync(runtime);
    python.globals.set('_font_json', font);
    await python.runPythonAsync('FONT = json.loads(_font_json)');
    postMessage({ type: 'ready' });
  } catch (error) { postMessage({ type: 'load-error', value: String(error) }); }
}
onmessage = async ({ data }) => {
  if (data.type === 'input') {
    for (const board of data.boards) boards.set(board.name, board.inputs);
    return;
  }
  if (data.type !== 'run' || !python || busy) return;
  busy = true;
  try {
    boards.clear();
    for (const board of data.boards) boards.set(board.name, board.inputs);
    python.globals.set('_config_json', JSON.stringify(data.boards));
    python.globals.set('_source', data.code);
    await python.runPythonAsync('configure(_config_json)\nawait execute(_source)');
    postMessage({ type: 'done' });
  } catch (error) { postMessage({ type: 'error', value: String(error) }); }
  finally { busy = false; }
};
boot();
