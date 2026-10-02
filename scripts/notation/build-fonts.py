"""Extract the engraving fonts and their metrics for the notation engine.

Run with `python3 scripts/notation/build-fonts.py` (needs fontTools and brotli).

The fonts come from the VexFlow package, which embeds them as base64 WOFF2:
Bravura (SMuFL music font) and Academico (text font for tempo and expression
words), both by Steinberg under the SIL Open Font License. This script writes

- public/fonts/*.woff2                      the fonts served to the browser
- src/notation/fonts/metrics.json           glyph boxes and advances in staff spaces

Only the SMuFL glyphs the engine refers to are measured. A glyph is referred to
when its SMuFL name appears as a string literal under src/notation/, or when it
belongs to one of the numbered families in NUMBERED (time signature digits and
the like are looked up by building their name). Layout reads only this file, so
it runs the same in the browser and in Node tests.
"""
from __future__ import annotations

import base64
import io
import json
import re
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
VEXFLOW = ROOT / 'node_modules/vexflow/build/esm/src'
FONT_OUT = ROOT / 'public/fonts'
METRICS_OUT = ROOT / 'src/notation/fonts/metrics.json'
SOURCES = ROOT / 'src/notation'

FONTS = {'bravura': 'Bravura', 'academico': 'Academico', 'academicobold': 'AcademicoBold'}
NUMBERED = [r'timeSig\d', r'tuplet\d', r'fingering\d', r'dynamic[A-Z]\w*', r'flag\d+\w+', r'rest\d+\w*']
TEXT_CHARS = [chr(code) for code in range(0x20, 0x7F)] + [chr(code) for code in range(0xA0, 0x180)] + list('–—‘’“”…♩♪')
# SMuFL: one em is four staff spaces.
SPACES_PER_EM = 4


def embedded_font(module: str) -> bytes:
    source = (VEXFLOW / 'fonts' / f'{module}.js').read_text()
    match = re.search(r'base64,([A-Za-z0-9+/=]+)', source)
    if not match:
        raise ValueError(f'No embedded font in {module}.js')
    return base64.b64decode(match.group(1))


def smufl_names() -> dict[str, int]:
    source = (VEXFLOW / 'glyphs.js').read_text()
    return {name: int(code, 16) for name, code in re.findall(r'Glyphs\["(\w+)"\] = "\\u([0-9A-F]{4})"', source)}


def referenced(names: dict[str, int]) -> list[str]:
    wanted: set[str] = set()
    for path in SOURCES.rglob('*.ts'):
        for literal in re.findall(r"['\"`]\$?\{?(\w+)\}?(?:Above|Below)?['\"`]", path.read_text()):
            # Names built as `${glyph}Above` / `${glyph}Below` count too.
            for name in (literal, f'{literal}Above', f'{literal}Below'):
                if name in names:
                    wanted.add(name)
    patterns = [re.compile(f'^{pattern}$') for pattern in NUMBERED]
    wanted.update(name for name in names if any(pattern.match(name) for pattern in patterns))
    return sorted(wanted)


def round3(value: float) -> float:
    return round(value, 3)


def music_metrics(font: TTFont, names: dict[str, int], wanted: list[str]) -> dict:
    units = font['head'].unitsPerEm / SPACES_PER_EM
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    glyphs = {}
    for name in wanted:
        glyph_name = cmap.get(names[name])
        if glyph_name is None:
            continue
        pen = BoundsPen(glyph_set)
        glyph_set[glyph_name].draw(pen)
        x0, y0, x1, y1 = pen.bounds or (0, 0, 0, 0)
        glyphs[name] = {
            'codepoint': f'{names[name]:04X}',
            'box': [round3(x0 / units), round3(y0 / units), round3(x1 / units), round3(y1 / units)],
            'advance': round3(font['hmtx'][glyph_name][0] / units),
        }
    return glyphs


def text_metrics(font: TTFont) -> dict:
    em = font['head'].unitsPerEm
    cmap = font.getBestCmap()
    advances = {}
    for char in TEXT_CHARS:
        glyph_name = cmap.get(ord(char))
        if glyph_name is not None:
            advances[char] = round3(font['hmtx'][glyph_name][0] / em)
    os2 = font['OS/2']
    return {
        'ascent': round3(os2.sTypoAscender / em),
        'descent': round3(-os2.sTypoDescender / em),
        'capHeight': round3(getattr(os2, 'sCapHeight', 700) / em),
        'xHeight': round3(getattr(os2, 'sxHeight', 450) / em),
        'fallbackAdvance': advances.get('n', 0.5),
        'advances': advances,
    }


def main() -> None:
    FONT_OUT.mkdir(parents=True, exist_ok=True)
    METRICS_OUT.parent.mkdir(parents=True, exist_ok=True)
    names = smufl_names()
    wanted = referenced(names)
    metrics: dict = {'generatedBy': 'scripts/notation/build-fonts.py', 'music': {}, 'text': {}}
    for module, family in FONTS.items():
        data = embedded_font(module)
        (FONT_OUT / f'{module}.woff2').write_bytes(data)
        font = TTFont(io.BytesIO(data))
        if module == 'bravura':
            metrics['music'] = {
                'family': family,
                'version': font['name'].getDebugName(5),
                'glyphs': music_metrics(font, names, wanted),
            }
        else:
            metrics['text'][family] = text_metrics(font)
    missing = sorted(set(wanted) - set(metrics['music']['glyphs']))
    if missing:
        print('Not in Bravura:', ', '.join(missing))
    METRICS_OUT.write_text(json.dumps(metrics, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(f"{len(metrics['music']['glyphs'])} music glyphs, {len(metrics['text'])} text faces → {METRICS_OUT.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
