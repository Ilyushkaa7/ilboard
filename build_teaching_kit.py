from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import textwrap

root = Path(__file__).resolve().parent
examples = {
'01_first_pixels': '''
from ilboard import Board

main = Board("main", size=10)
main.clear()
main.pixel(2, 2, "#2563eb")
main.pixel(7, 2, "#2563eb")
main.pixel(2, 6, "#22c55e")
main.pixel(3, 7, "#22c55e")
main.pixel(4, 7, "#22c55e")
main.pixel(5, 7, "#22c55e")
main.pixel(6, 7, "#22c55e")
main.pixel(7, 6, "#22c55e")
''',
'02_colors_and_variables': '''
from ilboard import Board, sleep

main = Board("main", size=10)
warm = "#f97316"
cold = "#2563eb"
delay = 1

main.fill(warm)
sleep(delay)
main.fill(cold)
sleep(delay)
main.brightness(50)
main.text("А", cold)
''',
'03_animation': '''
from ilboard import Board, sleep

main = Board("main", size=10)
main.text("1", "#2563eb")
sleep(1)
main.text("2", "#8b5cf6")
sleep(1)
main.text("3", "#22c55e")
sleep(1)
main.text("♥", "#ef4444")
''',
'04_loops': '''
from ilboard import Board, sleep

main = Board("main", size=10)
main.clear()

for x in range(main.size):
    main.clear()
    main.pixel(x, 4, "#2563eb")
    sleep(0.15)

for y in range(main.size):
    for x in range(main.size):
        main.pixel(x, y, "#22c55e")
    sleep(0.08)
''',
'05_buttons': '''
from ilboard import Board, sleep

main = Board("main", size=10)

while True:
    if main.button("A") and main.button("B"):
        main.text("♥", "#8b5cf6")
    elif main.button("A"):
        main.text("А", "#2563eb")
    elif main.button("B"):
        main.text("Б", "#ef4444")
    else:
        main.text("?", "#f59e0b")
    sleep(0.05)
''',
'06_sensors': '''
from ilboard import Board, sleep

main = Board("main", size=10)

while True:
    temperature = round(main.temperature())
    if main.distance() < 25:
        color = "#ef4444"
    elif temperature > 30:
        color = "#f97316"
    else:
        color = "#2563eb"
    main.brightness(main.light())
    main.number(temperature, color)
    sleep(0.1)
''',
'07_counter': '''
from ilboard import Board, sleep

main = Board("main", size=10)
count = 0
was_a = False

while True:
    pressed_a = main.button("A")
    if pressed_a and not was_a:
        count = min(99, count + 1)
    if main.button("B"):
        count = 0
    was_a = pressed_a
    main.number(count, "#2563eb")
    sleep(0.03)
''',
'08_functions': '''
from ilboard import Board, sleep

main = Board("main", size=10)

def cross(board, color):
    board.clear()
    middle = board.size // 2
    for i in range(board.size):
        board.pixel(i, middle, color)
        board.pixel(middle, i, color)

cross(main, "#2563eb")
sleep(1)
cross(main, "#ef4444")
sleep(1)
cross(main, "#22c55e")
''',
'09_lists': '''
from ilboard import Board, sleep

main = Board("main", size=10)
colors = ["#2563eb", "#8b5cf6", "#ef4444"]
frames = [
    ["00100", "01110", "11111", "00100", "00100"],
    ["00100", "00110", "11111", "00110", "00100"],
    ["00100", "00100", "11111", "01110", "00100"],
]

while True:
    for frame, color in zip(frames, colors):
        main.show(frame, color)
        sleep(0.5)
''',
'10_random_game': '''
from ilboard import Board, sleep
import random

main = Board("main", size=10)
target = random.randrange(main.size)
cursor = 0
was_a = False
was_b = False

while True:
    a = main.button("A")
    b = main.button("B")
    if a and not was_a:
        cursor = (cursor + 1) % main.size
    if b and not was_b:
        if cursor == target:
            main.text("♥", "#22c55e")
            target = random.randrange(main.size)
        else:
            main.text("X", "#ef4444")
        sleep(0.7)
    was_a, was_b = a, b
    main.clear()
    main.pixel(target, 1, "#f59e0b")
    main.pixel(cursor, main.size - 2, "#2563eb")
    sleep(0.03)
''',
'11_multiple_boards': '''
from ilboard import Board, sleep

main = Board("main", size=10)
temperature = Board("board2", size=10)
light = Board("board3", size=10)
alarm = Board("display", size=10)

while True:
    temperature.number(round(temperature.temperature()), "#f97316")
    light.number(round(light.light()), "#2563eb")
    if alarm.distance() < 25:
        alarm.text("!", "#ef4444")
        main.text("!", "#ef4444")
    else:
        alarm.text("О", "#22c55e")
        main.text("♥", "#22c55e")
    sleep(0.1)
''',
'12_final_project': '''
from ilboard import Board, sleep
import random
import time

main = Board("main", size=10)
scoreboard = Board("board2", size=10)
score = 0

# Игра на реакцию. Нажми ту кнопку, которую показывает плата.
# Измени правила и оформление для собственного проекта.
for round_number in range(5):
    main.clear()
    scoreboard.number(score, "#2563eb")
    while main.button("A") or main.button("B"):
        sleep(0.02)
    sleep(random.uniform(0.5, 1.5))
    target = random.choice(["A", "B"])
    main.text(target, "#2563eb")
    start = time.monotonic()
    while not main.button("A") and not main.button("B"):
        if time.monotonic() - start > 4:
            break
        sleep(0.02)
    if main.button(target):
        score = score + 1
        main.text("♥", "#22c55e")
    else:
        main.text("X", "#ef4444")
    scoreboard.number(score, "#2563eb")
    sleep(0.7)

main.scroll("СЧЁТ " + str(score), speed=0.08)
'''
}
example_dir = root / 'materials' / 'examples'
example_dir.mkdir(parents=True, exist_ok=True)
for name, code in examples.items():
    (example_dir / (name + '.ilpy')).write_text(textwrap.dedent(code).strip() + '\n', encoding='utf-8')

starter = '@echo off\r\ncd /d "%~dp0"\r\necho ilboard - http://127.0.0.1:4173/\r\necho Keep this window open. Close it to stop ilboard.\r\npython -m http.server 4173 --bind 127.0.0.1 --directory app\r\npause\r\n'
archive = root.parent / 'ilboard-teaching-kit.zip'
with ZipFile(archive, 'w', compression=ZIP_DEFLATED, compresslevel=6) as package:
    for file in (root / 'dist').rglob('*'):
        if file.is_file() and '__pycache__' not in file.parts:
            package.write(file, 'ilboard/app/' + file.relative_to(root / 'dist').as_posix())
    package.write(root / 'materials/ilboard-guide.md', 'ilboard/README.md')
    syntax = (root / 'ILBOARD_SYNTAX.md').read_text(encoding='utf-8')
    syntax = syntax.replace('(materials/ilboard-guide.md)', '(README.md)').replace('(materials/examples/)', '(examples/)')
    package.writestr('ilboard/ILBOARD_SYNTAX.md', syntax)
    for file in sorted(example_dir.glob('*.ilpy')):
        package.write(file, 'ilboard/examples/' + file.name)
    package.writestr('ilboard/START.cmd', starter.encode('ascii'))
print(f'{archive}: {archive.stat().st_size:,} bytes; {len(examples)} examples')
