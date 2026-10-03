"""Export a song's resolved notation tree with LilyPond (build-time only).

python3 scripts/notation/export-lilypond.py <song-id> [--executable lilypond]
The source must define upper/lower music variables; the converted definitions
are retained alongside the original edition for reproducibility.
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('song')
parser.add_argument('--executable', default='lilypond')
args = parser.parse_args()
folder = (Path('src/data/score') / args.song).resolve()
song = json.loads((folder / 'song.json').read_text())
source = folder / song['preparation']['lilypond']
destination = folder / song['preparation']['music']
exporter = Path(__file__).with_suffix('.scm').resolve()
with tempfile.TemporaryDirectory(prefix='theater-score-') as scratch:
    wrapper = Path(scratch) / 'export.ly'
    wrapper.write_text(f'\\version "2.24.0"\n\\include {json.dumps(str(source), ensure_ascii=False)}\n'
        f'#(load {json.dumps(str(exporter), ensure_ascii=False)})\n'
        f'#(export-music {json.dumps(str(destination), ensure_ascii=False)} \'(upper lower))\n')
    subprocess.run([args.executable, '-dno-print-pages', '-dbackend=null', str(wrapper)],
        cwd=scratch, check=True)
json.loads(destination.read_text())
print(f'Exported {destination}')
