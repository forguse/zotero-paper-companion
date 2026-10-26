#!/usr/bin/env python3
"""Build a dependency-free XPI. Never package profiles, credentials or tests."""
import json
import pathlib
import zipfile
import shutil
from manifest_checks import validate_manifest

ROOT = pathlib.Path(__file__).resolve().parents[1]
addon = ROOT / 'addon'
# Explicit runtime list: local notes, credentials and newly generated files must
# never enter an install package merely because they were placed under addon/.
RUNTIME_FILES = {
    'bootstrap.js', 'manifest.json',
    'content/WebBridgeChild.sys.mjs', 'content/auth.js', 'content/core.js', 'content/persistence.js', 'content/sessions.js', 'content/edge-light.js', 'content/appearance.js', 'content/appearance.css', 'content/ui.js', 'content/chat-view.js', 'content/chat-drafts.js',
    'content/icon.svg', 'content/insights.js', 'content/formula.js', 'content/math.js', 'content/native.js',
    'content/note-editor.js', 'content/panel.css', 'content/panel.js',
    'content/panel.xhtml', 'content/paper-files.js', 'content/sidebar.js', 'content/reading.js', 'content/preread.js',
    'content/webview.js', 'content/usage-store.js', 'content/usage.js', 'content/usage-panel.js', 'locale/en-US/paper-companion.ftl',
    'content/model-gateway.js', 'content/chat-service.js', 'content/settings-panel.js',
    'content/reading-scope.js', 'content/reading-scope-ui.js', 'content/note-insertions.js',
    'content/note-receipt-ui.js', 'content/action-guide.js', 'content/experience.css',
    'content/uninstall-service.js', 'content/uninstall-ui.js', 'content/uninstall.css',
    'content/vocabulary.js', 'content/vocabulary-ui.js', 'content/vocabulary.css', 'content/vocabulary.xhtml', 'content/theme-cloud-mist.webp',
    'locale/zh-CN/paper-companion.ftl', 'content/icons/LICENSE',
    *('content/icons/' + name + '.svg' for name in (
        'languages', 'messages-square', 'notebook-pen', 'refresh-cw',
        'scan-text', 'settings-2', 'sparkles', 'book-open')),
    'content/vendor/katex/katex.min.js', 'content/vendor/katex/katex.min.css',
    'content/vendor/katex/LICENSE', 'content/vendor/katex/SOURCE.md',
    *('content/vendor/katex/fonts/' + name + '.woff2' for name in (
        'KaTeX_AMS-Regular', 'KaTeX_Caligraphic-Bold', 'KaTeX_Caligraphic-Regular',
        'KaTeX_Fraktur-Bold', 'KaTeX_Fraktur-Regular', 'KaTeX_Main-Bold',
        'KaTeX_Main-BoldItalic', 'KaTeX_Main-Italic', 'KaTeX_Main-Regular',
        'KaTeX_Math-BoldItalic', 'KaTeX_Math-Italic', 'KaTeX_SansSerif-Bold',
        'KaTeX_SansSerif-Italic', 'KaTeX_SansSerif-Regular', 'KaTeX_Script-Regular',
        'KaTeX_Size1-Regular', 'KaTeX_Size2-Regular', 'KaTeX_Size3-Regular',
        'KaTeX_Size4-Regular', 'KaTeX_Typewriter-Regular'))
}
manifest = json.loads((addon / 'manifest.json').read_text(encoding='utf-8'))
validate_manifest(manifest)
version = manifest['version']
package_version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
if package_version != version:
    raise ValueError(f'Version mismatch: manifest.json={version}, package.json={package_version}')
out = ROOT / 'dist'
out.mkdir(exist_ok=True)
target = out / f'paper-companion-{version}.xpi'
with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as z:
    for name in sorted(RUNTIME_FILES):
        file = addon / name
        if not file.is_file():
            raise FileNotFoundError('Missing required runtime file: ' + name)
        z.write(file, name)
    z.write(ROOT / 'LICENSE', 'LICENSE')
with zipfile.ZipFile(target) as z:
    assert z.testzip() is None
    assert {'bootstrap.js', 'manifest.json', 'content/panel.xhtml'} <= set(z.namelist())
    assert set(z.namelist()) == RUNTIME_FILES | {'LICENSE'}
shutil.copy2(target, ROOT / 'INSTALL-LATEST.xpi')
print(target)
print(ROOT / 'INSTALL-LATEST.xpi')
