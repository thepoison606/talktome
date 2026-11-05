#!/usr/bin/env python3
"""Use repository secrets in an ephemeral runner Keychain; replace only verified DMGs."""
import argparse
import base64
import os
from pathlib import Path
import secrets
import shlex
import shutil
import subprocess
import tempfile


def run(*args):
    return subprocess.run([str(a) for a in args], check=True, text=True,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--entitlements', type=Path, required=True)
    parser.add_argument('--output-dmg', type=Path, required=True)
    args = parser.parse_args()
    required = ['MACOS_CERTIFICATE_P12', 'MACOS_CERTIFICATE_PASSWORD',
                'APPLE_SIGNING_IDENTITY', 'APP_STORE_CONNECT_PRIVATE_KEY',
                'APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID']
    for name in required:
        if not os.environ.get(name):
            parser.error(f'Set {name} before enabling macOS release signing')
    previous = shlex.split(run('security', 'list-keychains', '-d', 'user'))
    with tempfile.TemporaryDirectory(prefix='talktome-ci-signing-', dir=os.environ.get('RUNNER_TEMP')) as temp:
        root = Path(temp)
        root.chmod(0o700)
        certificate, api_key, keychain = root/'identity.p12', root/'api.p8', root/'build.keychain-db'
        certificate.write_bytes(base64.b64decode(os.environ['MACOS_CERTIFICATE_P12'], validate=True))
        api_key.write_text(os.environ['APP_STORE_CONNECT_PRIVATE_KEY'])
        certificate.chmod(0o600)
        api_key.chmod(0o600)
        password = secrets.token_urlsafe(32)
        created = False
        signed = root/'signed.dmg'
        try:
            run('security', 'create-keychain', '-p', password, keychain)
            created = True
            run('security', 'set-keychain-settings', '-lut', '21600', keychain)
            run('security', 'unlock-keychain', '-p', password, keychain)
            run('security', 'list-keychains', '-d', 'user', '-s', keychain, *previous)
            run('security', 'import', certificate, '-k', keychain, '-P', os.environ['MACOS_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign')
            run('security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain)
            run('xcrun', 'notarytool', 'store-credentials', 'talktome-ci-notary', '--keychain', keychain,
                '--key', api_key, '--key-id', os.environ['APP_STORE_CONNECT_KEY_ID'], '--issuer', os.environ['APP_STORE_CONNECT_ISSUER_ID'])
            subprocess.run(['python3', str(Path(__file__).with_name('notarize-macos.py')),
                            '--app', str(args.app), '--entitlements', str(args.entitlements),
                            '--output-dmg', str(signed), '--profile', 'talktome-ci-notary',
                            '--keychain', str(keychain)], check=True)
            # The earlier unsigned artifact survives any signing/notarization failure.
            args.output_dmg.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(signed, args.output_dmg)
        finally:
            if created:
                subprocess.run(['security', 'list-keychains', '-d', 'user', '-s', *previous], check=False, stdout=subprocess.DEVNULL)
                subprocess.run(['security', 'delete-keychain', str(keychain)], check=False, stdout=subprocess.DEVNULL)
            # Keep Apple's diagnostic response even if notarization was rejected.
            for suffix in ('.app-notarization.json', '.dmg-notarization.json'):
                report = signed.with_suffix(suffix)
                if report.exists():
                    args.output_dmg.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copyfile(report, args.output_dmg.with_suffix(suffix))


if __name__ == '__main__':
    try:
        main()
    except subprocess.CalledProcessError as error:
        # Do not print argv/environment: security commands contain ephemeral passwords.
        raise SystemExit(f'macOS signing command failed (exit {error.returncode}); see the notarization reports if present.')
