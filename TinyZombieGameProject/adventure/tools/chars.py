"""Cuts character animation frames: finds each row and frame, anchors on the feet."""
from extract import *
from collections import Counter

def phase(a, m):
    """Which x and y residue (mod 3) the source pixel grid starts on."""
    res = []
    for axis in (1, 0):
        d = np.abs(np.diff(a, axis=axis)).sum(2) > 80
        d &= (m[:, 1:] if axis == 1 else m[1:, :])
        idx = np.where(d)[1 if axis == 1 else 0] + 1
        res.append(Counter(idx % 3).most_common(1)[0][0])
    return res  # (px, py)

def rows_of(a, m):
    rows = m.any(1); bands = []; s = None
    for i, r in enumerate(rows):
        if r and s is None: s = i
        if not r and s is not None:
            if i - s > 8: bands.append((s, i))
            s = None
    mb = []
    for b in bands:
        if mb and b[0] - mb[-1][1] < 25: mb[-1] = (mb[-1][0], b[1])
        else: mb.append(b)
    return mb

CELL_W, CELL_H, FOOT_Y = 48, 32, 30   # native cell; feet land at y=30, centred at x=24

def cut_sheet(name, row_names):
    a = load(name); m = mask_of(a); m[:, :225] = False
    px, py = phase(a, m)
    result = {}
    for (y0, y1), rname in zip(rows_of(a, m), row_names):
        mm = m.copy(); mm[:y0 - 3] = False; mm[y1 + 3:] = False
        lab, n = nd.label(nd.binary_dilation(mm, iterations=1))
        bodies = []
        for i, sl in enumerate(nd.find_objects(lab), 1):
            if (lab[sl] == i).sum() > 600:
                ys, xs = sl
                bodies.append((xs.start + 1, ys.start + 1, xs.stop - 1, ys.stop - 1))
        bodies = sorted(bodies)
        feet = []
        for b in bodies:
            sub = mask_of(a[b[3] - 9:b[3], b[0]:b[2]])
            xs = np.where(sub.any(0))[0]
            feet.append(b[0] + (xs.min() + xs.max() + 1) / 2)
        # assign every piece in the band (slashes, particles) to the nearest body
        lab2, n2 = nd.label(nd.binary_dilation(mm, iterations=1))
        owner = np.zeros(n2 + 1, int) - 1
        for i, sl in enumerate(nd.find_objects(lab2), 1):
            cx = (sl[1].start + sl[1].stop) / 2
            # pieces to the right of a body (slashes) belong to that body
            ok = [k for k, f in enumerate(feet) if cx >= f - 45]
            owner[i] = ok[-1] if ok else 0
        imgs = []
        for k, b in enumerate(bodies):
            fx = feet[k]
            keep = np.isin(lab2, np.where(owner == k)[0]) & mm
            ak = a.copy(); ak[~keep] = BG
            wx0 = int(round((fx - CELL_W / 2 * 3 - px) / 3)) * 3 + px
            wy0 = int(round((b[3] - FOOT_Y * 3 - py) / 3)) * 3 + py
            imgs.append(sample(ak, (wx0, wy0, wx0 + CELL_W * 3, wy0 + CELL_H * 3), 3, size=(CELL_W, CELL_H)))
        result[rname] = imgs
    return result

