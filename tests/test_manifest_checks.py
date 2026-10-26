import copy
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('manifest_checks', pathlib.Path(__file__).resolve().parents[1] / 'scripts/manifest_checks.py')
checks = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checks)

class ManifestChecks(unittest.TestCase):
    def setUp(self):
        self.value = {'version': '0.28.0', 'applications': {'zotero': {
            'id': checks.PLUGIN_ID, 'strict_min_version': '7.0', 'strict_max_version': '10.0.*',
            'update_url': 'https://github.com/owner/repo/releases/latest/download/updates.json'}}}

    def test_valid_manifest_does_not_mutate_metadata(self):
        before = copy.deepcopy(self.value)
        self.assertEqual(checks.validate_manifest(self.value)['id'], checks.PLUGIN_ID)
        self.assertEqual(self.value, before)

    def test_zotero_mandatory_fields_cannot_be_omitted(self):
        for field in ('id', 'update_url', 'strict_min_version', 'strict_max_version'):
            with self.subTest(field=field):
                value = copy.deepcopy(self.value); value['applications']['zotero'].pop(field)
                with self.assertRaises(ValueError): checks.validate_manifest(value)

    def test_empty_or_unsafe_update_urls_are_rejected(self):
        for url in ('', 'http://example.org/update.json', 'javascript:alert(1)',
                    'https://user:secret@example.org/update.json', 'https://example.org/update.json?token=secret',
                    'https://example.org:invalid/update.json', 'https://example.org:99999/update.json',
                    'https://example.org/update.json#fragment', 'https://example.org/ update.json'):
            with self.subTest(url=url):
                self.value['applications']['zotero']['update_url'] = url
                with self.assertRaises(ValueError): checks.validate_manifest(self.value)

    def test_plugin_identity_and_compatibility_must_remain_valid(self):
        self.value['applications']['zotero']['id'] = 'another-plugin@local'
        with self.assertRaises(ValueError): checks.validate_manifest(self.value)
        self.value['applications']['zotero']['id'] = checks.PLUGIN_ID
        self.value['applications']['zotero']['strict_max_version'] = '10.0.* anything'
        with self.assertRaises(ValueError): checks.validate_manifest(self.value)

    def test_missing_or_invalid_version_is_rejected(self):
        for version in (None, '', 'latest', '0.28.0\n'):
            self.value['version'] = version
            with self.assertRaises(ValueError): checks.validate_manifest(self.value)

if __name__ == '__main__': unittest.main()
