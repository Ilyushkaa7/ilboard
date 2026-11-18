import sys
import types
import asyncio
import json
import ast
import math
from js import bridge, read_input

FONT = {}
_boards = {}

def emit(action, **values):
    bridge('board', json.dumps(dict(action=action, **values)))

def _color(value):
    if value is None or value is False or value == 0:
        return None
    if isinstance(value, (tuple, list)) and len(value) == 3:
        return '#%02x%02x%02x' % tuple(max(0, min(255, int(c))) for c in value)
    if isinstance(value, str) and len(value) <= 64:
        return value
    raise ValueError('Цвет: имя, HEX или (R, G, B)')

class Board:
    def __init__(self, name='main', size=None):
        name = str(name).strip()
        if not name or len(name) > 24:
            raise ValueError('Имя платы: от 1 до 24 символов')
        if size is not None and (not isinstance(size, int) or not 5 <= size <= 20):
            raise ValueError('Размер матрицы: целое число от 5 до 20')
        if name not in _boards:
            if len(_boards) >= 4:
                raise ValueError('В проекте может быть не больше четырёх плат')
            _boards[name] = dict(size=size or 10, pixels=[None] * ((size or 10) ** 2), color='#2563eb', brightness=100)
            emit('create', name=name, size=size or 10)
        self.name = name
        if size is not None and size != self.size:
            self.resize(size)

    @property
    def _state(self):
        return _boards[self.name]

    @property
    def size(self):
        return self._state['size']

    @property
    def width(self):
        return self.size

    @property
    def height(self):
        return self.size

    def resize(self, size):
        if not isinstance(size, int) or not 5 <= size <= 20:
            raise ValueError('Размер матрицы: целое число от 5 до 20')
        self._state['size'] = size
        self._state['pixels'] = [None] * (size * size)
        emit('resize', name=self.name, size=size)

    def pixel(self, x, y, color=None):
        if not isinstance(x, int) or not isinstance(y, int):
            raise TypeError('Координаты светодиода должны быть целыми числами')
        if not (0 <= x < self.size and 0 <= y < self.size):
            raise ValueError(f'Координаты для этой платы: от 0 до {self.size - 1}')
        value = _color(self._state['color'] if color is None else color)
        self._state['pixels'][y * self.size + x] = value
        emit('pixel', name=self.name, x=x, y=y, color=value)

    set_pixel = pixel

    def get_pixel(self, x, y):
        if not (0 <= x < self.size and 0 <= y < self.size):
            raise ValueError('Светодиод за пределами матрицы')
        return self._state['pixels'][y * self.size + x]

    def color(self, color):
        self._state['color'] = _color(color)

    def fill(self, color=None):
        value = _color(self._state['color'] if color is None else color)
        self._state['pixels'] = [value] * (self.size ** 2)
        emit('fill', name=self.name, color=value)

    def clear(self):
        self._state['pixels'] = [None] * (self.size ** 2)
        emit('fill', name=self.name, color=None)

    def brightness(self, value):
        value = max(0, min(100, float(value)))
        self._state['brightness'] = value
        emit('brightness', name=self.name, value=value)

    def _frame(self, pixels):
        self._state['pixels'] = pixels
        emit('frame', name=self.name, pixels=pixels)

    def show(self, rows, color=None):
        if isinstance(rows, str):
            rows = rows.splitlines()
        if len(rows) > self.size or any(len(row) > self.size for row in rows):
            raise ValueError('Рисунок больше матрицы')
        value = _color(self._state['color'] if color is None else color)
        pixels = [None] * (self.size ** 2)
        ox = (self.size - max((len(r) for r in rows), default=0)) // 2
        oy = (self.size - len(rows)) // 2
        for y, row in enumerate(rows):
            for x, cell in enumerate(row):
                if str(cell) not in ('0', '.', ' ', 'False', 'None'):
                    pixels[(oy + y) * self.size + ox + x] = value
        self._frame(pixels)

    def _glyphs(self, value):
        return [FONT.get(c, FONT.get('?', ['00000'] * 7)) for c in str(value).upper()]

    def text(self, value, color=None):
        glyphs = self._glyphs(value)
        if not glyphs:
            return self.clear()
        raw_width = len(glyphs) * 6 - 1
        scale = max(1, min(2, self.size / raw_width, self.size / 7))
        width = max(1, min(self.size, round(raw_width * scale)))
        height = max(1, min(self.size, round(7 * scale)))
        ox, oy = (self.size - width) // 2, (self.size - height) // 2
        ink = _color(self._state['color'] if color is None else color)
        pixels = [None] * (self.size ** 2)
        for y in range(height):
            sy = round(y * 6 / max(1, height - 1))
            for x in range(width):
                sx = round(x * (raw_width - 1) / max(1, width - 1))
                glyph, column = divmod(sx, 6)
                if column < 5 and glyphs[glyph][sy][column] == '1':
                    pixels[(y + oy) * self.size + x + ox] = ink
        self._frame(pixels)

    number = text

    async def scroll(self, value, color=None, speed=0.09):
        glyphs = self._glyphs(value)
        ink = _color(self._state['color'] if color is None else color)
        height = min(7, self.size)
        oy = (self.size - height) // 2
        total = len(glyphs) * 6
        for offset in range(-self.size, total + 1):
            pixels = [None] * (self.size ** 2)
            for x in range(self.size):
                sx = x + offset
                if not 0 <= sx < total:
                    continue
                glyph, column = divmod(sx, 6)
                if column >= 5:
                    continue
                for y in range(height):
                    sy = round(y * 6 / max(1, height - 1))
                    if glyphs[glyph][sy][column] == '1':
                        pixels[(y + oy) * self.size + x] = ink
            self._frame(pixels)
            await sleep(speed)

    def button(self, key):
        key = str(key).upper()
        if key not in ('A', 'B'):
            raise ValueError('У платы есть кнопки A и B')
        return bool(read_input(self.name, key))

    def light(self):
        return float(read_input(self.name, 'light'))

    def temperature(self):
        return float(read_input(self.name, 'temperature'))

    def distance(self):
        return float(read_input(self.name, 'distance'))

async def sleep(seconds):
    await asyncio.sleep(max(0.001, float(seconds)))

async def _ilboard_tick():
    await asyncio.sleep(0.001)

ilboard = types.ModuleType('ilboard')
ilboard.Board = Board
ilboard.sleep = sleep
ilboard.wait = sleep
sys.modules['ilboard'] = ilboard

def configure(config):
    global _boards
    _boards = {}
    for b in json.loads(config):
        _boards[b['name']] = dict(size=b['size'], pixels=b.get('pixels', [None] * (b['size'] ** 2)), color='#2563eb', brightness=b.get('brightness', 100))

class Cooperative(ast.NodeTransformer):
    def __init__(self, async_functions, pause_names, pause_modules):
        self.async_functions = async_functions
        self.pause_names = pause_names
        self.pause_modules = pause_modules

    def visit_FunctionDef(self, node):
        node = self.generic_visit(node)
        if node.name in self.async_functions:
            return ast.copy_location(ast.AsyncFunctionDef(name=node.name, args=node.args, body=node.body, decorator_list=node.decorator_list, returns=node.returns, type_comment=node.type_comment), node)
        return node

    def visit_Await(self, node):
        # Explicit async code already contains its own awaits.
        return node

    def visit_Call(self, node):
        node = self.generic_visit(node)
        if is_pause(node, self.async_functions | self.pause_names, self.pause_modules):
            return ast.copy_location(ast.Await(value=node), node)
        return node

    def visit_While(self, node):
        node = self.generic_visit(node)
        tick = ast.Expr(value=ast.Await(value=ast.Call(func=ast.Name(id='_ilboard_tick', ctx=ast.Load()), args=[], keywords=[])))
        node.body.insert(0, ast.copy_location(tick, node))
        return node

    visit_For = visit_While

def is_pause(node, names, modules):
    if not isinstance(node, ast.Call):
        return False
    if isinstance(node.func, ast.Name):
        return node.func.id in names
    if isinstance(node.func, ast.Attribute):
        if node.func.attr == 'scroll':
            return True
        return isinstance(node.func.value, ast.Name) and node.func.value.id in modules and node.func.attr in ('sleep', 'wait')
    return False

async def execute(source):
    tree = ast.parse(source, filename='main.ilpy')
    pause_names, pause_modules = set(), set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module in ('ilboard', 'time'):
            for item in node.names:
                if item.name in ('sleep', 'wait'):
                    pause_names.add(item.asname or item.name)
                elif item.name == '*':
                    pause_names.update(('sleep', 'wait'))
        if isinstance(node, ast.Import):
            for item in node.names:
                if item.name in ('ilboard', 'time'):
                    pause_modules.add(item.asname or item.name)
    functions = [n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    async_functions = set()
    for _ in range(len(functions) + 1):
        changed = False
        for fn in functions:
            if fn.name not in async_functions and any(isinstance(n, (ast.For, ast.While)) or is_pause(n, async_functions | pause_names, pause_modules) for n in ast.walk(fn)):
                if fn.name == '__init__':
                    raise SyntaxError('Паузы и циклы в __init__ пока не поддерживаются')
                async_functions.add(fn.name)
                changed = True
        if not changed:
            break
    tree = ast.fix_missing_locations(Cooperative(async_functions, pause_names, pause_modules).visit(tree))
    code = compile(tree, 'main.ilpy', 'exec', flags=ast.PyCF_ALLOW_TOP_LEVEL_AWAIT)
    scope = {'__name__': '__main__', '_ilboard_tick': _ilboard_tick}
    # time.sleep is asynchronous inside this teaching environment.
    original_sleep = sys.modules['time'].sleep
    sys.modules['time'].sleep = sleep
    try:
        result = eval(code, scope)
        if result is not None:
            await result
    finally:
        sys.modules['time'].sleep = original_sleep
