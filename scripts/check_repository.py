"""Reject local-only material and generated artifacts in the Git file list."""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
local_files = {'AGENTS.md', 'LOCAL-HANDOFF.md', 'FEATURES.md', 'VALIDATION.md', 'START-HERE.md'}
blocked_roots = ('.native-tests/', '.local-maintenance/', 'promo/', 'docs/ui/', 'dist/', 'profile/', 'profiles/', 'data/', 'node_modules/')
bad = []
for name in filter(None, names):
    path = pathlib.PurePosixPath(name)
    if (name in local_files or name.startswith(blocked_roots)
            or path.suffix.lower() in {'.xpi', '.zip', '.pdf', '.log', '.key', '.pem', '.bundle'}
            or path.name in {'credentials.enc', 'credentials.json', 'accounts.json', 'settings.local.json'}
            or path.name == '.env' or path.name.startswith('.env.') and path.name != '.env.example'
            or re.fullmatch(r'tests/.*-result\.json', name)
            or name == 'tests/core-test-result.txt'):
        bad.append(name)
if bad:
    print('Local-only or generated files are tracked:')
    for name in bad:
        print('  ' + name)
    sys.exit(1)
print('Repository file check passed.')
