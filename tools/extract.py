"""Helpers to cut pixel-art sprites out of the preview sheets in assets/source."""
from PIL import Image
import numpy as np
from scipy import ndimage as nd

import os
UP = os.path.join(os.path.dirname(__file__), '..', 'art', 'source') + '/'
BG = np.array([94, 107, 100])

def load(name):
    return np.array(Image.open(UP + name + '.webp').convert('RGB')).astype(int)

def mask_of(a, thr=40):
    return np.abs(a - BG).sum(2) > thr

def tight(a, box, thr=40):
    """Shrink box (x0,y0,x1,y1) to the non-background pixels inside it."""
    x0, y0, x1, y1 = box
    m = mask_of(a[y0:y1, x0:x1], thr)
    ys, xs = np.where(m)
    return (x0 + xs.min(), y0 + ys.min(), x0 + xs.max() + 1, y0 + ys.max() + 1)

def sample(a, box, scale, opaque=False, thr=40, size=None):
    """Downsample box by sampling each native pixel's centre. Returns RGBA Image."""
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    W, H = size or (max(1, round(w / scale)), max(1, round(h / scale)))
    sx, sy = w / W, h / H
    out = np.zeros((H, W, 4), np.uint8)
    for j in range(H):
        for i in range(W):
            cx = x0 + (i + 0.5) * sx
            cy = y0 + (j + 0.5) * sy
            # average a small 2x2-ish core to beat compression noise
            xa, xb = int(cx - sx * 0.2), int(cx + sx * 0.2) + 1
            ya, yb = int(cy - sy * 0.2), int(cy + sy * 0.2) + 1
            patch = a[ya:yb, xa:xb].reshape(-1, 3)
            col = np.median(patch, 0)
            m = mask_of(patch[None], thr)[0]
            visible = opaque or m.mean() > 0.5
            if visible:
                if not opaque and m.any():
                    col = np.median(patch[m], 0)
                out[j, i, :3] = col
                out[j, i, 3] = 255
    return Image.fromarray(out, 'RGBA')

def components(a, region, dil=2, thr=40, minarea=20):
    x0, y0, x1, y1 = region
    m = mask_of(a[y0:y1, x0:x1], thr)
    lab, n = nd.label(nd.binary_dilation(m, iterations=dil))
    res = []
    for s in nd.find_objects(lab):
        ys, xs = s
        w, h = xs.stop - xs.start, ys.stop - ys.start
        if w * h >= minarea:
            res.append((x0 + xs.start + dil, y0 + ys.start + dil, x0 + xs.stop - dil, y0 + ys.stop - dil))
    return res
