import re
from fontTools.ttLib import TTFont, TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.varLib.instancer import instantiateVariableFont

def load(path, wght=None, idx=None):
    f = TTCollection(path).fonts[idx] if idx is not None else TTFont(path)
    if wght: f = instantiateVariableFont(f, {"wght": wght, "wdth": 100} if 'wdth' in [a.axisTag for a in f['fvar'].axes] else {"wght": wght})
    return f

def run(font, text, size, x, base, track=0):
    gs, cmap, upm = font.getGlyphSet(), font.getBestCmap(), font['head'].unitsPerEm
    s = size/upm; pen = SVGPathPen(gs); out=[]
    for ch in text:
        g = cmap[ord(ch)]
        gs[g].draw(TransformPen(pen, (s,0,0,-s,x,base)))
        x += gs[g].width*s + track
    return pen.getCommands(), x

U="/usr/share/fonts/truetype/ubuntu/Ubuntu[wdth,wght].ttf"
bold, light = load(U,700), load(U,300)
cjk = load("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc", idx=0)
for i,f in enumerate(TTCollection("/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc").fonts):
    if 'JP' in f['name'].getDebugName(1): cjk=f; break

mark = open("icon-work/concept-a.svg").read()
inner = re.search(r'<svg[^>]*>(.*)</svg>', mark, re.S).group(1)
inner = re.sub(r'id="(bg|brass)"', r'id="m-\1"', inner).replace('url(#bg)','url(#m-bg)').replace('url(#brass)','url(#m-brass)')
inner = re.sub(r'<!--.*?-->','',inner)

W,H=556,120
for name, main, mfont, msize, track in [("karaoke-logo","KARAOKE",bold,58,3),("karaoke-logo-japanese","カラオケ",cjk,62,2)]:
    d1, x = run(mfont, main, msize, 132, 82, track)
    d2, x2 = run(light, "by Thy", 34, x+14, 82)
    svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 538 112" role="img" aria-label="Karaoke by Thy">
<g transform="translate(4 4) scale(0.4375)">{inner}</g>
<path fill="#f5f0e6" d="{d1}"/>
<path fill="#deb668" d="{d2}"/>
</svg>'''
    open(f"icon-work/{name}.svg","w").write(svg); print(name, round(x2))
