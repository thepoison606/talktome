import base64
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SigningTests(unittest.TestCase):
    def test_rejected_notarization_preserves_diagnostics_and_stops_packaging(self):
        module = load('notarize-macos')
        with tempfile.TemporaryDirectory() as temp:
            report = Path(temp)/'report.json'
            with patch.object(module, 'run', return_value='{"status":"Invalid","id":"test-submission"}'):
                with self.assertRaises(RuntimeError):
                    module.notarize(Path('app.zip'), 'test-profile', report)
            self.assertEqual(json.loads(report.read_text())['status'], 'Invalid')

    def ci(self, success, rejection=False):
        module = load('ci-notarize-macos')
        calls = []
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            output = root/'original.dmg'
            output.write_bytes(b'previous artifact')
            environment = dict(RUNNER_TEMP=temp, MACOS_CERTIFICATE_P12=base64.b64encode(b'test-only').decode(),
                MACOS_CERTIFICATE_PASSWORD='test-password', APPLE_SIGNING_IDENTITY='Developer ID Application: Test',
                APP_STORE_CONNECT_PRIVATE_KEY='test-only', APP_STORE_CONNECT_KEY_ID='TEST', APP_STORE_CONNECT_ISSUER_ID='TEST')

            def run(*args):
                calls.append(tuple(str(a) for a in args))
                if args[:3] == ('security', 'list-keychains', '-d') and len(args) == 4:
                    return '"/test/keychain with spaces"\n'
                if 'store-credentials' in args and not success and not rejection:
                    raise subprocess.CalledProcessError(1, ['private-command'])
                return ''

            def execute(args, **kwargs):
                if args[0] == 'python3':
                    target = Path(args[args.index('--output-dmg')+1])
                    if rejection:
                        target.with_suffix('.app-notarization.json').write_text('{"status":"Invalid"}')
                        raise subprocess.CalledProcessError(1, args)
                    target.write_bytes(b'verified signed artifact')
                    for suffix in ('.app-notarization.json', '.dmg-notarization.json'):
                        target.with_suffix(suffix).write_text('{"status":"Accepted"}')
                else:
                    calls.append(tuple(args))
                return subprocess.CompletedProcess(args, 0)

            argv = ['ci-notarize-macos.py', '--app', str(root/'app.app'), '--entitlements', str(root/'entitlements.plist'), '--output-dmg', str(output)]
            with patch.dict(os.environ, environment), patch('sys.argv', argv), patch.object(module, 'run', side_effect=run), patch.object(module.subprocess, 'run', side_effect=execute):
                if success:
                    module.main()
                else:
                    with self.assertRaises(subprocess.CalledProcessError):
                        module.main()
            self.assertEqual(output.read_bytes(), b'verified signed artifact' if success else b'previous artifact')
            if rejection:
                self.assertEqual(json.loads(output.with_suffix('.app-notarization.json').read_text())['status'], 'Invalid')
            self.assertTrue(any(call[:5] == ('security', 'list-keychains', '-d', 'user', '-s') and call[-1] == '/test/keychain with spaces' for call in calls))
            self.assertTrue(any(call[:2] == ('security', 'delete-keychain') for call in calls))
            self.assertEqual(list(root.glob('talktome-ci-signing-*')), [])

    def test_ci_failure_keeps_original_dmg_and_removes_credentials(self):
        self.ci(False)

    def test_ci_success_replaces_only_verified_dmg_and_removes_credentials(self):
        self.ci(True)

    def test_ci_rejection_preserves_report_and_original_dmg(self):
        self.ci(False, rejection=True)


class LocalReleaseTests(unittest.TestCase):
    def test_upload_refuses_mislabeled_or_dirty_builds(self):
        module = load('release-macos-local')
        module.release_matches('v1.5.23', 'abc', 'abc', '1.5.23', True)
        for tag, head, tag_commit, version, release in [
            ('v1.5.23', 'abc', 'def', '1.5.23', True),
            ('v1.5.23', 'abc', 'abc', '1.5.23-dev.1', False),
            ('v1.5.23', 'abc', 'abc', '1.5.24', True),
            ('main', 'abc', 'abc', '1.5.23', True),
        ]:
            with self.subTest(tag=tag, version=version, commit=tag_commit):
                with self.assertRaises(RuntimeError):
                    module.release_matches(tag, head, tag_commit, version, release)

    def test_upload_refuses_published_release(self):
        module = load('release-macos-local')
        with patch.object(module, 'run', return_value='{"isDraft":false}') as run:
            with self.assertRaisesRegex(RuntimeError, 'published'):
                module.require_draft('v1.5.23', {}, 'abc')
        self.assertEqual(run.call_count, 1)

    def test_upload_requires_matching_github_tag(self):
        module = load('release-macos-local')
        with patch.object(module, 'run', side_effect=['{"isDraft":true}', 'different-commit']):
            with self.assertRaisesRegex(RuntimeError, 'GitHub release tag'):
                module.require_draft('v1.5.23', {}, 'abc')
        with patch.object(module, 'run', side_effect=['{"isDraft":true}', 'abc\n']):
            self.assertTrue(module.require_draft('v1.5.23', {}, 'abc')['isDraft'])


if __name__ == '__main__':
    unittest.main()
