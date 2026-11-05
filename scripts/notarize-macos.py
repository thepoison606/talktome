#!/usr/bin/env python3
"""Sign a copy of a built app, notarize/staple it, then package a notarized DMG.

Uses an existing Developer ID Application identity and notarytool Keychain
profile. Never changes the original bundle or stores credentials in this repo.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile


def run(*args, capture=False):
    return subprocess.run([str(a) for a in args], check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def notarize(archive, profile, report):
    result = run('xcrun', 'notarytool', 'submit', archive, '--keychain-profile',
                 profile, '--wait', '--output-format', 'json', capture=True)
    report.write_text(result)
    status = json.loads(result)
    if status.get('status') != 'Accepted':
        raise RuntimeError(f"Apple notarization was not accepted; see {report}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--entitlements', required=True, type=Path)
    parser.add_argument('--output-dmg', required=True, type=Path)
    parser.add_argument('--identity', default=os.environ.get('APPLE_SIGNING_IDENTITY', ''))
    parser.add_argument('--profile', default='talktome-notary')
    args = parser.parse_args()
    app = args.app.resolve()
    output = args.output_dmg.resolve()
    if not app.is_dir() or app.suffix != '.app':
        parser.error('--app must be an existing .app bundle')
    if not args.identity.startswith('Developer ID Application:'):
        parser.error('Use a Developer ID Application identity, not Apple Development/Distribution')
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True)
    if f'"{args.identity}"' not in identities:
        parser.error('The selected signing identity and private key are not available in Keychain')
    with args.entitlements.open('rb') as file:
        entitlements = plistlib.load(file)
    if entitlements.get('com.apple.security.get-task-allow'):
        parser.error('Distribution entitlements must not enable get-task-allow')
    if output.exists():
        parser.error('Output already exists; choose a new DMG filename')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='talktome-notarize-') as temp:
        root = Path(temp)
        content = root / 'content'
        content.mkdir()
        bundle = content / app.name
        shutil.copytree(app, bundle, symlinks=True)
        sign = ['codesign', '--force', '--sign', args.identity, '--timestamp', '--options', 'runtime']
        # Sign nested Mach-O payloads first, including Node .node modules and
        # native media sidecars which a top-level app signature cannot cover.
        for file in sorted(bundle.rglob('*')):
            if file.is_symlink() or not file.is_file():
                continue
            if 'Mach-O' in run('file', '-b', file, capture=True):
                extra = ['--entitlements', str(args.entitlements)] if file.name.startswith(('talktome-server', 'talktome-bridge', 'ffmpeg')) else []
                run(*sign, *extra, file)
        nested = [path for path in bundle.rglob('*') if path.is_dir()
                  and not path.is_symlink() and path.suffix in ('.framework', '.app', '.xpc')]
        for path in sorted(nested, key=lambda path: len(path.parts), reverse=True):
            run(*sign, path)
        run(*sign, '--entitlements', args.entitlements, bundle)
        run('codesign', '--verify', '--deep', '--strict', bundle)
        archive = root / 'app.zip'
        run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', bundle, archive)
        notarize(archive, args.profile, output.with_suffix('.app-notarization.json'))
        run('xcrun', 'stapler', 'staple', bundle)
        run('xcrun', 'stapler', 'validate', bundle)
        run('spctl', '--assess', '--type', 'execute', '--verbose=2', bundle)
        (content / 'Applications').symlink_to('/Applications')
        run('hdiutil', 'create', '-volname', app.stem, '-srcfolder', content, '-format', 'UDZO', output)
        run('codesign', '--force', '--sign', args.identity, '--timestamp', output)
        notarize(output, args.profile, output.with_suffix('.dmg-notarization.json'))
        run('xcrun', 'stapler', 'staple', output)
        run('xcrun', 'stapler', 'validate', output)
        run('spctl', '--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', output)
    print(f'Signed, notarized and stapled: {output}')


if __name__ == '__main__':
    main()
