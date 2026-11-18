"""Integration checks for the runtime actually loaded by the browser."""
import asyncio
import json
import pathlib
import sys
import types

root = pathlib.Path(__file__).parent
events = []
inputs = {'main': {'A': True, 'B': False, 'light': 70, 'temperature': 22, 'distance': 50}}
js = types.ModuleType('js')
js.bridge = lambda kind, value: events.append(json.loads(value))
js.read_input = lambda name, key: inputs.get(name, {}).get(key, 0)
sys.modules['js'] = js
scope = {}
exec((root / 'dist/runtime.py').read_text(encoding='utf-8'), scope)
scope['FONT'] = json.loads((root / 'dist/font.json').read_text(encoding='utf-8'))
scope['configure'](json.dumps([{'name': 'main', 'size': 10}]))

async def check(code):
    await asyncio.wait_for(scope['execute'](code), timeout=5)

async def main():
    await check('''from ilboard import Board, sleep
b = Board("main")
b.pixel(2, 3, (255, 100, 0))
assert b.get_pixel(2, 3) == '#ff6400'
assert b.button('A') and not b.button('B')
assert b.light() == 70 and b.temperature() == 22 and b.distance() == 50
b.fill('red')
assert b.get_pixel(9, 9) == 'red'
b.clear()
assert b.get_pixel(9, 9) is None
''')
    print('PASS pixels, colors, fill, clear, buttons and sensors')
    for size in (5, 10, 20):
        scope['configure'](json.dumps([{'name': 'main', 'size': size}]))
        for letter in '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ♥':
            await check(f'from ilboard import Board\nBoard("main").text({letter!r})')
            assert any(scope['_boards']['main']['pixels']), (size, letter)
        assert len(scope['_boards']['main']['pixels']) == size ** 2
    print('PASS all Latin/Cyrillic letters and numbers at 5x5, 10x10, 20x20')
    scope['configure'](json.dumps([{'name': 'main', 'size': 5}]))
    await check('from ilboard import Board\nBoard("main").text("А")')
    pixels = scope['_boards']['main']['pixels']
    assert all(pixels[10:15]), '5x5 A must retain the full crossbar'
    assert pixels[20] and pixels[24], '5x5 A must retain both sides'
    await check('''from ilboard import Board, sleep
a = Board("main", size=5)
b = Board("second", size=20)
c = Board("third")
d = Board("fourth")
a.text("А", "red")
b.text("Б", "blue")
c.number(3)
d.text("Г")
assert a.size == 5 and b.size == 20
try:
    Board("fifth")
    assert False, 'must reject fifth board'
except ValueError:
    pass
for size in (4, 21, 5.5):
    try:
        a.resize(size)
        assert False, 'must reject invalid size'
    except ValueError:
        pass
try:
    a.pixel(5, 0)
    assert False, 'must reject invalid pixel'
except ValueError:
    pass
''')
    print('PASS four independent boards and bounds')
    await check('''from ilboard import Board, sleep
def double(x):
    return x * 2
assert list(map(double, [1, 2])) == [2, 4]
def draw():
    for x in range(5):
        Board("main").pixel(x, 0, 'blue')
        sleep(0.001)
draw()
import time
time.sleep(0.001)
from time import sleep as pause
pause(0.001)
''')
    print('PASS normal Python functions, loops, cooperative pauses and aliases')
    await check('''from ilboard import Board
b = Board("main")
b.show(["010", "111", "010"], '#22c55e')
b.scroll("А1", speed=0.001)
''')
    assert any(event['action'] == 'frame' for event in events)
    print('PASS bitmap and asynchronous scrolling')
    task = asyncio.create_task(scope['execute']('from ilboard import Board\nwhile True:\n    Board("main").text("А")'))
    await asyncio.sleep(0.02)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    print('PASS infinite loop yields and can be cancelled')
    lessons = sorted((root / 'materials/examples').glob('*.ilpy'))
    for lesson in lessons:
        scope['configure'](json.dumps([{'name': 'main', 'size': 10}]))
        events.clear()
        try:
            await asyncio.wait_for(scope['execute'](lesson.read_text(encoding='utf-8')), timeout=0.08)
        except asyncio.TimeoutError:
            pass
        assert events, f'{lesson.name}: no board commands'
    print(f'PASS all {len(lessons)} teaching examples start and update boards')

asyncio.run(main())
