"""Download the pinned browser Python runtime into this project's vendor folder."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen
import json

target = Path(__file__).resolve().parent / 'dist' / 'vendor' / 'pyodide'
target.mkdir(parents=True, exist_ok=True)
base = 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/'
files = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

def download(name):
    path = target / name
    if not path.exists():
        with urlopen(base + name, timeout=60) as response:
            data = response.read()
        if len(data) < 100:
            raise RuntimeError(f'Unexpected response: {name}')
        path.write_bytes(data)
    data = path.read_bytes()
    print(f'{name}: {len(data):,} bytes', flush=True)
    return name, {'bytes': len(data), 'sha256': sha256(data).hexdigest(), 'source': base + name}

with ThreadPoolExecutor(max_workers=5) as pool:
    manifest = dict(pool.map(download, files))
(target / 'manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
for name, url in {
    'LICENSE-PYODIDE.txt': 'https://raw.githubusercontent.com/pyodide/pyodide/0.27.7/LICENSE',
    'LICENSE-CPYTHON.txt': 'https://raw.githubusercontent.com/python/cpython/v3.12.7/LICENSE',
}.items():
    with urlopen(url, timeout=30) as response:
        (target / name).write_bytes(response.read())
