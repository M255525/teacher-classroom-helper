# 產生 PWA 圖示：木框黑板＋粉筆長條圖（投票）＋粉筆勾勾
import os
from PIL import Image, ImageDraw

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons')


def draw(size, pad):
    s = 4 * size
    im = Image.new('RGB', (s, s), '#7A5232')
    d = ImageDraw.Draw(im)
    x0, x1 = pad * s, (1 - pad) * s
    w = x1 - x0
    d.rounded_rectangle([x0, x0, x1, x1], radius=w * .08, fill='#5B3B22')
    m = w * .07
    d.rounded_rectangle([x0 + m, x0 + m, x1 - m, x1 - m], radius=w * .05, fill='#1D3A2E')
    # 粉筆長條
    base = x1 - m - w * .16
    bw = w * .14
    cols = ['#F6D86B', '#F5A3C7', '#8FCBF2']
    hs = [.42, .62, .3]
    for i, (c, h) in enumerate(zip(cols, hs)):
        bx = x0 + m + w * .12 + i * (bw + w * .07)
        d.rounded_rectangle([bx, base - w * h, bx + bw, base], radius=bw * .2, fill=c)
    d.line([(x0 + m + w * .08, base + w * .025), (x1 - m - w * .08, base + w * .025)], fill='#F3F0E6', width=int(w * .022))
    # 勾勾
    cx, cy, r = x1 - m - w * .19, x0 + m + w * .2, w * .1
    d.line([(cx - r, cy), (cx - r * .25, cy + r * .75), (cx + r * 1.05, cy - r * .8)], fill='#A6E59A', width=int(w * .045), joint='curve')
    # 粉筆槽
    d.rectangle([x0 + w * .2, x1 - m * .55, x1 - w * .2, x1 - m * .2], fill='#4A2F1A')
    return im.resize((size, size), Image.LANCZOS)


draw(192, .04).save(os.path.join(out, 'icon-192.png'))
draw(512, .04).save(os.path.join(out, 'icon-512.png'))
draw(512, .14).save(os.path.join(out, 'icon-maskable-512.png'))
