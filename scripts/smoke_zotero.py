#!/usr/bin/env python3
"""Prepare disposable Zotero profile, never touching a normal user's profile.
Usage: python scripts/smoke_zotero.py /tmp/pc-smoke
Then start Zotero with -no-remote -profile /tmp/pc-smoke/profile.
"""
import json, pathlib, sys, zipfile, subprocess
from reportlab.pdfgen import canvas

root=pathlib.Path(__file__).resolve().parents[1]
target=pathlib.Path(sys.argv[1]).resolve()
if target == pathlib.Path.home() or target == pathlib.Path('/'):
    raise SystemExit('Use a dedicated disposable directory, never a home or root directory.')
profile=target/'profile'; data=target/'data'
(profile/'extensions').mkdir(parents=True,exist_ok=True); data.mkdir(exist_ok=True)
(target/'result.json').unlink(missing_ok=True)
subprocess.run([sys.executable,str(root/'scripts/build.py')],check=True)
version=json.loads((root/'addon/manifest.json').read_text(encoding='utf-8'))['version']
# Installation persistence checks must begin without a registered product.
# They install the built package through AddonManager during the first launch.
if '--install-restart' not in sys.argv[2:]:
    (profile/'extensions/paper-companion@local.xpi').write_bytes((root/f'dist/paper-companion-{version}.xpi').read_bytes())
pdf=target/'two-pages.pdf'
c=canvas.Canvas(str(pdf));c.setFont('Helvetica',18);c.drawString(55,770,'Unfixed Cup Transport');c.setFont('Helvetica',12);c.drawString(55,730,'PAGE_ONE_MARKER: acceleration and liquid sloshing.');c.setFillColorRGB(.15,.45,.35);c.rect(55,500,380,120,fill=1);c.showPage();c.setFont('Helvetica',18);c.drawString(55,770,'Experimental results');c.setFont('Helvetica',12);c.drawString(55,730,'PAGE_TWO_MARKER: the controller reduced spill risk.');c.save()
if '--vocabulary' in sys.argv[2:]:
    c=canvas.Canvas(str(pdf)); c.setFont('Helvetica',18); c.drawString(55,770,'Understanding liquid transport'); c.setFont('Helvetica',12); c.drawString(55,730,'Acceleration can affect the stability of liquid transport.'); c.showPage(); c.setFont('Helvetica',18); c.drawString(55,770,'Experimental results'); c.setFont('Helvetica',12); c.drawString(55,730,'In our experiments, the controller reduced spill risk.'); c.save()
harness_name = 'insights-native-harness.js' if '--insights' in sys.argv[2:] else 'zotero-harness.js'
if '--storage' in sys.argv[2:]: harness_name = 'storage-native-harness.js'
if '--formula' in sys.argv[2:]: harness_name = 'formula-native-harness.js'
if '--reading' in sys.argv[2:]: harness_name = 'reading-native-harness.js'
if '--web' in sys.argv[2:]: harness_name = 'web-native-harness.js'
if '--usage' in sys.argv[2:]: harness_name = 'usage-native-harness.js'
if '--workspace' in sys.argv[2:]: harness_name = 'workspace-native-harness.js'
if '--uiux' in sys.argv[2:]: harness_name = 'uiux-native-harness.js'
if '--preread' in sys.argv[2:]: harness_name = 'preread-native-harness.js'
if '--clear-restart' in sys.argv[2:]: harness_name = 'clear-restart-native-harness.js'
if '--vocabulary' in sys.argv[2:]: harness_name = 'vocabulary-native-harness.js'
if '--vocabulary-window' in sys.argv[2:]: harness_name = 'vocabulary-window-native-harness.js'
if '--four-themes' in sys.argv[2:]: harness_name = 'four-themes-native-harness.js'
if '--native-appearance' in sys.argv[2:]: harness_name = 'native-appearance-harness.js'
if '--chat-layout' in sys.argv[2:]: harness_name = 'chat-layout-native-harness.js'
if '--chat-interactions' in sys.argv[2:]: harness_name = 'chat-interactions-native-harness.js'
if '--install-restart' in sys.argv[2:]: harness_name = 'install-restart-native-harness.js'
if '--appearance-restart' in sys.argv[2:]: harness_name = 'appearance-restart-native-harness.js'
if '--polish' in sys.argv[2:]: harness_name = 'polish-native-harness.js'
if '--iteration' in sys.argv[2:]: harness_name = 'iteration-native-harness.js'
if '--edge-light' in sys.argv[2:]: harness_name = 'edge-light-native-harness.js'
if '--experience' in sys.argv[2:]: harness_name = 'experience-native-harness.js'
if '--uninstall-cleanup' in sys.argv[2:]: harness_name = 'uninstall-native-harness.js'
if '--notes' in sys.argv[2:]:
    harness_name = 'notes-native-harness.js'
    settings_dir=profile/'paper-companion'; settings_dir.mkdir(exist_ok=True)
    (settings_dir/'settings.json').write_text(json.dumps({'autoRecord':True}),encoding='utf-8')
other_pdf=target/'other-paper.pdf'
if '--reading' in sys.argv[2:]:
    other=canvas.Canvas(str(other_pdf));other.setFont('Helvetica',16);other.drawString(55,770,'ALTERNATIVE_STUDY_MARKER');other.setFont('Helvetica',12);other.drawString(55,730,'A passive cup lid reduces spill risk without any learned controller.');other.save()
harness=(root/'tests'/harness_name).read_text(encoding='utf-8')
harness=harness.replace('__EXPECTED_VERSION__',version)
harness=harness.replace('__EXPECTED_CONTROLS__',(root/'tests/ui-controls.json').read_text(encoding='utf-8'))
for marker, file in {'__OUTPUT__': target/'result.json', '__PDF__': pdf, '__OTHER_PDF__':other_pdf, '__PACKAGE__': root/'INSTALL-LATEST.xpi',
    '__SCREENSHOT__': target/'panel.png', '__WEB_FIXTURE__': target/'web-fixture.html',
    '__WEB_SCREENSHOT__': target/'web-panel.png', '__NOTES_SCREENSHOT__': target/'notes-panel.png',
    '__POPUP_SCREENSHOT__': target/'selection-popup.png', '__REAL_POPUP_SCREENSHOT__': target/'real-selection-popup.png'}.items():
    harness = harness.replace("'" + marker + "'", json.dumps(str(file)))
with zipfile.ZipFile(profile/'extensions/zz-paper-companion-test@local.xpi','w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json',json.dumps({'manifest_version':2,'name':'Paper Companion disposable smoke test','version':'1.0.0','applications':{'zotero':{'id':'zz-paper-companion-test@local','update_url':'https://paper-companion.invalid/updates.json','strict_min_version':'7.0','strict_max_version':'10.0.*'}}}))
    z.writestr('bootstrap.js',harness)
    z.write(root/'tests/WebTestChild.sys.mjs','content/WebTestChild.sys.mjs')
    if any(flag in sys.argv[2:] for flag in ('--uiux','--polish','--iteration','--edge-light','--vocabulary-window','--four-themes','--chat-interactions','--experience','--uninstall-cleanup')):
        z.writestr('content/viewport.xhtml','<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Disposable UI audit</title><style>html,body{margin:0;padding:0}iframe{display:block;border:0}</style></head><body></body></html>')
(target/'web-fixture.html').write_bytes((root/'tests/web-fixture.html').read_bytes())
prefs={'extensions.zotero.dataDir':str(data),'extensions.zotero.useDataDir':True,'extensions.zotero.firstRun2':False,'extensions.zotero.firstRun':False,'extensions.autoDisableScopes':0,'extensions.enabledScopes':15,'extensions.zotero.automaticScraperUpdates':False,'extensions.zotero.sync.autoSync':False,'extensions.update.enabled':False,'app.update.auto':False,'browser.shell.checkDefaultBrowser':False,'toolkit.telemetry.enabled':False}
(profile/'user.js').write_text('\n'.join('user_pref('+json.dumps(k)+', '+json.dumps(v)+');' for k,v in prefs.items()))
print(profile)
