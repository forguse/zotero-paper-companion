"""Shared build-time checks for Zotero's mandatory installation metadata."""
import re
import urllib.parse

PLUGIN_ID = 'paper-companion@local'

def validate_manifest(manifest):
    app = manifest.get('applications', {}).get('zotero', {})
    if app.get('id') != PLUGIN_ID:
        raise ValueError('Plugin ID must remain ' + PLUGIN_ID)
    for name in ('update_url', 'strict_min_version', 'strict_max_version'):
        if not isinstance(app.get(name), str) or not app[name].strip():
            raise ValueError('Missing required Zotero manifest field: ' + name)
    url = urllib.parse.urlsplit(app['update_url'])
    _ = url.port  # Reject malformed and out-of-range ports before packaging.
    if (url.scheme != 'https' or not url.hostname or url.username is not None
            or url.password is not None or url.query or url.fragment
            or any(c.isspace() for c in app['update_url'])):
        raise ValueError('Zotero update_url must be a stable HTTPS URL without credentials.')
    for name in ('strict_min_version', 'strict_max_version'):
        if not re.fullmatch(r'[A-Za-z0-9.*+-]+', app[name]):
            raise ValueError('Invalid Zotero compatibility value: ' + name)
    if not isinstance(manifest.get('version'), str) or not re.fullmatch(r'\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9][A-Za-z0-9.-]*)?', manifest['version']):
        raise ValueError('Invalid plugin version.')
    return app
