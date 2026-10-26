"""Capture the real plugin UI in a disposable Zotero profile with example content."""
import json
import pathlib
import sys
import zipfile
import argparse
from reportlab.pdfgen import canvas

root = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('target', type=pathlib.Path)
parser.add_argument('--output', type=pathlib.Path)
parser.add_argument('--layout', action='store_true', help='Capture narrow sidebar layouts and measure control access')
parser.add_argument('--motion', action='store_true', help='Record native UI frames for an animation preview (with --layout)')
args = parser.parse_args()
target = args.target.resolve()
if target.exists():
    raise SystemExit('Use a NEW disposable directory; existing profiles must not be overwritten.')
output = args.output.resolve() if args.output else root / 'promo' / 'xiaohongshu' / 'v0.8.0' / 'screenshots'
output.mkdir(parents=True, exist_ok=True)
profile = target / 'profile'
data = target / 'data'
(profile / 'extensions').mkdir(parents=True, exist_ok=True)
data.mkdir(parents=True, exist_ok=True)
(profile / 'extensions' / 'paper-companion@local.xpi').write_bytes((root / 'INSTALL-LATEST.xpi').read_bytes())
pdf = target / 'attention-reading-demo.pdf'
c = canvas.Canvas(str(pdf))
c.setTitle('Attention Mechanisms - Reading Demo')
c.setFillColorRGB(.13, .31, .25)
c.setFont('Helvetica-Bold', 23)
c.drawString(55, 770, 'Understanding Attention')
c.setFont('Helvetica', 12)
c.drawString(55, 744, 'Paper Companion / Example reading material')
c.setFillColorRGB(.12, .15, .14)
sections = [
    ('1  Why attention?', ['Attention assigns different weights to different parts of an input.',
     'A query is compared with keys, then the resulting scores are normalized.',
     'The output combines values according to these weights.']),
    ('2  Queries, keys and values', ['Q represents the information being requested.',
     'K represents the information used for matching.',
     'V contains the information that will be aggregated.']),
    ('3  A reading question', ['How do Q, K and V work together?',
     'Select a passage and discuss it in the reading sidebar.'])]
y = 692
for heading, lines in sections:
    c.setFont('Helvetica-Bold', 15); c.drawString(55, y, heading); y -= 30
    c.setFont('Helvetica', 11)
    for line in lines: c.drawString(55, y, line); y -= 22
    y -= 25
c.setFillColorRGB(.91, .95, .92); c.roundRect(55, 216, 485, 105, 9, fill=1, stroke=0)
c.setFillColorRGB(.13, .31, .25); c.setFont('Courier', 12)
c.drawString(75, 279, 'Attention(Q,K,V) = softmax(QK^T / sqrt(d)) V')
c.setFont('Helvetica', 10); c.drawString(75, 249, 'Example content only. This is not a published research paper.')
c.setFillColorRGB(.5, .5, .5); c.setFont('Helvetica', 9); c.drawString(55, 54, 'Reading demo / 1'); c.save()
harness = (root / 'tests' / 'showcase-harness.js').read_text(encoding='utf-8')
harness = harness.replace('__LAYOUT_CAPTURE__', 'true' if args.layout else 'false')
harness = harness.replace('__MOTION_CAPTURE__', 'true' if args.motion else 'false')
harness = harness.replace('__EXPECTED_CONTROLS__', (root / 'tests' / 'ui-controls.json').read_text(encoding='utf-8') if args.layout else '{}')
for marker, value in {'__PDF__': str(pdf), '__OUTPUT__': str(target / 'result.json'), '__ASSETS__': str(output)}.items():
    harness = harness.replace("'" + marker + "'", json.dumps(value))
manifest = {'manifest_version': 2, 'name': 'Disposable screenshot capture', 'version': '1.0.0', 'applications': {'zotero': {'id': 'zz-paper-companion-showcase@local', 'update_url': 'https://paper-companion.invalid/updates.json', 'strict_min_version': '7.0', 'strict_max_version': '10.0.*'}}}
with zipfile.ZipFile(profile / 'extensions' / 'zz-paper-companion-showcase@local.xpi', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(manifest))
    z.writestr('bootstrap.js', harness)
    z.writestr('content/viewport.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Paper Companion layout check</title><style>html,body{margin:0;padding:0}iframe{display:block;border:0}</style></head><body></body></html>')
prefs = {'extensions.zotero.dataDir': str(data), 'extensions.zotero.useDataDir': True, 'extensions.zotero.firstRun2': False,
         'extensions.zotero.firstRun': False, 'extensions.autoDisableScopes': 0, 'extensions.enabledScopes': 15,
         'extensions.zotero.automaticScraperUpdates': False, 'extensions.zotero.sync.autoSync': False,
         'extensions.update.enabled': False, 'app.update.auto': False, 'browser.shell.checkDefaultBrowser': False,
         'toolkit.telemetry.enabled': False, 'ui.systemUsesDarkTheme': 0}
(profile / 'user.js').write_text('\n'.join('user_pref(' + json.dumps(k) + ', ' + json.dumps(v) + ');' for k, v in prefs.items()), encoding='utf-8')
print(profile)
print(output)
