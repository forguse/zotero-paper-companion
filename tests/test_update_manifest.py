"""Release identity/hash checks use temporary synthetic XPIs, never a real profile."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
import zipfile
import hashlib

SPEC = importlib.util.spec_from_file_location('update_manifest', pathlib.Path(__file__).parents[1] / 'scripts/make_update_manifest.py')
UPDATES = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(UPDATES)


class UpdateManifestTests(unittest.TestCase):
    def setUp(self):
        # Retain tiny synthetic fixtures in the ignored test area; never recursively delete.
        fixtures = pathlib.Path(__file__).parents[1] / '.native-tests/update-manifest'
        fixtures.mkdir(parents=True, exist_ok=True)
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='check-', dir=fixtures))
        (self.root / 'addon').mkdir()
        (self.root / 'dist').mkdir()
        self.source = {'version': '1.2.3', 'applications': {'zotero': {
            'id': UPDATES.PLUGIN_ID, 'strict_min_version': '7.0', 'strict_max_version': '10.0.*',
            'update_url': 'https://example.invalid/updates.json'}}}
        self.package = self.root / 'dist/paper-companion-1.2.3.xpi'
        self.write_source()
        self.pack()

    def write_source(self):
        (self.root / 'addon/manifest.json').write_text(json.dumps(self.source), encoding='utf-8')
        (self.root / 'package.json').write_text(json.dumps({'version': self.source['version']}), encoding='utf-8')

    def pack(self, source=None):
        with zipfile.ZipFile(self.package, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(self.source if source is None else source))
            for name in ('bootstrap.js', 'content/panel.xhtml', 'LICENSE'):
                archive.writestr(name, 'synthetic fixture')

    def test_default_output_hash_identity_and_compatibility(self):
        path = UPDATES.prepare(self.root)
        self.assertEqual(path, self.root / 'dist/updates.json')
        update = json.loads(path.read_text())['addons'][UPDATES.PLUGIN_ID]['updates'][0]
        self.assertEqual(update['version'], '1.2.3')
        self.assertEqual(update['update_link'], 'https://github.com/forguse/zotero-paper-companion/releases/download/v1.2.3/INSTALL-LATEST.xpi')
        self.assertEqual(update['update_hash'], 'sha256:' + hashlib.sha256(self.package.read_bytes()).hexdigest())
        self.assertEqual(update['applications']['zotero']['strict_max_version'], '10.0.*')

    def test_custom_https_host_and_output(self):
        output = self.root / 'prepared/update.json'
        UPDATES.prepare(self.root, download_url='https://downloads.example.org/plugin.xpi', tag='v1.2.3', output=output)
        self.assertTrue(output.is_file())

    def test_reject_untrusted_url_forms(self):
        for url in ('http://example.org/a.xpi', 'https://user:secret@example.org/a.xpi', 'https://example.org/a.xpi?token=secret',
                    'https://example.org/a.xpi#fragment', 'https://example.org:8443/a.xpi', 'https://example.org/a xpi', 'javascript:alert(1)'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                UPDATES.prepare(self.root, download_url=url)
        self.assertFalse((self.root / 'dist/updates.json').exists())

    def test_reject_wrong_plugin_id(self):
        self.source['applications']['zotero']['id'] = 'other@example.org'
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'Plugin ID'):
            UPDATES.prepare(self.root)

    def test_reject_source_package_and_tag_version_mismatch(self):
        packed = json.loads(json.dumps(self.source)); packed['version'] = '1.2.2'; self.pack(packed)
        with self.assertRaisesRegex(ValueError, 'manifest does not match'):
            UPDATES.prepare(self.root)
        self.pack()
        with self.assertRaisesRegex(ValueError, 'tag must match'):
            UPDATES.prepare(self.root, tag='v1.2.2')
        (self.root / 'package.json').write_text('{"version":"1.2.2"}')
        with self.assertRaisesRegex(ValueError, 'versions do not match'):
            UPDATES.prepare(self.root)

    def test_reject_different_fixed_installer(self):
        (self.root / 'INSTALL-LATEST.xpi').write_bytes(b'older installer')
        with self.assertRaisesRegex(ValueError, 'differs'):
            UPDATES.prepare(self.root)

    def test_reject_overwriting_source_or_xpi(self):
        for output in (self.package, self.root / 'addon/manifest.json', self.root / 'package.json'):
            with self.subTest(output=str(output)), self.assertRaisesRegex(ValueError, 'Output must'):
                UPDATES.prepare(self.root, output=output)

    def test_reject_bad_repository_asset_and_compatibility(self):
        for options in ({'repository': 'owner/repo/extra'}, {'asset_name': '../plugin.xpi'}, {'asset_name': 'release.exe'}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                UPDATES.prepare(self.root, **options)
        self.source['applications']['zotero']['strict_min_version'] = ''
        self.write_source()
        with self.assertRaisesRegex(ValueError, 'compatibility'):
            UPDATES.prepare(self.root)


if __name__ == '__main__':
    unittest.main()
