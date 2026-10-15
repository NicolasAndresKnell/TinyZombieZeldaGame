"""Turns assets/source/level_map.png (a colour-coded city plan) into the game level.

Steps:
  1. Split the image into 8x8-pixel cells; each cell becomes one 16x16 game tile.
  2. Classify every cell by colour (street, grass, roof L1/L2/L3, stairs, water...).
  3. Fix up by shape: dark areas are streets, building walls or blocks depending on
     what they touch; thin grey strips between roofs are bridges.
  4. Check which tiles the player can actually reach from the start.
  5. Place props, trees, zombies and brains, then bake the ground into one picture.

Run: python3 tools/level.py   (writes src/data/level.json, public/assets/level_*.png and a preview in tools/out/)
"""
import os, json, random
import numpy as np
from PIL import Image
from scipy import ndimage as nd
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
CELL = 8          # source pixels per tile
T = 16            # game pixels per tile
random.seed(7)

# Tile kinds (one letter each, stored in the level string)
#   S street  P paving  A lot  G grass  W water  B building wall  K block
#   1 2 3 roofs   T stairs   M ramp   R bridge (street underneath)
HEIGHT = {'S': 0, 'P': 0, 'A': 0, 'G': 0, 'R': 0, '1': 1, '2': 2, '3': 3}
SOLID = set('WBK')


# ---------------------------------------------------------------- 1-2 classify
def classify_pixels(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    lum = (r + g + b) / 3
    sat = a.max(-1) - a.min(-1)
    cls = np.full(r.shape, 'n', '<U1')                       # neutral grey
    cls[lum < 100] = 'd'                                     # dark
    cls[(sat < 30) & (lum >= 185)] = 'x'                     # white (crosswalks, text)
    cls[(r > 150) & (r > b + 25) & (sat >= 25)] = 'P'        # beige paving
    cls[(g > r + 12) & (g > b + 25)] = 'G'                   # grass
    cls[(g > r + 30) & (b > r + 30) & (abs(g - b) < 28)] = '1'   # teal roof
    cls[(b > r + 35) & (b > g + 20) & (r >= 58)] = '2'       # blue roof
    cls[(b > g + 25) & (r > g + 8) & (lum > 110)] = '3'      # purple roof
    cls[(r < 58) & (b > 80) & (b > r + 35)] = 'W'            # water
    cls[(r > g + 40) & (r > 130) & (g > b)] = 'T'            # orange stairs
    return cls

def classify_cells(img):
    a = np.array(img.convert('RGB')).astype(int)
    H, W = a.shape[0] // CELL, a.shape[1] // CELL
    pix = classify_pixels(a[:H * CELL, :W * CELL])
    grid = np.empty((H, W), '<U1')
    for y in range(H):
        for x in range(W):
            block = pix[y * CELL:(y + 1) * CELL, x * CELL:(x + 1) * CELL].ravel()
            vals, counts = np.unique(block, return_counts=True)
            frac = dict(zip(vals, counts / block.size))
            if frac.get('T', 0) > 0.3: grid[y, x] = 'T'; continue
            grid[y, x] = vals[np.argmax(counts)]
    return grid


# ---------------------------------------------------------------- 3 fix shapes
N4 = [(0, 1), (1, 0), (0, -1), (-1, 0)]

def comps(mask):
    lab, n = nd.label(mask)
    return lab, n

def neighbours_of(lab_mask, grid):
    """Classes found on the 4-neighbour ring around a component mask."""
    ring = nd.binary_dilation(lab_mask) & ~lab_mask
    return grid[ring]

def smooth_ground(grid, passes=2):
    """Remove single-cell noise between grass, paving and lots."""
    H, W = grid.shape
    for _ in range(passes):
        g = grid.copy()
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                k = grid[y, x]
                if k not in 'PAGn': continue
                nb = [grid[y + dy, x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
                same = sum(1 for v in nb if v == k)
                if same <= 2:
                    vals, counts = np.unique([v for v in nb if v in 'PAG'], return_counts=True)
                    if len(vals) and counts.max() >= 5: g[y, x] = vals[np.argmax(counts)]
        grid = g
    return grid

def fix_shapes(grid):
    grid = smooth_ground(grid)
    H, W = grid.shape
    roofs = np.isin(grid, list('123'))

    # Neutral/white specks inside a single roof (labels "L1", rims) become that roof.
    for c in 'nx':
        lab, n = comps(grid == c)
        for i in range(1, n + 1):
            m = lab == i
            nb = neighbours_of(m, grid)
            nb = nb[nb != c]
            if len(nb) == 0: continue
            vals, counts = np.unique(nb, return_counts=True)
            top = vals[np.argmax(counts)]
            if top in '123' and counts.max() / len(nb) > 0.6:
                grid[m] = top
    roofs = np.isin(grid, list('123'))

    # Bridges: thin grey strips that touch roofs only at their ends.
    lab, n = comps(grid == 'n')
    for i in range(1, n + 1):
        m = lab == i
        ys, xs = np.where(m)
        h, w = np.ptp(ys) + 1, np.ptp(xs) + 1
        length = max(h, w)
        thick = m.sum() / length          # average thickness, robust to small branches
        touch = (nd.binary_dilation(m) & roofs).sum()
        if thick <= 3 and length >= 5 and touch <= 2 * thick + 4:
            grid[m] = 'R'
        else:
            nb = neighbours_of(m, grid)
            grid[m] = 'S' if (nb == 'd').mean() > 0.6 else 'A'   # crosswalk or grey lot
    grid[grid == 'x'] = 'P'

    # Dark areas: the big network is street; pieces touching roofs/stairs are buildings;
    # the rest are blocks (cars, containers).
    roofs_or_stairs = np.isin(grid, list('123T'))
    lab, n = comps(grid == 'd')
    sizes = nd.sum(np.ones_like(lab), lab, range(1, n + 1))
    for i in range(1, n + 1):
        m = lab == i
        if sizes[i - 1] > 1500: grid[m] = 'S'
        elif (nd.binary_dilation(m) & roofs_or_stairs).any(): grid[m] = 'B'
        elif sizes[i - 1] > 60: grid[m] = 'S'
        else: grid[m] = 'K'

    # Stairs need something to connect: keep only stair pieces that touch a roof.
    lab, n = comps(grid == 'T')
    for i in range(1, n + 1):
        m = lab == i
        if not (nd.binary_dilation(m) & np.isin(grid, list('123'))).any():
            grid[m] = 'B'

    extend_bridges(grid)

    # Bridges one tile thick are hard to walk on; thicken them by one tile.
    lab, n = comps(grid == 'R')
    for i in range(1, n + 1):
        m = lab == i
        ys, xs = np.where(m)
        if np.ptp(ys) == 0:       # horizontal, 1 tall → add the row below
            below = np.zeros_like(m); below[1:] = m[:-1]
            grid[below & np.isin(grid, list('SPAGBK'))] = 'R'
        elif np.ptp(xs) == 0:     # vertical, 1 wide → add the column to the right
            right = np.zeros_like(m); right[:, 1:] = m[:, :-1]
            grid[right & np.isin(grid, list('SPAGBK'))] = 'R'
    keep_real_bridges(grid)
    grid = tidy_buildings(grid)
    grid = single_line_stairs(grid)
    grid = add_ramps(grid)
    grid = tidy_buildings(grid)          # carving stairs and ramps can leave slivers
    # a staircase that no longer reaches a roof is just pavement
    lab, n = comps(grid == 'T')
    for i in range(1, n + 1):
        m = lab == i
        if not (nd.binary_dilation(m) & np.isin(grid, list('123'))).any(): grid[m] = 'P'
    close_bridge_gaps(grid)
    extend_bridges(grid, through='BPAGS', max_len=6)     # walls were tidied: reach the roof again
    # a bridge must join two separate places; otherwise it goes back to street/pavement
    # (the real bridges were picked out before tidying, see keep_real_bridges)
    lab, n = comps(grid == 'R')
    for i in range(1, n + 1):
        m = lab == i
        if not joins_two_places(grid, m):
            nb = neighbours_of(m, grid)
            grid[m] = 'S' if (nb == 'S').mean() > 0.4 else 'P'
    # building slivers left by all the carving go back to pavement
    building = np.isin(grid, list('B123'))
    grid[(grid == 'B') & ~nd.binary_opening(building, structure=BLOCK)] = 'P'
    return grid


def extend_bridges(grid, through='B', max_len=4):
    H, W = grid.shape
    # A bridge that stops at a building wall continues through it to the roof (max 4 tiles).
    lab, n = comps(grid == 'R')
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        horizontal = np.ptp(xs) >= np.ptp(ys)
        rows = sorted(set(ys)) if horizontal else sorted(set(xs))
        for r in rows:
            line = xs[ys == r] if horizontal else ys[xs == r]
            for end, step in ((line.min(), -1), (line.max(), 1)):
                path, pos = [], end + step
                for _ in range(max_len):
                    cell = (r, pos) if horizontal else (pos, r)
                    if not (0 <= cell[0] < H and 0 <= cell[1] < W): break
                    k = grid[cell]
                    if k in '123':
                        for c in path: grid[c] = 'R'
                        break
                    if k not in through: break
                    path.append(cell); pos += step



def close_bridge_gaps(grid):
    """Bridges cross streets that show through in the plan: fill gaps of up to 3 tiles
    along a bridge's direction."""
    r = grid == 'R'
    closed = nd.binary_closing(r, structure=np.ones((1, 5), bool)) | nd.binary_closing(r, structure=np.ones((5, 1), bool))
    grid[closed & ~r & np.isin(grid, list('SPAG'))] = 'R'

def joins_two_places(grid, m):
    """Does bridge mask m touch two separate buildings or two separate roof pieces?"""
    ring = nd.binary_dilation(m)
    buildings, _ = comps(np.isin(grid, list('B123')))
    places = set(('b', v) for v in np.unique(buildings[ring & (buildings > 0)]))
    for k in '123':
        roofs, _ = comps(grid == k)
        places |= set((k, v) for v in np.unique(roofs[ring & (roofs > 0)]))
    return len([p for p in places if p[0] != 'b']) >= 2 or len([p for p in places if p[0] == 'b']) >= 2

def keep_real_bridges(grid):
    """Grey strips that join two different buildings are bridges; other grey strips
    (roof rims, ledges) were misread and go back to street or pavement."""
    close_bridge_gaps(grid)
    lab, n = comps(grid == 'R')
    for i in range(1, n + 1):
        m = lab == i
        if not joins_two_places(grid, m):
            nb = neighbours_of(m, grid)
            grid[m] = 'S' if (nb == 'S').mean() > 0.4 else 'P'

# ---------------------------------------------------------------- 3b building rules
BLOCK = np.ones((5, 5), bool)     # buildings (and each roof level) are at least 5x5 tiles

def tidy_buildings(grid):
    """No lonely building tiles: everything that's part of a building must sit inside
    a solid 5x5 block. Slivers that don't fit become pavement; roof pieces thinner than
    3x3 drop to the level below."""
    # Roofs need a front wall: where a roof's south edge meets open ground, add a
    # facade (1 row for L1, 2 for taller roofs) so every building reads as a box.
    H, W = grid.shape
    connectors = nd.binary_dilation(np.isin(grid, list('TMR')))
    add = []
    for y in range(H - 1):
        for x in range(W):
            k = grid[y, x]
            if k not in '123' or grid[y + 1, x] in 'B123': continue
            rows = 1 if k == '1' else 2
            cells = [(y + 1 + i, x) for i in range(rows) if y + 1 + i < H]
            if all(grid[c] in 'PAG' and not connectors[c] for c in cells): add += cells
    for c in add: grid[c] = 'B'
    building = np.isin(grid, list('B123'))
    solid = nd.binary_opening(building, structure=BLOCK)
    grid[building & ~solid] = 'P'
    for k, lower in (('3', '2'), ('2', '1'), ('1', 'B')):
        level = np.isin(grid, [c for c in '123' if c >= k])
        keep = nd.binary_opening(level, structure=np.ones((3, 3), bool))   # no stray roof tiles
        grid[(grid == k) & ~keep] = lower
    return grid

def walkable_ground(k): return HEIGHT.get(k) == 0 and k not in 'TRM'

def single_line_stairs(grid):
    """Every staircase becomes one straight line, one tile wide, from the ground up to
    a roof, and no two staircases touch. Leftover stair tiles go back to wall or ground."""
    H, W = grid.shape
    inside = nd.binary_opening(np.isin(grid, list('B123T')), structure=BLOCK)
    lab, n = comps(grid == 'T')
    old = grid == 'T'
    grid[old] = np.where(inside[old], 'B', 'P')
    taken = np.zeros_like(old)
    def at(y, x): return grid[y, x] if 0 <= y < H and 0 <= x < W else 'W'
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        best = None
        # try each column (climbing up/down) and each row (climbing left/right) of the piece
        for vertical in (True, False):
            lines = sorted(set(xs)) if vertical else sorted(set(ys))
            for c in lines:
                for step in (-1, 1):     # direction from the ground towards the roof
                    cells = sorted(ys[xs == c]) if vertical else sorted(xs[ys == c])
                    if not cells: continue
                    # walk from the ground end through stairs/wall until a roof
                    start = cells[0] if step == 1 else cells[-1]
                    pos = start
                    path = []
                    while True:
                        cell = (pos, c) if vertical else (c, pos)
                        k = at(*cell)
                        if k in '123': break
                        if k not in 'BP' or len(path) > 6: path = None; break
                        path.append(cell); pos += step
                    if not path: continue
                    before = (start - step, c) if vertical else (c, start - step)
                    if not walkable_ground(at(*before)): continue
                    if best is None or len(path) < len(best): best = path
        if best is None: continue
        ring = np.zeros_like(old)
        for (y, x) in best: ring[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = True
        if (ring & taken).any(): continue                 # another staircase right next to it
        for cell in best: grid[cell] = 'T'; taken[cell] = True
    return grid

def add_ramps(grid, width=3, apron=2):
    """Ramps: 3 tiles wide, from an L1 roof edge down through the wall and out onto the
    ground (apron tiles). One per building that has room for it."""
    H, W = grid.shape
    def at(y, x): return grid[y, x] if 0 <= y < H and 0 <= x < W else 'W'
    blocks, n = comps(np.isin(grid, list('B123')))
    near_stairs = nd.binary_dilation(grid == 'T', iterations=2)
    for b in range(1, n + 1):
        ys, xs = np.where((blocks == b) & (grid == '1'))
        if len(ys) == 0: continue
        best = None
        for (dy, dx) in ((1, 0), (-1, 0), (0, 1), (0, -1)):        # direction away from the roof
            for y, x in zip(ys, xs):
                # the ramp's three lanes sit side by side, across the direction of travel
                lanes = [(y + dx * j, x + dy * j) for j in range(width)]
                if not all(at(*l) == '1' for l in lanes): continue
                cells, ok = [], True
                for (ly, lx) in lanes:
                    cy, cx, wall = ly + dy, lx + dx, 0
                    while at(cy, cx) == 'B' and wall < 5: cells.append((cy, cx)); cy += dy; cx += dx; wall += 1
                    if wall == 0: ok = False; break
                    for a in range(apron):
                        if not walkable_ground(at(cy, cx)): ok = False; break
                        cells.append((cy, cx)); cy += dy; cx += dx
                    if not ok or not walkable_ground(at(cy, cx)): ok = False; break
                if not ok or any(near_stairs[c] for c in cells): continue
                if best is None or len(cells) < len(best[0]): best = (cells, (dy, dx))
        if best:
            cells, d = best
            for c in cells: grid[c] = 'M'
            near_stairs |= nd.binary_dilation(grid == 'M', iterations=3)
    return grid


# ---------------------------------------------------------------- 4 reachability
def step_ok(grid, a, b, level):
    """Can a walker at `level` standing on tile a step onto tile b? Returns new level or None.
    Mirrors canEnter() in src/world/terrain.ts."""
    kb, ka = grid[b], grid[a]
    if kb in SOLID: return None
    if kb in 'TMR': return level                    # stairs/ramp/bridge: keep level
    hb = HEIGHT[kb]
    if ka in 'TM': return hb                        # leaving stairs or a ramp: any height
    if ka == 'R' and level >= 1: return hb if hb >= 1 else None
    return hb if hb == level else None

def reachable(grid, start):
    H, W = grid.shape
    seen = {(start, 0)}
    q = deque(seen)
    while q:
        (y, x), lv = q.popleft()
        for dy, dx in N4:
            ny, nx = y + dy, x + dx
            if not (0 <= ny < H and 0 <= nx < W): continue
            nl = step_ok(grid, (y, x), (ny, nx), lv)
            if nl is None or ((ny, nx), nl) in seen: continue
            seen.add(((ny, nx), nl)); q.append(((ny, nx), nl))
    return seen


# ---------------------------------------------------------------- 5 art
def load_rgba(path): return Image.open(path).convert('RGBA')

def bake(grid, tiles, props_img):
    """Draw every tile into one big picture, plus a separate bridge layer."""
    H, W = grid.shape
    ground = Image.new('RGBA', (W * T, H * T))
    bridge = Image.new('RGBA', (W * T, H * T), (0, 0, 0, 0))
    def tile(i): return tiles.crop((i * T, 0, i * T + T, T))
    asphalt = [tile(1 + i) for i in range(4)]
    sand = [tile(5 + i) for i in range(4)]
    raw_asphalt = list(asphalt)
    def tiles_for(kind): return raw_asphalt
    paving = [tile(9 + i) for i in range(9)]
    grass_src = tile(0)

    def recolor(src, base, dark, light):
        """Re-tint a speckled tile: keeps its pattern, swaps its colours."""
        a = np.array(src).astype(int)
        lum = a[..., :3].mean(-1); mid = np.median(lum)
        out = np.zeros_like(a); out[..., 3] = 255
        out[..., :3] = base
        out[lum < mid - 8, :3] = dark
        out[lum > mid + 8, :3] = light
        return Image.fromarray(out.astype(np.uint8), 'RGBA')

    # Terrain palette: the same hues as before, lifted and softened so the darker,
    # more saturated sprites stand out on top of it.
    roof_cols = {'1': ((128, 184, 172), (114, 168, 158), (146, 200, 186)),
                 '2': ((130, 146, 186), (116, 130, 170), (150, 164, 202)),
                 '3': ((176, 156, 204), (160, 140, 188), (194, 176, 220))}
    roof = {k: [recolor(asphalt[i], *c) for i in range(4)] for k, c in roof_cols.items()}
    grass = [recolor(sand[i], (150, 176, 118), (136, 162, 106), (164, 190, 130)) for i in range(4)]
    asphalt = [recolor(asphalt[i], (124, 122, 136), (112, 110, 124), (138, 136, 150)) for i in range(4)]
    lot = [recolor(lot_src, (176, 168, 166), (162, 154, 154), (190, 182, 180)) for lot_src in tiles_for('lot')]
    water = [recolor(w, (92, 150, 178), (80, 134, 162), (122, 176, 200)) for w in tiles_for('lot')]
    rim = (226, 206, 190)          # the light rim colour of the tileset's rooftop
    rim_dark = (150, 128, 120)

    def wall_tile(x, y):
        im = Image.new('RGBA', (T, T), (64, 66, 80, 255)); px = im.load()
        for i in range(T): px[i, T - 1] = (40, 40, 52, 255)            # base line
        if x % 2 == 0:                                                   # windows
            for yy in range(4, 11):
                for xx in range(4, 12): px[xx, yy] = (126, 170, 196, 255)
            for xx in range(4, 12): px[xx, 4] = (176, 210, 226, 255)
            for yy in range(4, 11): px[11, yy] = (90, 120, 140, 255)
        return im
    def flat_wall(x, y):
        return recolor(asphalt[(y % 2) * 2 + x % 2], (58, 60, 72), (48, 50, 62), (72, 74, 88))
    def stairs_tile(x, y):
        # warm concrete steps (no neon orange): dark step edges, light treads
        vertical = at(y - 1, x) in 'T123' or at(y + 1, x) in 'T123' and at(y, x - 1) not in '123'
        im = Image.new('RGBA', (T, T), (176, 150, 128, 255)); px = im.load()
        for i in range(0, T, 4):
            for j in range(T):
                a, b = ((j, i), (j, i + 1)) if vertical else ((i, j), (i + 1, j))
                px[a] = (110, 90, 80, 255); px[b] = (206, 186, 166, 255)
        for j in range(T):
            e1, e2 = ((0, j), (T - 1, j)) if vertical else ((j, 0), (j, T - 1))
            px[e1] = px[e2] = (96, 78, 72, 255)
        return im

    def ramp_tile(x, y):
        # street surface with yellow-black hazard strips on the ramp's outer sides
        vertical = at(y - 1, x) in 'M123B' and at(y + 1, x) not in '123B' or at(y + 1, x) == 'M' or at(y - 1, x) == 'M'
        if at(y, x - 1) == 'M' and at(y, x + 1) == 'M': vertical = True
        im = raw_asphalt[(y % 2) * 2 + x % 2].copy()
        im = recolor(im, (134, 132, 146), (120, 118, 132), (148, 146, 160)).copy(); px = im.load()
        side_a = at(y, x - 1) != 'M' if vertical else at(y - 1, x) != 'M'
        side_b = at(y, x + 1) != 'M' if vertical else at(y + 1, x) != 'M'
        for i in range(T):
            for j in range(4):                       # 4px strip
                stripe = ((i + j + (y if vertical else x) * T) // 3) % 2
                c = (236, 198, 60, 255) if stripe else (44, 42, 50, 255)
                if side_a: px[(j, i) if vertical else (i, j)] = c
                if side_b: px[(T - 1 - j, i) if vertical else (i, T - 1 - j)] = c
        return im

    rng = random.Random(11)
    def grass_tile(x, y):
        im = grass[(y % 2) * 2 + x % 2].copy(); px = im.load()
        r = random.Random(x * 7919 + y * 104729)
        for _ in range(r.randint(2, 4)):            # little tufts
            tx, ty = r.randint(1, T - 3), r.randint(2, T - 2)
            px[tx, ty] = (112, 146, 88, 255); px[tx + 1, ty - 1] = (112, 146, 88, 255); px[tx + 2, ty] = (112, 146, 88, 255)
            px[tx + 1, ty] = (176, 202, 140, 255)
        if r.random() < 0.18:                       # a few flowers
            fx, fy = r.randint(2, T - 3), r.randint(2, T - 3)
            col = r.choice([(244, 240, 226), (238, 214, 120), (226, 170, 190)])
            px[fx, fy] = col + (255,); px[fx + 1, fy] = (120, 152, 92, 255)
        if r.random() < 0.25:                       # darker clover patch
            cx, cy = r.randint(3, T - 4), r.randint(3, T - 4)
            for dx, dy in ((0, 0), (1, 0), (0, 1), (-1, 0), (0, -1)): px[cx + dx, cy + dy] = (126, 154, 98, 255)
        return im

    def street_tile(x, y):
        im = asphalt[(y % 2) * 2 + x % 2].copy(); px = im.load()
        r = random.Random(x * 15485863 + y * 32452843)
        def run(dy, dx):
            n, cy, cx = 0, y, x
            while at(cy, cx) in 'SR' and n < 12: n += 1; cy += dy; cx += dx
            return n
        up, down, left, right = run(-1, 0) - 1, run(1, 0) - 1, run(0, -1) - 1, run(0, 1) - 1
        vert_w, horiz_w = up + down + 1, left + right + 1
        # lane dashes down the middle of streets (muted white, not neon)
        if 3 <= vert_w <= 7 and horiz_w > 7 and up == (vert_w - 1) // 2 and x % 2 == 0:
            yy = T - 1 if vert_w % 2 == 0 else T // 2
            for i in range(2, 12): px[i, yy] = (214, 210, 200, 255)
        if 3 <= horiz_w <= 7 and vert_w > 7 and left == (horiz_w - 1) // 2 and y % 2 == 0:
            xx = T - 1 if horiz_w % 2 == 0 else T // 2
            for i in range(2, 12): px[xx, i] = (214, 210, 200, 255)
        if r.random() < 0.12:                       # cracks
            cx, cy = r.randint(2, T - 3), r.randint(2, T - 3)
            for _ in range(r.randint(4, 8)):
                px[cx, cy] = (96, 94, 108, 255)
                cx = max(0, min(T - 1, cx + r.choice((-1, 0, 1)))); cy = max(0, min(T - 1, cy + r.choice((0, 1))))
        if r.random() < 0.015:                      # manhole cover
            for yy in range(4, 12):
                for xx in range(4, 12):
                    d = (xx - 7.5) ** 2 + (yy - 7.5) ** 2
                    if d < 16: px[xx, yy] = (98, 96, 108, 255) if d > 9 or (xx + yy) % 3 == 0 else (110, 108, 120, 255)
        # curbs where the street meets pavement or grass
        for (dy, dx, edge) in ((-1, 0, 'top'), (1, 0, 'bottom'), (0, -1, 'left'), (0, 1, 'right')):
            k = at(y + dy, x + dx)
            if k in 'PAGK':
                for i in range(T):
                    p1 = {'top': (i, 0), 'bottom': (i, T - 1), 'left': (0, i), 'right': (T - 1, i)}[edge]
                    p2 = {'top': (i, 1), 'bottom': (i, T - 2), 'left': (1, i), 'right': (T - 2, i)}[edge]
                    px[p1] = (196, 192, 196, 255); px[p2] = (100, 98, 112, 255)
        return im
    def bridge_tile(x, y, horizontal):
        im = Image.new('RGBA', (T, T), (150, 148, 156, 255)); px = im.load()
        for i in range(T):
            if horizontal:
                if i % 4 == 0:
                    for yy in range(T): px[i, yy] = (124, 122, 132, 255)    # planks
            else:
                if i % 4 == 0:
                    for xx in range(T): px[xx, i] = (124, 122, 132, 255)
        return im

    def at(y, x): return grid[y, x] if 0 <= y < H and 0 <= x < W else 'S'
    for y in range(H):
        for x in range(W):
            k = grid[y, x]
            if k in 'SR': t = street_tile(x, y)
            elif k == 'P': t = paving[(y % 3) * 3 + x % 3]
            elif k == 'A': t = lot[(y % 2) * 2 + x % 2]
            elif k == 'G': t = grass_tile(x, y)
            elif k == 'W': t = water[(y % 2) * 2 + x % 2]
            elif k == 'K': t = paving[(y % 3) * 3 + x % 3]   # blocks get a prop drawn on top
            elif k in '123': t = roof[k][(y % 2) * 2 + x % 2]
            elif k == 'T': t = stairs_tile(x, y)
            elif k == 'M': t = ramp_tile(x, y)
            elif k == 'B': t = wall_tile(x, y) if at(y + 1, x) not in 'B123TM' or at(y + 2, x) not in 'B123TM' else flat_wall(x, y)
            ground.paste(t, (x * T, y * T))
            if k == 'R':
                horiz = at(y, x - 1) == 'R' or at(y, x + 1) == 'R'
                bridge.paste(bridge_tile(x, y, horiz), (x * T, y * T))

    gp = ground.load()
    def shade(x0, y0, x1, y1, f):
        for yy in range(max(0, y0), min(H * T, y1)):
            for xx in range(max(0, x0), min(W * T, x1)):
                r, g, b, a = gp[xx, yy]; gp[xx, yy] = (int(r * f), int(g * f), int(b * f), a)

    for y in range(H):
        for x in range(W):
            k = grid[y, x]
            # roof rims where a roof meets anything lower
            if k in '123':
                h = HEIGHT[k]
                def lower(yy, xx): return HEIGHT.get(at(yy, xx), -1) < h and at(yy, xx) not in 'TM'
                X, Y = x * T, y * T
                if lower(y - 1, x):
                    for i in range(T): gp[X + i, Y] = rim; gp[X + i, Y + 1] = rim
                if lower(y + 1, x):
                    for i in range(T): gp[X + i, Y + T - 1] = rim_dark; gp[X + i, Y + T - 2] = rim
                if lower(y, x - 1):
                    for i in range(T): gp[X, Y + i] = rim; gp[X + 1, Y + i] = rim
                if lower(y, x + 1):
                    for i in range(T): gp[X + T - 1, Y + i] = rim_dark; gp[X + T - 2, Y + i] = rim

    ground = cast_shadows(ground, grid)

    # bridge railings: darker edges where the bridge meets non-bridge tiles
    bp = bridge.load()
    for y in range(H):
        for x in range(W):
            if grid[y, x] != 'R': continue
            X, Y = x * T, y * T
            for i in range(T):
                if at(y - 1, x) != 'R': bp[X + i, Y] = (88, 86, 98, 255); bp[X + i, Y + 1] = (196, 194, 200, 255)
                if at(y + 1, x) != 'R': bp[X + i, Y + T - 1] = (60, 58, 70, 255); bp[X + i, Y + T - 2] = (88, 86, 98, 255)
                if at(y, x - 1) != 'R' and at(y, x - 1) not in '123T': bp[X, Y + i] = (88, 86, 98, 255)
                if at(y, x + 1) != 'R' and at(y, x + 1) not in '123T': bp[X + T - 1, Y + i] = (60, 58, 70, 255)
    # bridges cast a thin shadow on the street below
    ba = np.array(bridge)[..., 3] > 0
    sh = np.zeros_like(ba); sh[6:, 4:] = ba[:-6, :-4]
    g = np.array(ground).astype(float)
    g[sh & ~ba, :3] *= 0.78
    ground = Image.fromarray(g.astype(np.uint8), 'RGBA')
    return ground, bridge


def cast_shadows(ground, grid):
    """Light comes from the top-left: every building throws a shadow down and to the
    right, longer for taller roofs. Lower roofs catch the shadow of higher ones."""
    H, W = grid.shape
    height = np.zeros((H, W))
    blocks, n = comps(np.isin(grid, list('B123')))
    tallest = nd.maximum(np.vectorize(lambda k: HEIGHT.get(k, 0) if k in '123' else 0)(grid), blocks, range(1, n + 1))
    for i in range(1, n + 1):
        m = blocks == i
        height[m & (grid == 'B')] = max(1, tallest[i - 1])           # walls are as tall as their building
    for k in '123': height[grid == k] = int(k)
    hp = np.kron(height, np.ones((T, T)))
    shade = np.zeros(hp.shape)
    for lvl in (1, 2, 3):
        caster = hp >= lvl
        reach = 7 * lvl                                          # pixels of shadow per level
        m = np.zeros_like(caster)
        for s in range(1, reach + 1):
            dx = int(round(s * 0.7))
            m[s:, dx:] |= caster[:-s, :hp.shape[1] - dx] if dx else caster[:-s, :]
        shade[m & (hp < lvl)] += 1
    g = np.array(ground).astype(float)
    g[..., :3] *= np.where(shade > 0, 0.8 - 0.06 * np.minimum(shade - 1, 2), 1.0)[..., None]
    return Image.fromarray(np.clip(g, 0, 255).astype(np.uint8), 'RGBA')


def place_blocks(grid):
    """Turn every block area into props from the tileset (dumpsters, barrels, bags, tyres)."""
    props = []
    lab, n = comps(grid == 'K')
    smalls = ['barrel', 'bag', 'tire', 'bag2']
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        w, h = x1 - x0, y1 - y0
        # fill the area from the bottom row up
        for by in range(y1, y0, -2 if w >= 3 else -1):
            bx = x0
            while bx < x1:
                left = x1 - bx
                if left >= 3 and by - y0 >= 2: props.append(['dumpster', bx * T + 24, by * T]); bx += 3

                else: props.append([random.choice(smalls), bx * T + 8, by * T]); bx += 1
    return props


def place_trees(grid, reach_cells):
    """Scatter trees on open grass. The tree's base tile becomes solid."""
    H, W = grid.shape
    trees, taken = [], np.zeros_like(grid, bool)
    cand = [(y, x) for y in range(2, H - 1) for x in range(1, W - 1)
            if grid[y, x] == 'G' and (grid[y - 2:y + 2, x - 1:x + 2] == 'G').all()]
    random.shuffle(cand)
    for y, x in cand:
        if taken[max(0, y - 3):y + 4, max(0, x - 3):x + 4].any(): continue
        if random.random() > 0.55: continue
        taken[y, x] = True
        trees.append([random.choice(['tree_s', 'tree_m', 'tree_l', 'tree_m']), x * T + 8, (y + 1) * T])
        grid[y, x] = 'K'       # trunk blocks this tile
    return trees


def spread(cands, n, avoid=(), min_d=0):
    """Pick n cells far from each other (farthest-point sampling)."""
    chosen = list(avoid)
    out = []
    pool = cands[:]
    random.shuffle(pool)
    pool = pool[:4000]
    for _ in range(n):
        best, bd = None, -1
        for c in pool:
            d = min((abs(c[0][0] - o[0][0]) + abs(c[0][1] - o[0][1]) for o in chosen), default=1e9)
            if d > bd: best, bd = c, d
        if best is None or bd < min_d: break
        chosen.append(best); out.append(best)
    return out


def brain_image():
    """A 12x10 pixel-art brain in the tileset's palette (dark outline, pink lobes)."""
    rows = [
        "...oooooo...",
        "..oPPpPPPo..",
        ".oPpPPpPpPo.",
        "oPPpPLLpPPpo",
        "oPpPPLPpPpPo",
        "oPPpPPpPPpPo",
        ".oPPpPPpPPo.",
        "..ooPPPPoo..",
        "....oddo....",
        ".....oo.....",
    ]
    col = {'o': (58, 30, 44), 'P': (232, 140, 160), 'p': (186, 92, 118), 'L': (255, 206, 214), 'd': (150, 70, 90)}
    im = Image.new('RGBA', (12, 10))
    for y, r in enumerate(rows):
        for x, c in enumerate(r):
            if c in col: im.putpixel((x, y), col[c] + (255,))
    return im


def main():
    src = Image.open(os.path.join(ROOT, 'art', 'source', 'level_map.png'))
    src = src.crop((0, 0, src.width, 976))              # drop the legend strip
    grid = classify_cells(src)
    grid = fix_shapes(grid)
    H, W = grid.shape

    # start: the central plaza
    start = (66, 88)
    while grid[start] not in 'PA': start = (start[0] + 1, start[1])

    props = place_blocks(grid)
    reach = reachable(grid, start)
    trees = place_trees(grid, reach)
    reach = reachable(grid, start)                      # trees changed the grid

    reach_cells = {}
    for (c, lv) in reach:
        if grid[c] not in 'TRM': reach_cells[c] = lv
    roofs_total = np.isin(grid, list('123')).sum()
    roofs_reached = sum(1 for c, lv in reach_cells.items() if lv >= 1)
    print(f'grid {W}x{H}, reachable tiles {len(reach_cells)}, roof tiles reachable {roofs_reached}/{roofs_total}')

    def far_from_start(c, d): return abs(c[0] - start[0]) + abs(c[1] - start[1]) >= d
    ground_c = [(c, lv) for c, lv in reach_cells.items() if lv == 0 and grid[c] in 'SPAG' and far_from_start(c, 14)]
    roof_c = [(c, lv) for c, lv in reach_cells.items() if lv >= 1 and far_from_start(c, 10)]
    hi_c = [(c, lv) for c, lv in roof_c if lv >= 2]

    # brains: 3 on high roofs, 2 on any roof, 5 on the ground, all spread out
    brains = spread(hi_c, 3, min_d=20)
    brains += spread(roof_c, 2, avoid=brains, min_d=20)
    brains += spread(ground_c, 10 - len(brains), avoid=brains + [((start), 0)], min_d=14)
    zombies = spread(ground_c, 46, avoid=[(start, 0)], min_d=6) + spread(roof_c, 12, min_d=6)

    tiles = load_rgba(os.path.join(HERE, 'out', 'tiles.png'))
    ground_img, bridge_img = bake(grid, tiles, None)
    # Contrast: the map stays light and a little desaturated so the sprites pop.
    from PIL import ImageEnhance
    def recede(im, bright, sat):
        alpha = im.getchannel('A')
        rgb = ImageEnhance.Color(im.convert('RGB')).enhance(sat)
        rgb = ImageEnhance.Brightness(rgb).enhance(bright).convert('RGBA')
        rgb.putalpha(alpha); return rgb
    ground_img = recede(ground_img, 1.04, 0.86)     # terrain: light and calm
    bridge_img = recede(bridge_img, 1.04, 0.86)

    level = {
        'width': W, 'height': H, 'tiles': ''.join(grid.ravel()),
        'start': [start[1], start[0]],
        'props': props + trees,
        'zombies': [[c[1], c[0], lv] for c, lv in zombies],
        'brains': [[c[1], c[0], lv] for c, lv in brains],
    }
    ground_img.save(os.path.join(ROOT, 'public', 'assets', 'level_ground.png'), 'PNG', optimize=True)
    bridge_img.save(os.path.join(ROOT, 'public', 'assets', 'level_bridges.png'), 'PNG', optimize=True)
    with open(os.path.join(ROOT, 'src', 'data', 'level.json'), 'w') as f:
        f.write(json.dumps(level, default=int, indent=1) + '\n')

    # preview: everything composited, with brains and zombies marked
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    pv = ground_img.copy()
    pv.alpha_composite(bridge_img)
    from PIL import ImageDraw
    d = ImageDraw.Draw(pv)
    for c, lv in zombies: d.rectangle((c[1] * T + 3, c[0] * T + 3, c[1] * T + 12, c[0] * T + 12), fill=(30, 30, 40))
    for c, lv in brains: d.ellipse((c[1] * T - 6, c[0] * T - 6, c[1] * T + 22, c[0] * T + 22), outline=(255, 80, 140), width=4)
    d.rectangle((start[1] * T, start[0] * T, start[1] * T + 15, start[0] * T + 15), fill=(255, 255, 255))
    pv.save(os.path.join(HERE, 'out', 'level_preview.png'))
    np.save(os.path.join(HERE, 'out', 'grid.npy'), grid)
    print('brains', len(brains), 'zombies', len(zombies), 'props', len(props), 'trees', len(trees))


if __name__ == '__main__':
    main()
