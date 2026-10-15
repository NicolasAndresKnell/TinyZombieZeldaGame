"""Builds public/assets/*.png (every sprite) and src/data/sprites.json (animation tables).
Run: python3 tools/pack.py"""
import os, json
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

import colorsys
from scipy import ndimage as nd
from PIL import ImageDraw

def body_mask(a):
    """The character's own pixels: the biggest connected blob (slashes and sparks are separate)."""
    lab, n = nd.label(a[..., 3] > 0)
    if n == 0: return np.zeros(a.shape[:2], bool)
    sizes = nd.sum(np.ones(lab.shape), lab, range(1, n + 1))
    return lab == (1 + int(np.argmax(sizes)))

# --- hero: the pale shirt becomes a green palette ---------------------------------
GREENS = [(70, 128, 72), (96, 158, 88), (128, 190, 108), (168, 220, 140)]   # dark → light
def green_hero(im):
    a = np.array(im).astype(int)
    body = body_mask(a)
    rgb = a[..., :3]; lum = rgb.mean(-1); sat = rgb.max(-1) - rgb.min(-1)
    shirt_rows = np.arange(a.shape[0])[:, None] >= 20          # below the head
    pale = body & shirt_rows & (a[..., 3] > 0) & (lum > 125) & (sat < 60)
    for (lo, hi), c in zip([(125, 160), (160, 190), (190, 220), (220, 256)], GREENS):
        a[pale & (lum >= lo) & (lum < hi), :3] = c
    return Image.fromarray(a.astype(np.uint8), 'RGBA')

# --- combo frames: one hand, then two hands, then a spin -----------------------------
SLASH = [(255, 255, 255), (214, 246, 200), (150, 214, 140)]   # bright core fading to green
def crescent(im, cx, cy, r, a0, a1, width, fade=1.0):
    """Draw a thick arc (degrees, 0 = right, clockwise) as the sword trail."""
    a = np.array(im); H, W = a.shape[:2]
    for y in range(H):
        for x in range(W):
            dx, dy = x - cx, (y - cy) * 1.6          # squash vertically: top-down perspective
            d = np.hypot(dx, dy); ang = np.degrees(np.arctan2(dy, dx)) % 360
            lo, hi = a0 % 360, a1 % 360
            inside = lo <= ang <= hi if lo <= hi else (ang >= lo or ang <= hi)
            if inside and r - width <= d <= r:
                t = (r - d) / width                   # 0 at the outer edge
                c = SLASH[0] if t < 0.4 else SLASH[1] if t < 0.75 else SLASH[2]
                if a[y, x, 3] == 0 or fade >= 1: a[y, x] = c + (int(255 * fade),)
    return Image.fromarray(a, 'RGBA')

def without_effects(im):
    """Keep only the body (drop the original slash pixels)."""
    a = np.array(im); a[~body_mask(a)] = 0
    return Image.fromarray(a, 'RGBA')

def second_hand(im, mirror):
    """Add the other hand: mirror the raised arm across the body (front view) or
    repeat the fist a little lower (side view)."""
    a = np.array(im); body = body_mask(a)
    rgb = a[..., :3].astype(int)
    skin = body & (rgb[..., 0] > 150) & (rgb[..., 0] > rgb[..., 2] + 45)
    out = a.copy()
    ys, xs = np.where(skin & (np.arange(a.shape[1])[None, :] >= 29))   # hand/arm reaching out to the right
    for y, x in zip(ys, xs):
        nx, ny = (48 - 1 - x, y) if mirror else (x - 1, y + 2)
        if 0 <= nx < 48 and 0 <= ny < 32 and out[ny, nx, 3] == 0: out[ny, nx] = a[y, x]
    return Image.fromarray(out, 'RGBA')

def two_hand(frames, mirror):
    f = [without_effects(x) for x in frames]
    # arms raised together (mirrored), then both fists forward on the swing
    return [second_hand(f[0], mirror), second_hand(f[1], mirror),
            crescent(second_hand(f[2], False), 26, 22, 19, 250, 60, 5),
            crescent(second_hand(f[3], False), 26, 22, 19, 20, 100, 4, 0.7)]

def flip(im): return im.transpose(Image.FLIP_LEFT_RIGHT)
def spin(front, side):
    """Six frames turning on the spot (front → side → front mirrored → side mirrored)
    with a white trail following the blade round."""
    bodies = [front, side, flip(front), flip(side), front, side]
    out = []
    for i, b in enumerate(bodies):
        a0 = -60 + i * 70
        out.append(crescent(b, 24, 25, 18, a0, a0 + 110, 4, 1.0 if i < 5 else 0.6))
    return out

hd_g = {k: [green_hero(f) if k != 'hurt' else f for f in v] for k, v in hd.items()}
hs_g = {k: [green_hero(f) if k != 'hurt' else f for f in v] for k, v in hs.items()}
spin_frames = spin(without_effects(hd_g['idle'][0]), without_effects(hs_g['idle'][0]))
hero, hero_idx = sheet([
    ('idle_down', hd_g['idle']), ('walk_down', hd_g['walk']),
    ('slash1_down', hd_g['attack']), ('slash2_down', two_hand(hd_g['attack'], True)), ('spin_down', spin_frames),
    ('hurt_down', hd_g['hurt']),
    ('idle_side', hs_g['idle']), ('walk_side', hs_g['walk']),
    ('slash1_side', hs_g['attack']), ('slash2_side', two_hand(hs_g['attack'], False)), ('spin_side', spin_frames),
    ('hurt_side', hs_g['hurt'])])
zom, zom_idx = sheet([('idle', zb['idle']), ('walk', zb['walk']), ('attack', zb['attack']), ('shot', zb['shot']),
                      ('windup', za['recharge']), ('cast', za['cast']), ('hurt', za['hurt']), ('dead', za['dead'])])

# --- enemy types: told apart by palette (the suit's hue), no outlines -------------------
ENEMY_HUES = {                         # None = keep the original navy suit
    'zombie_walker': None,              # navy: the basic shambler
    'zombie_spitter': (0.30, 0.45),     # sickly green: shoots from range
    'zombie_brute': (0.00, 0.55),       # blood red: slow, tough, ground slam
    'zombie_boss': (0.12, 0.65),        # gold: the Brain King
}
def recolor_suit(im, hue_sat):
    if hue_sat is None: return im
    hue, sat = hue_sat
    a = np.array(im).astype(float) / 255
    out = a.copy()
    for y, x in zip(*np.where(a[..., 3] > 0)):
        r, g, b = a[y, x, :3]
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        if l > 0.85 and s < 0.3: continue            # keep white highlights and hurt flashes
        r2, g2, b2 = colorsys.hls_to_rgb(hue, min(0.8, l * 1.15), max(s, sat))
        out[y, x, :3] = (r2, g2, b2)
    return Image.fromarray((out * 255).astype(np.uint8), 'RGBA')
enemy_sheets = {k: recolor_suit(zom, h) for k, h in ENEMY_HUES.items()}

# --- small generated sprites: spinning brains and spit ----------------------------
def outline(im, color):
    a = np.array(im); solid = a[..., 3] > 0
    ring = np.zeros_like(solid)
    ring[1:, :] |= solid[:-1, :]; ring[:-1, :] |= solid[1:, :]
    ring[:, 1:] |= solid[:, :-1]; ring[:, :-1] |= solid[:, 1:]
    a[ring & ~solid] = color + (255,)
    return Image.fromarray(a, 'RGBA')

def brain(rx, ry):
    """Pixel-art brain: pink lobes, folds and its own dark pixel edge."""
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
    return outline(Image.fromarray(a, 'RGBA'), (58, 24, 40))

BRAIN_FRAMES = 8
def spinning(im):
    """Turn a brain around its vertical axis: squeeze its width by cos(angle) and
    show the mirrored back half of the turn, darker."""
    W, H = im.size
    strip = Image.new('RGBA', (W * BRAIN_FRAMES, H))
    for i in range(BRAIN_FRAMES):
        ang = 2 * np.pi * i / BRAIN_FRAMES
        c = np.cos(ang)
        w = max(3, int(round(W * abs(c))))
        face = im if c >= 0 else flip(im)
        fr = face.resize((w, H), Image.NEAREST)
        if c < 0:
            arr = np.array(fr).astype(int); arr[..., :3] = (arr[..., :3] * 0.82).astype(int)
            fr = Image.fromarray(arr.astype(np.uint8), 'RGBA')
        strip.alpha_composite(fr, (i * W + (W - w) // 2, 0))
    return strip

brain_big = brain(9, 6.5)
brain_drop = brain(6.5, 4.5)
brain_sheet, drop_sheet = spinning(brain_big), spinning(brain_drop)
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

ROOT = os.path.join(os.path.dirname(__file__), '..')
images = {'hero': hero, 'tiles': tileset, 'brain': brain_sheet, 'brain_drop': drop_sheet, 'spit': spit,
          **enemy_sheets, **props, **ui}
for k, im in images.items(): im.save(os.path.join(ROOT, 'public', 'assets', k + '.png'), 'PNG', optimize=True)
sizes = {k: list(v.size) for k, v in {**props, **ui}.items()}
brain_sizes = {'brain': list(brain_big.size), 'brain_drop': list(brain_drop.size), 'frames': BRAIN_FRAMES}
with open(os.path.join(ROOT, 'src', 'data', 'sprites.json'), 'w') as f:
    f.write(json.dumps({'heroAnimations': hero_idx, 'zombieAnimations': zom_idx, 'propSizes': sizes, 'brain': brain_sizes}, indent=1) + '\n')
print(len(images), 'images'); print(hero_idx); print(zom_idx); print(sizes)

# level.py builds the big map from these ground tiles
os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
tileset.save(os.path.join(os.path.dirname(__file__), 'out', 'tiles.png'))
