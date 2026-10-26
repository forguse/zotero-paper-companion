"""Prepare a verified Zotero update manifest locally; never publish or change visibility."""
import argparse
import hashlib
import json
import pathlib
import re
import urllib.parse
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
PLUGIN_ID = 'paper-companion@local'
DEFAULT_REPOSITORY = 'forguse/zotero-paper-companion'


def https_url(value):
    """Accept a download URL, never an embedded credential or an executable scheme."""
    parsed = urllib.parse.urlsplit(value)
    try:
        port = parsed.port
    except ValueError as error:
        raise ValueError('Download URL has an invalid port.') from error
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.fragment or parsed.query
            or any(ord(char) <= 32 for char in value) or port not in (None, 443)):
        raise ValueError('Download URL must be HTTPS without credentials, query, fragment or custom port.')
    return value


def release_url(repository, version, tag=None, asset_name='INSTALL-LATEST.xpi'):
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
        raise ValueError('Repository must have the form OWNER/REPO.')
    if tag is not None and tag != 'v' + version:
        raise ValueError('Release tag must match the package version: v' + version)
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.xpi', asset_name):
        raise ValueError('Release asset must be a single .xpi filename.')
    return https_url(f'https://github.com/{repository}/releases/download/v{version}/{asset_name}')


def prepare(root=ROOT, *, package=None, output=None, repository=DEFAULT_REPOSITORY,
            download_url=None, tag=None, asset_name='INSTALL-LATEST.xpi'):
    """Validate source and archive identities before deriving a hash from the exact XPI."""
    root = pathlib.Path(root)
    source = json.loads((root / 'addon/manifest.json').read_text(encoding='utf-8'))
    app = source['applications']['zotero']
    version = source['version']
    if app.get('id') != PLUGIN_ID:
        raise ValueError('Plugin ID must remain ' + PLUGIN_ID)
    if not isinstance(version, str) or not re.fullmatch(r'\d+(?:\.\d+){1,3}(?:[-+][A-Za-z0-9][A-Za-z0-9.-]*)?', version):
        raise ValueError('Invalid plugin version.')
    metadata = json.loads((root / 'package.json').read_text(encoding='utf-8'))
    if metadata.get('version') != version:
        raise ValueError('package.json and addon/manifest.json versions do not match.')
    for name in ('strict_min_version', 'strict_max_version'):
        if not isinstance(app.get(name), str) or not re.fullmatch(r'[A-Za-z0-9.*+-]+', app[name]):
            raise ValueError('Invalid Zotero compatibility value: ' + name)
    # Validate tag and repository even when a custom host is selected.
    default_url = release_url(repository, version, tag, asset_name)
    link = https_url(download_url) if download_url is not None else default_url
    package = pathlib.Path(package) if package is not None else root / f'dist/paper-companion-{version}.xpi'
    if not package.is_file():
        raise ValueError('Build the XPI first with python scripts/build.py.')
    with zipfile.ZipFile(package) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.testzip() is not None:
            raise ValueError('The XPI has duplicate or corrupt entries.')
        packed = json.loads(archive.read('manifest.json'))
        if packed.get('version') != version or packed.get('applications', {}).get('zotero') != app:
            raise ValueError('The XPI manifest does not match the current source manifest. Rebuild first.')
        if not {'bootstrap.js', 'content/panel.xhtml', 'LICENSE'} <= set(names):
            raise ValueError('The XPI is missing required plugin files.')
    digest = hashlib.sha256(package.read_bytes()).hexdigest()
    installer = root / 'INSTALL-LATEST.xpi'
    if installer.is_file() and hashlib.sha256(installer.read_bytes()).hexdigest() != digest:
        raise ValueError('INSTALL-LATEST.xpi differs from the versioned XPI. Rebuild before publishing.')
    update = {'addons': {PLUGIN_ID: {'updates': [{
        'version': version, 'update_link': link, 'update_hash': 'sha256:' + digest,
        'applications': {'zotero': {name: app[name] for name in ('strict_min_version', 'strict_max_version')}}
    }]}}}
    output = pathlib.Path(output) if output is not None else root / 'dist/updates.json'
    # Do not overwrite source files or an installation package through --output.
    if output.suffix.lower() != '.json' or output.resolve() in {
            (root / 'addon/manifest.json').resolve(), (root / 'package.json').resolve()}:
        raise ValueError('Output must be a separate .json file, not a source manifest.')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(update, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repository', default=DEFAULT_REPOSITORY, help='GitHub OWNER/REPO; does not change visibility')
    parser.add_argument('--tag', help='Must be v followed by the exact built version')
    parser.add_argument('--asset-name', default='INSTALL-LATEST.xpi')
    parser.add_argument('--download-url', help='Optional public HTTPS XPI URL; never include a token')
    parser.add_argument('--package', type=pathlib.Path, help='XPI to verify; default is dist/paper-companion-VERSION.xpi')
    parser.add_argument('--output', type=pathlib.Path, help='Default: dist/updates.json')
    args = parser.parse_args(argv)
    try:
        output = prepare(repository=args.repository, tag=args.tag, asset_name=args.asset_name,
                         download_url=args.download_url, package=args.package, output=args.output)
    except (ValueError, KeyError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, 'Update manifest not generated: ' + str(error) + '\n')
    print(output)


if __name__ == '__main__':
    main()
