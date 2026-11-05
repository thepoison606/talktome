#!/usr/bin/env python3
"""Build and notarize macOS Server/Bridge locally; optionally upload to a draft."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'thepoison606/talktome'


def run(*args, cwd=ROOT, env=None, capture=False):
    return subprocess.run([str(arg) for arg in args], cwd=cwd, env=env,
                          check=True, text=True,
                          stdout=subprocess.PIPE if capture else None).stdout


def find_node(environment):
    candidates = [shutil.which('node')]
    candidates += sorted((Path.home()/'.pkg-cache/sea').glob('node-v*-darwin-arm64/bin/node'), reverse=True)
    for candidate in candidates:
        if not candidate:
            continue
        result = subprocess.run([str(candidate), str(ROOT/'scripts/verify-build-node.js')],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            environment['PATH'] = str(Path(candidate).parent) + os.pathsep + environment.get('PATH', '')
            return str(candidate)
    raise RuntimeError('Install the Node version from .node-version before building.')


def release_matches(tag, head, tag_commit, version, release):
    if not re.fullmatch(r'v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', tag):
        raise RuntimeError('--upload requires an existing version tag such as v1.5.23')
    if head != tag_commit or not release or tag != 'v' + version:
        raise RuntimeError('Upload requires a clean checkout of exactly the requested release tag.')


def require_draft(tag, env, expected_commit):
    data = json.loads(run('gh', 'release', 'view', tag, '--repo', REPOSITORY,
                          '--json', 'isDraft,url', env=env, capture=True))
    if not data.get('isDraft'):
        raise RuntimeError('Refusing to replace assets of a published release.')
    remote_commit = run('gh', 'api', f'repos/{REPOSITORY}/commits/{tag}',
                        '--jq', '.sha', env=env, capture=True).strip()
    if remote_commit != expected_commit:
        raise RuntimeError('GitHub release tag does not match the locally built commit.')
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Validate local tools/credentials without building or uploading')
    parser.add_argument('--upload', metavar='TAG', help='Upload both verified DMGs to an existing matching draft release')
    parser.add_argument('--identity', default=os.environ.get('APPLE_SIGNING_IDENTITY', ''))
    parser.add_argument('--profile', default='talktome-notary')
    parser.add_argument('--output-dir', type=Path, help='New directory for artifacts; defaults to Library/Application Support/Talktome/builds/macos')
    args = parser.parse_args()
    if platform.system() != 'Darwin' or platform.machine() != 'arm64':
        parser.error('This local release command currently supports Apple Silicon Macs.')
    environment = os.environ.copy()
    # Resolve the checkout's real version, independent of old CI/shell overrides.
    for name in ('TALKTOME_BUILD_VERSION', 'TALKTOME_BUILD_SAFE_VERSION', 'GITHUB_SHA',
                 'APPLE_SIGNING_IDENTITY', 'TALKTOME_SERVER_SIDECAR_SOURCE', 'CARGO_TARGET_DIR'):
        environment.pop(name, None)
    node = find_node(environment)
    for command in ('npm', 'cargo', 'xcrun', 'security', 'codesign', 'hdiutil', 'spctl'):
        if not shutil.which(command, path=environment['PATH']):
            parser.error(f'Required local tool not found: {command}')
    identities = run('security', 'find-identity', '-v', '-p', 'codesigning', capture=True)
    if not args.identity:
        found = re.findall(r'"(Developer ID Application:[^"]+)"', identities)
        if len(found) != 1:
            parser.error('Select a Developer ID Application identity with --identity')
        args.identity = found[0]
    if not args.identity.startswith('Developer ID Application:') or f'"{args.identity}"' not in identities:
        parser.error('Developer ID Application certificate/private key is not available in the local Keychain')
    run('xcrun', 'notarytool', 'history', '--keychain-profile', args.profile,
        '--output-format', 'json', capture=True)
    info = json.loads(run(node, 'scripts/resolve-build-version.js', '--json', env=environment, capture=True))
    head = run('git', 'rev-parse', 'HEAD', capture=True).strip()
    if args.upload:
        tag_commit = run('git', 'rev-parse', '--verify', args.upload+'^{commit}', capture=True).strip()
        release_matches(args.upload, head, tag_commit, info['appVersion'], info['release'])
        require_draft(args.upload, environment, head)
    print(f"Local signing ready: {args.identity}\nVersion: {info['appVersion']} ({head[:8]})", flush=True)
    if args.check:
        print('Tools, local signing identity and Apple notarization credentials verified. No build/upload performed.')
        return
    if info['dirty']:
        parser.error('Commit tracked changes before building so both artifacts have a reproducible source version.')
    environment.update(TALKTOME_BUILD_VERSION=info['appVersion'],
                       TALKTOME_BUILD_SAFE_VERSION=info['safeVersion'], GITHUB_SHA=head)
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output = (args.output_dir or Path.home()/'Library/Application Support/Talktome/builds/macos'/f"{info['safeVersion']}-{stamp}").resolve()
    if output == ROOT or ROOT in output.parents:
        parser.error('Store signed release artifacts outside the source checkout.')
    output.mkdir(parents=True, exist_ok=False)

    # Use a clean archive: ignored local config, credentials and other worktrees
    # cannot become inputs to the packaged server. Keep compiler/media caches local.
    with tempfile.TemporaryDirectory(prefix='talktome-macos-release-') as temp:
        source = Path(temp)/'source'
        source.mkdir()
        archive = Path(temp)/'source.tar'
        with archive.open('wb') as file:
            subprocess.run(['git', 'archive', head], cwd=ROOT, stdout=file, check=True)
        run('tar', '-xf', archive, '-C', source)
        cache = Path.home()/'Library/Caches/Talktome/macos-release'
        cache.mkdir(parents=True, exist_ok=True)
        components = [('server', 'server-app', 'Talktome Server'),
                      ('bridge', 'bridge-client', 'Talktome Bridge')]
        run('npm', 'ci', cwd=source, env=environment)
        run('npm', 'run', 'build:mac_arm64', cwd=source, env=environment)
        run(node, 'scripts/native-startup-smoke-test.mjs', '--mode', 'server',
            '--executable', source/'talktome_arm64', '--expected-version', info['appVersion'],
            '--timeout-seconds', '120', cwd=source, env=environment)

        bridge = source/'bridge-client'
        recipe = bridge/'scripts/build-ffmpeg-lgpl-macos.sh'
        recipe_hash = hashlib.sha256(recipe.read_bytes()).hexdigest()
        ffmpeg = cache/'ffmpeg'/recipe_hash/'ffmpeg-aarch64-apple-darwin'
        if not ffmpeg.is_file():
            media_env = dict(environment, FFMPEG_OUTPUT_DIR=str(ffmpeg.parent),
                             FFMPEG_BUILD_ROOT=str(cache/'ffmpeg-build'))
            run('bash', recipe, '--release', cwd=bridge, env=media_env)

        artifacts = []
        for kind, folder, product in components:
            app_root = source/folder
            env = dict(environment, CARGO_TARGET_DIR=str(cache/f'cargo-{kind}'),
                       FFMPEG_SIDECAR_SOURCE=str(ffmpeg))
            run('npm', 'ci', cwd=app_root, env=env)
            run(node, 'scripts/resolve-build-version.js', '--tauri-config',
                app_root/'tauri.release-version.json', cwd=source, env=env)
            if kind == 'server':
                run('npm', 'run', 'prepare:server', '--', '--force', cwd=app_root, env=env)
            else:
                run('npm', 'run', 'prepare:ffmpeg', '--', '--release', '--force', cwd=app_root, env=env)
                run('npm', 'run', 'prepare:omt', '--', '--release', '--force', cwd=app_root, env=env)
            run('npm', 'exec', '--no', 'tauri', 'build', '--', '--bundles', 'app',
                '--no-sign', '--config', 'tauri.release-version.json', cwd=app_root, env=env)
            app = Path(env['CARGO_TARGET_DIR'])/'release/bundle/macos'/f'{product}.app'
            with (app/'Contents/Info.plist').open('rb') as file:
                if plistlib.load(file)['CFBundleShortVersionString'] != info['appVersion']:
                    raise RuntimeError(f'{product} bundle version does not match the source checkout')
            dmg = output/f"talktome_{kind}_macos_arm64_{info['safeVersion']}.dmg"
            run(sys.executable, source/'scripts/notarize-macos.py', '--app', app,
                '--entitlements', app_root/'src-tauri/Entitlements.plist', '--output-dmg', dmg,
                '--identity', args.identity, '--profile', args.profile, cwd=source, env=env)
            artifacts.append(dmg)
        manifest = dict(version=info['appVersion'], commit=head, identity=args.identity,
                        artifacts=[dict(name=file.name, sha256=hashlib.sha256(file.read_bytes()).hexdigest()) for file in artifacts])
        (output/'validation.json').write_text(json.dumps(manifest, indent=2)+'\n')
    if args.upload:
        # Recheck immediately before mutating the draft; never publish it here.
        require_draft(args.upload, environment, head)
        run('gh', 'release', 'upload', args.upload, *artifacts, '--repo', REPOSITORY,
            '--clobber', env=environment)
    print(f"Signed and notarized Server/Bridge DMGs: {output}")


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error))
