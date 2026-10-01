# Build wallpaper assets for the whale-girl plugin (self-contained).
#   python build_assets.py
# Writes into <root>\.work\assets\img :
#   mature-cover.webp / mature-cover-720.webp / mature-figure.webp
#   chibi-cover.webp  / chibi-cover-720.webp  / chibi-figure.webp
import os
import sys
import numpy as np
from PIL import Image, ImageFilter
from collections import deque

ROOT = r"E:\vibecoding\dsh_bizhi"
IMG = os.path.join(ROOT, ".work", "assets", "img")
TOOLS = os.path.join(ROOT, ".work", "tools")
os.makedirs(IMG, exist_ok=True)
os.makedirs(TOOLS, exist_ok=True)

SRC_MATURE = "\u6210\u719f\u6bd4\u4f8b\u9cb8\u9c7c\u5a18.png"   # 1448x1086
SRC_CHIBI = "Q\u7248\u5927\u80a5\u9c7c.png"                    # 1448x1086

JOBS = [
    dict(slug="mature", file=SRC_MATURE, crop=(8, 8, 364, 1055)),
    dict(slug="chibi",  file=SRC_CHIBI,  crop=(5, 5, 544, 622)),
]


# ------------------------------------------------------------------ helpers
def fsize(p):
    return os.path.getsize(p)


def box_dilate(mask, r):
    """Binary dilation with a (2r+1)^2 box."""
    m = mask.astype(np.uint8)
    out = m.copy()
    for s in range(1, r + 1):
        out[:, s:] |= m[:, :-s]
        out[:, :-s] |= m[:, s:]
    m2 = out.copy()
    for s in range(1, r + 1):
        out[s:, :] |= m2[:-s, :]
        out[:-s, :] |= m2[s:, :]
    return out.astype(bool)


def clean_components(mask, min_size):
    """Drop 4-connected components of `mask` smaller than min_size."""
    h, w = mask.shape
    seen = np.zeros((h, w), bool)
    out = mask.copy()
    for sy, sx in np.argwhere(mask):
        if seen[sy, sx]:
            continue
        comp = []
        dq = deque([(sy, sx)])
        seen[sy, sx] = True
        while dq:
            y, x = dq.pop()
            comp.append((y, x))
            if y > 0 and mask[y - 1, x] and not seen[y - 1, x]:
                seen[y - 1, x] = True; dq.append((y - 1, x))
            if y + 1 < h and mask[y + 1, x] and not seen[y + 1, x]:
                seen[y + 1, x] = True; dq.append((y + 1, x))
            if x > 0 and mask[y, x - 1] and not seen[y, x - 1]:
                seen[y, x - 1] = True; dq.append((y, x - 1))
            if x + 1 < w and mask[y, x + 1] and not seen[y, x + 1]:
                seen[y, x + 1] = True; dq.append((y, x + 1))
        if len(comp) < min_size:
            for y, x in comp:
                out[y, x] = False
    return out


def dilate_value(rgb, r, have):
    """Spread the colour of `have` pixels outwards up to r px (nearest colour fill)."""
    src = rgb.astype(np.float32)
    out = src.copy()
    have = have.copy()
    for _ in range(r):
        nh = have.copy()
        nv = out.copy()
        v = (~have[1:, :]) & have[:-1, :]
        nv[1:, :] = np.where(v[:, :, None], src[:-1, :], nv[1:, :]); nh[1:, :] |= v
        v = (~nh[:-1, :]) & have[1:, :]
        nv[:-1, :] = np.where(v[:, :, None], src[1:, :], nv[:-1, :]); nh[:-1, :] |= v
        v = (~nh[:, 1:]) & have[:, :-1]
        nv[:, 1:] = np.where(v[:, :, None], src[:, :-1], nv[:, 1:]); nh[:, 1:] |= v
        v = (~nh[:, :-1]) & have[:, 1:]
        nv[:, :-1] = np.where(v[:, :, None], src[:, 1:], nv[:, :-1]); nh[:, :-1] |= v
        out, have = nv, nh
    return out


def flood_from_border(seed):
    """4-connected flood fill of `seed` starting at every border pixel of `seed`."""
    h, w = seed.shape
    bg = np.zeros((h, w), bool)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            if seed[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if seed[y, x] and not bg[y, x]:
                bg[y, x] = True; dq.append((y, x))
    while dq:
        y, x = dq.pop()
        if y > 0 and seed[y - 1, x] and not bg[y - 1, x]:
            bg[y - 1, x] = True; dq.append((y - 1, x))
        if y + 1 < h and seed[y + 1, x] and not bg[y + 1, x]:
            bg[y + 1, x] = True; dq.append((y + 1, x))
        if x > 0 and seed[y, x - 1] and not bg[y, x - 1]:
            bg[y, x - 1] = True; dq.append((y, x - 1))
        if x + 1 < w and seed[y, x + 1] and not bg[y, x + 1]:
            bg[y, x + 1] = True; dq.append((y, x + 1))
    return bg


def chamfer_distance(free):
    """Approximate Euclidean distance from every pixel to the nearest True in `free`."""
    h, w = free.shape
    INF = 1e9
    d = np.where(free, 0.0, INF).astype(np.float32)
    for y in range(h):
        row = d[y]
        if y > 0:
            prev = d[y - 1]
            np.minimum(row, prev + 1.0, out=row)
            np.minimum(row[1:], prev[:-1] + 1.41421356, out=row[1:])
            np.minimum(row[:-1], prev[1:] + 1.41421356, out=row[:-1])
        for x in range(1, w):
            if row[x - 1] + 1.0 < row[x]:
                row[x] = row[x - 1] + 1.0
    for y in range(h - 1, -1, -1):
        row = d[y]
        if y + 1 < h:
            nxt = d[y + 1]
            np.minimum(row, nxt + 1.0, out=row)
            np.minimum(row[1:], nxt[:-1] + 1.41421356, out=row[1:])
            np.minimum(row[:-1], nxt[1:] + 1.41421356, out=row[:-1])
        for x in range(w - 2, -1, -1):
            if row[x + 1] + 1.0 < row[x]:
                row[x] = row[x + 1] + 1.0
    return d


def shadow_region(fg, mn, mx, y_from, min_size=150):
    """Ground-plane drop shadow: very pale, low-saturation pixels below `y_from` that
    form blobs attached to dark (shoe) pixels."""
    h, w = fg.shape
    pale = (fg & (mn >= 238) & ((mx - mn) <= 26)
            & (np.arange(h)[:, None] >= y_from))
    dark = mn <= 150
    light = pale | dark
    seen = np.zeros((h, w), bool)
    out = np.zeros((h, w), bool)
    for sy, sx in np.argwhere(pale):
        if seen[sy, sx]:
            continue
        comp = []
        has_dark = False
        dq = deque([(sy, sx)])
        seen[sy, sx] = True
        while dq:
            y, x = dq.pop()
            comp.append((y, x))
            if dark[y, x]:
                has_dark = True
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and light[yy, xx] and not seen[yy, xx]:
                    seen[yy, xx] = True
                    dq.append((yy, xx))
        if has_dark and len(comp) >= min_size:
            for y, x in comp:
                out[y, x] = pale[y, x]
    return out


# -------------------------------------------------------------------- figure
def build_figure(src_path, crop, out_path, tag):
    im = Image.open(src_path).convert("RGB").crop(crop)
    rgb = np.asarray(im)
    h, w = rgb.shape[:2]
    mn = rgb.min(axis=2)
    mx = rgb.max(axis=2)

    # 1) flood fill the OUTER background only. The backdrop test accepts pure white /
    #    neutral pale grey plus the pale bluish grey of the artwork's soft drop shadow
    #    (blue slightly above red, low saturation); real white clothing is brighter and
    #    neutral, and is additionally protected by the border-connectivity requirement.
    b_r = rgb[:, :, 2].astype(np.int16) - rgb[:, :, 0].astype(np.int16)
    cand = (mn >= 235) | ((mn >= 205) & (b_r >= 5) & (b_r <= 22) & ((mx - mn) <= 24))
    seed = box_dilate(cand, 4) & (mn >= 205) & ((mx - mn) <= 26)
    bg = flood_from_border(seed)
    fg = ~bg

    # 2) drop tiny specks on both sides (>= 200 px of transparent / opaque mask)
    bg_clean = clean_components(bg, 200)
    fg_clean = clean_components(fg, 400)
    bg = bg_clean & ~fg_clean

    # 3) the soft grey drop shadow that lies on the ground under the shoes: pale blobs
    #    below the figure that touch dark (shoe) pixels. It fades out with distance from
    #    the character, which keeps every enclosed white area (apron, ruffles, tights)
    #    fully opaque because those are surrounded by pale pixels, not dark ones.
    L = mn.astype(np.float32)
    ys_all = np.nonzero(fg.any(axis=1))[0]
    y_from = int(ys_all.min() + 0.88 * (ys_all.max() - ys_all.min()))
    sh = shadow_region(fg, mn, mx, y_from)
    soft = np.ones((h, w), np.float32)
    if sh.any():
        anchor = (L <= 150) & fg
        d = chamfer_distance(anchor)
        ramp = np.clip(1.0 - (d - 5.0) / 30.0, 0.0, 1.0) ** 0.9
        soft = np.where(sh, ramp, 1.0)
        print("[%s] ground-shadow px=%d (%.2f%% of figure, y>=%d) mean alpha there=%.0f"
              % (tag, int(sh.sum()), 100.0 * sh.sum() / max(1, fg.sum()), y_from,
                 float(soft[sh].mean() * 255)))

    alpha = np.where(fg, soft, 0.0).astype(np.float32) * 255.0
    faded = fg & (soft < 0.999)
    print("[%s] crop=%s %dx%d  shadow-faded px=%d (%.2f%% of figure)"
          % (tag, crop, w, h, int(faded.sum()), 100.0 * faded.sum() / max(1, fg.sum())))

    # 4) colours under the feather: fill 5 px outwards so the anti-aliased rim carries
    #    character colour instead of white (kills the grey fringe on dark backdrops).
    edge_vals = np.where(fg[:, :, None], rgb.astype(np.float32), 0.0)
    filled = dilate_value(edge_vals, 5, fg.copy())
    colour = np.where(fg[:, :, None], rgb.astype(np.float32), filled).astype(np.uint8)

    # 5) feather alpha, premultiplied-safe (colour is not white outside the figure)
    alpha = np.asarray(Image.fromarray(alpha.astype(np.uint8), "L")
                       .filter(ImageFilter.GaussianBlur(1.5))).astype(np.uint8)

    # 6) tight crop to the figure and scale to ~1000 px tall
    ys, xs = np.nonzero(alpha > 4)
    pad = 6
    y0 = max(0, ys.min() - pad); y1 = min(h, ys.max() + 1 + pad)
    x0 = max(0, xs.min() - pad); x1 = min(w, xs.max() + 1 + pad)
    fig = Image.fromarray(np.dstack([colour, alpha])[y0:y1, x0:x1], "RGBA")
    src_h = fig.height
    tw = max(1, int(round(fig.width * 1000.0 / src_h)))
    fig = fig.resize((tw, 1000), Image.LANCZOS)
    fig.save(out_path, "WEBP", quality=88, method=6, exact=True)
    box = (crop[0] + x0, crop[1] + y0, crop[0] + x1, crop[1] + y1)
    print("[%s] figure %dx%d  tight source box=%s  bytes=%d mode=%s"
          % (tag, fig.width, fig.height, box, fsize(out_path), fig.mode))
    Image.fromarray(np.dstack([rgb, alpha]), "RGBA").save(
        os.path.join(TOOLS, "dbg-%s-crop.png" % tag))
    return box


# ---------------------------------------------------------------- cover image
def vignette_factor(h, w, inner=0.42, strength=0.55):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = (xx - (w - 1) / 2.0) / (w * 0.5)
    dy = (yy - (h - 1) / 2.0) / (h * 0.5)
    r = np.sqrt(dx * dx + dy * dy) / 1.41421356
    t = np.clip((r - inner) / (1.0 - inner), 0.0, 1.0)
    return (1.0 - strength * t * t).astype(np.float32)


def vertical_gradient(h, w, top=0.34, bottom=0.42, mid=0.06):
    v = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    g = 1.0 - (top * np.clip(1.0 - v / 0.42, 0.0, 1.0)
               + bottom * np.clip((v - 0.58) / 0.42, 0.0, 1.0)
               + mid * np.sin(np.pi * v))
    return np.repeat(g, w, axis=1).astype(np.float32)


def make_cover(src_path, out_path, w, h, quality, blur=2.0, dark=0.55, sat=0.82):
    """Full artwork scaled to COVER w x h (centre crop, no distortion), then prepared as
    a calm wallpaper backdrop: slight Gaussian blur, ~45% darkening, reduced saturation,
    vignette and a soft vertical dark gradient."""
    im = Image.open(src_path).convert("RGB")
    sw, sh = im.size
    scale = max(w / sw, h / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    im = im.resize((nw, nh), Image.LANCZOS)
    left, top = (nw - w) // 2, (nh - h) // 2
    im = im.crop((left, top, left + w, top + h)).filter(ImageFilter.GaussianBlur(blur))
    a = np.asarray(im).astype(np.float32)
    gray = (a * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(2, keepdims=True)
    a = gray + (a - gray) * sat
    a *= dark
    # gentle cool cast so the near-white backdrop reads as deep blue-grey, not grey
    a *= np.array([0.955, 0.985, 1.055], np.float32)
    a *= vignette_factor(h, w)[:, :, None]
    a *= vertical_gradient(h, w)[:, :, None]
    a = np.clip(a, 0, 255).astype(np.uint8)
    Image.fromarray(a, "RGB").save(out_path, "WEBP", quality=quality, method=6)
    lum = (a.astype(np.float32) * np.array([0.2126, 0.7152, 0.0722], np.float32)).sum(2)
    print("[cover] %-24s %dx%d q%d bytes=%d mean=%.1f luma=%.1f p95=%.0f"
          % (os.path.basename(out_path), w, h, quality, fsize(out_path),
             a.mean(), lum.mean(), np.percentile(a, 95)))


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else "all"
    for job in JOBS:
        src = os.path.join(ROOT, job["file"])
        slug = job["slug"]
        if only in ("all", "figure"):
            build_figure(src, job["crop"], os.path.join(IMG, "%s-figure.webp" % slug), slug)
        if only in ("all", "cover"):
            make_cover(src, os.path.join(IMG, "%s-cover.webp" % slug), 1920, 1080, 82)
            make_cover(src, os.path.join(IMG, "%s-cover-720.webp" % slug), 1280, 720, 80)
        print()
    total = 0
    print("--- outputs")
    for f in sorted(os.listdir(IMG)):
        if not f.lower().endswith(".webp"):
            continue
        p = os.path.join(IMG, f)
        with Image.open(p) as o:
            total += fsize(p)
            print("%-26s %dx%d mode=%-5s bytes=%d" % (f, o.width, o.height, o.mode, fsize(p)))
    print("TOTAL %d bytes (%.2f MB)" % (total, total / 1048576.0))


if __name__ == "__main__":
    main()
