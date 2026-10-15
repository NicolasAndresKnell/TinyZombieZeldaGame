"""Builds src/assets.js: every sprite as an embedded PNG plus animation tables.
Run: python3 tools/pack.py"""
import os, base64, io, json
from extract import *
from pieces import *
from chars import cut_sheet, CELL_W as CW, CELL_H as CH

def sheet(parts):
    """parts: list of (anim_name, frames). Returns (Image, {anim: [first, count]})."""
    frames, index = [], {}
    for name, fr in parts:
        index[name] = [len(frames), len(fr)]; frames += fr
    im = Image.new('RGBA', (CW * len(frames), CH))
    for i, f in enumerate(frames): im.alpha_composite(f, (i * CW, 0))
    return im, index

ROWS_HERO = ['idle', 'walk', 'attack', 'walkattack', 'hurt']
hd = cut_sheet('hero_front', ROWS_HERO)
hs = cut_sheet('hero_side', ROWS_HERO)
za = cut_sheet('zombie_a', ['recharge', 'cast', 'hurt', 'dead'])
zb = cut_sheet('zombie_b', ['idle', 'walk', 'shot', 'attack', 'walkshot'])
hero, hero_idx = sheet([('idle_down', hd['idle']), ('walk_down', hd['walk']), ('attack_down', hd['attack']),
                        ('combo_down', hd['walkattack']), ('hurt_down', hd['hurt']),
                        ('idle_side', hs['idle']), ('walk_side', hs['walk']), ('attack_side', hs['attack']),
                        ('combo_side', hs['walkattack']), ('hurt_side', hs['hurt'])])
zom, zom_idx = sheet([('idle', zb['idle']), ('walk', zb['walk']), ('attack', zb['attack']), ('shot', zb['shot']),
                      ('windup', za['recharge']), ('cast', za['cast']), ('hurt', za['hurt']), ('dead', za['dead'])])

# --- contrast: a 1px light outline around every character frame ---------------
def outline(im, color, cell_w=None):
    """Paint `color` on every transparent pixel that touches an opaque one (4 directions)."""
    a = np.array(im)
    solid = a[..., 3] > 0
    ring = np.zeros_like(solid)
    ring[1:, :] |= solid[:-1, :]; ring[:-1, :] |= solid[1:, :]
    ring[:, 1:] |= solid[:, :-1]; ring[:, :-1] |= solid[:, 1:]
    ring &= ~solid
    if cell_w:                       # never bleed across frame borders
        for x in range(0, a.shape[1], cell_w):
            ring[:, x] &= solid[:, x + 1] if x + 1 < a.shape[1] else False
    a[ring] = color + (255,)
    return Image.fromarray(a, 'RGBA')

hero = outline(hero, (255, 236, 196), CW)
ENEMY_OUTLINES = {                     # outline colour tells the enemy type apart
    'zombie_walker': (196, 210, 204),    # pale grey: the basic shambler
    'zombie_spitter': (150, 232, 84),    # toxic green: shoots from range
    'zombie_brute': (244, 98, 72),       # red: slow, tough, ground slam
    'zombie_boss': (255, 206, 72),       # gold: the Brain King
}
enemy_sheets = {k: outline(zom, c, CW) for k, c in ENEMY_OUTLINES.items()}

# --- small generated sprites: brains and spit ---------------------------------
def brain(rx, ry, glow):
    """Pixel-art brain: pink lobes, folds, a dark outline and (optionally) a light halo."""
    W, H = int(rx * 2 + 4), int(ry * 2 + 6)
    cx, cy = W / 2 - 0.5, ry + 1.5
    a = np.zeros((H, W, 4), np.uint8)
    for y in range(H):
        for x in range(W):
            nx, ny = (x - cx) / rx, (y - cy) / ry
            if nx * nx + ny * ny <= 1:
                c = (236, 140, 164)
                if nx + ny > 0.55: c = (196, 96, 124)                          # shade bottom-right
                if nx + ny < -0.9: c = (255, 204, 214)                         # highlight top-left
                fold = np.sin(x * 1.3 + (y // 3) * 2.1)
                if y % 3 == 0 and fold > 0.2: c = (172, 78, 106)              # folds
                if abs(x - cx) < 0.6 and ny < 0.6: c = (150, 64, 92)          # middle fissure
                a[y, x] = c + (255,)
    sx = int(cx); a[int(cy + ry):int(cy + ry) + 3, sx - 1:sx + 2] = (160, 70, 96, 255)   # stem
    im = outline(Image.fromarray(a, 'RGBA'), (58, 24, 40))
    if glow: im = outline(im, (255, 238, 226))
    return im

brain_big = brain(9, 6.5, True)       # the 10 level brains
brain_drop = brain(6.5, 4.5, False)   # brains dropped by enemies
spit = Image.new('RGBA', (7, 7))
for y in range(7):
    for x in range(7):
        d = (x - 3) ** 2 + (y - 3) ** 2
        if d <= 9: spit.putpixel((x, y), (40, 60, 20, 255) if d > 5 else (198, 236, 70, 255) if d > 1 else (246, 255, 170, 255))

# --- tileset strip: grass, asphalt x4, sand x4, paving x9 -----------------
grass = np.zeros((16, 16, 4), np.uint8); grass[:] = (94, 107, 100, 255)
rng = np.random.default_rng(3)
for _ in range(10):
    x, y = rng.integers(0, 16, 2); grass[y, x, :3] = (82, 94, 88)
for _ in range(6):
    x, y = rng.integers(0, 15, 2); grass[y, x, :3] = (106, 120, 110)
tiles = [Image.fromarray(grass, 'RGBA')]
def quads(im, n):
    return [im.crop((c * 16, r * 16, c * 16 + 16, r * 16 + 16)) for r in range(n) for c in range(n)]
ts = {}
for k, (box, size) in {'asphalt': ((135,409,196,470),(32,32)), 'sand': ((42,408,105,471),(32,32)), 'paving': ((44,286,134,376),(48,48))}.items():
    ts[k] = sample(a, tight(a, box), S, opaque=True, size=size)
tiles += quads(ts['asphalt'], 2) + quads(ts['sand'], 2) + quads(ts['paving'], 3)
tileset = Image.new('RGBA', (16 * len(tiles), 16))
for i, t in enumerate(tiles): tileset.alpha_composite(t, (i * 16, 0))

# --- props -----------------------------------------------------------------
from PIL import ImageEnhance
def punch(im):
    rgb = ImageEnhance.Contrast(im.convert('RGB')).enhance(1.18)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
    out = rgb.convert('RGBA'); out.putalpha(im.getchannel('A')); return out
props = {k: punch(sample(a, tight(a, box), S)) for k, box in pieces.items()}

# --- UI: heart, skull, panel ------------------------------------------------
u = load('ui')
ui = {'heart': sample(u, tight(u, (515, 326, 547, 356)), S),
      'skull': sample(u, tight(u, (238, 295, 271, 323)), S),
      'panel': sample(u, tight(u, (469, 86, 570, 187)), S)}

def uri(im):
    b = io.BytesIO(); im.save(b, 'PNG', optimize=True)
    return 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

images = {'hero': uri(hero), 'tiles': uri(tileset),
          'brain': uri(brain_big), 'brain_drop': uri(brain_drop), 'spit': uri(spit)}
images.update({k: uri(v) for k, v in enemy_sheets.items()})
images.update({k: uri(v) for k, v in props.items()})
images.update({k: uri(v) for k, v in ui.items()})
sizes = {k: list(v.size) for k, v in {**props, **ui}.items()}
js = ('// AUTO-GENERATED by tools/pack.py from the sprite sheets. Do not edit by hand.\n'
      f'const IMAGES = {json.dumps(images)};\n'
      f'const HERO_ANIMS = {json.dumps(hero_idx)};\n'
      f'const ZOMBIE_ANIMS = {json.dumps(zom_idx)};\n'
      f'const PROP_SIZES = {json.dumps(sizes)};\n')
OUT = os.path.join(os.path.dirname(__file__), '..', 'src')
open(os.path.join(OUT, 'assets.js'), 'w').write(js)
print(len(js) // 1024, 'KB'); print(hero_idx); print(zom_idx); print(sizes)

# level.py builds the big map from these ground tiles
os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
tileset.save(os.path.join(os.path.dirname(__file__), 'out', 'tiles.png'))
