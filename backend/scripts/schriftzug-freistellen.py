"""Stellt den Schriftzug der Fotografin für das Wasserzeichen frei.

Eingabe ist ein Scan/Export des Schriftzugs auf hellem, einfarbigem Grund
(z. B. ``backend/assets/watermark/quelle/schriftzug-original.jpg``: weisse
Striche mit grauer Kontur auf #f7f7f7). Ausgabe ist ein zugeschnittenes PNG mit
Transparenz, in dem die weisse Füllung und die graue Kontur erhalten bleiben
und der Hintergrund durchsichtig ist. Das Backend kachelt dieses PNG als
Wasserzeichen über die Vorschaubilder (siehe ``src/lib/images.ts``).

Nur nötig, wenn ein neuer Schriftzug als Bild mit Hintergrund geliefert wird.
Ein bereits freigestelltes PNG (weisser Schriftzug, transparenter Hintergrund)
kann direkt als ``backend/assets/watermark/schriftzug.png`` abgelegt werden.

Aufruf (benötigt Python 3 mit Pillow und NumPy):

    python3 backend/scripts/schriftzug-freistellen.py \\
        backend/assets/watermark/quelle/schriftzug-original.jpg \\
        backend/assets/watermark/schriftzug.png
"""
import sys
from collections import deque

import numpy as np
from PIL import Image, ImageFilter

src, dest = sys.argv[1], sys.argv[2]
g = np.asarray(Image.open(src).convert('L')).astype(np.float32)
# Hintergrundhelligkeit: der weitaus häufigste Wert (hier 247 = #f7f7f7).
BG = float(np.median(g))


def disk_offsets(r):
    return [(dy, dx) for dy in range(-r, r + 1) for dx in range(-r, r + 1) if dy * dy + dx * dx <= r * r + 0.5]


def morph(a, r, op):
    """Graustufen-Dilatation ('max') bzw. -Erosion ('min') mit rundem Kern."""
    p = np.pad(a, r, mode='edge')
    h, w = a.shape
    out = None
    for dy, dx in disk_offsets(r):
        s = p[r + dy:r + dy + h, r + dx:r + dx + w]
        out = s.copy() if out is None else (np.maximum(out, s) if op == 'max' else np.minimum(out, s))
    return out


def fill_holes(a, max_area=200, bright_area=4000):
    """Füllt rundum eingeschlossene Lücken in breiteren Strichstellen: kleine
    immer, grössere nur, wenn sie heller als der Hintergrund sind (= weisse
    Strichfüllung). Echte Innenflächen von Buchstaben (z. B. im „A“) haben
    Hintergrundhelligkeit und bleiben durchsichtig."""
    h, w = a.shape
    low = a < 0.5
    seen = np.zeros_like(low)
    filled = a.copy()
    for y0 in range(h):
        for x0 in range(w):
            if not low[y0, x0] or seen[y0, x0]:
                continue
            comp, touches, q = [], False, deque([(y0, x0)])
            seen[y0, x0] = True
            while q:
                y, x = q.popleft()
                comp.append((y, x))
                if y in (0, h - 1) or x in (0, w - 1):
                    touches = True
                for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                    if 0 <= ny < h and 0 <= nx < w and low[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        q.append((ny, nx))
            if touches or len(comp) > bright_area:
                continue
            ys, xs = zip(*comp)
            ys, xs = list(ys), list(xs)
            if len(comp) <= max_area or g[ys, xs].mean() > BG + 1.2:
                filled[ys, xs] = 1.0
    return filled


# Weiche Deckung aus der grauen Kontur ...
dark = ((BG - 4.0 - g) / 12.0).clip(0, 1)
# ... Closing mit rundem Kern füllt die weisse Fläche zwischen den Konturen.
a = np.maximum(morph(morph(dark, 3, 'max'), 3, 'min'), dark)
a = fill_holes(a)
alpha = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5))).astype(np.float32)

# Farbe: Füllung reinweiss, Kontur behält ihren Grauwert (etwas kräftiger).
col = np.where(g >= BG - 2, 255.0, np.clip(BG - (BG - g) * 1.3, 90, 255))
out = Image.fromarray(np.dstack([col, col, col, alpha]).clip(0, 255).astype(np.uint8), 'RGBA')

# Auf den Schriftzug zuschneiden (mit kleinem Rand).
ys, xs = np.where(alpha > 8)
pad = 6
box = (int(max(0, xs.min() - pad)), int(max(0, ys.min() - pad)),
       int(min(g.shape[1], xs.max() + pad + 1)), int(min(g.shape[0], ys.max() + pad + 1)))
out = out.crop(box)
out.save(dest, optimize=True)
print(f'{dest}: {out.size[0]}x{out.size[1]} px')
