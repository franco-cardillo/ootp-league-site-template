#!/usr/bin/env python3
"""Offline integration tests: python3 -m unittest discover -s tests -p 'feed*_test.py'."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts' / 'feed'))
import fetch_export  # noqa: E402
from r2_config import config_from_env  # noqa: E402
from stage_export import CSV_FILES  # noqa: E402

TMP = ROOT / '.cache' / 'feed-offline-tests'
TMP.mkdir(parents=True, exist_ok=True)


class Fixture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=TMP)
        self.base = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.home = self.base / 'home'
        self.home.mkdir()
        self.repo = self.base / 'staging'
        self.repo.mkdir()
        self.save = self.base / 'Example League.lg'
        csv = self.save / 'import_export' / 'csv'
        csv.mkdir(parents=True)
        fixtures = {
            'leagues.csv': 'league_id,parent_league_id,season_year\n777,0,2030\n778,777,2030\n203,0,2030\n',
            'teams.csv': 'team_id,league_id,parent_team_id\n10,777,0\n11,778,10\n20,203,0\n',
            'players_roster_status.csv': 'player_id,team_id\n1,11\n2,20\n3,0\n',
            'players.csv': 'player_id,team_id,organization_id,retired\n1,11,10,0\n2,20,20,0\n3,0,0,0\n',
            'players_career_batting_stats.csv': 'player_id,year,league_id,split_id\n3,2030,777,1\n2,2030,203,1\n',
            'players_career_pitching_stats.csv': 'player_id,year,league_id,split_id\n3,2030,777,1\n',
        }
        for name, contents in fixtures.items():
            (csv / name).write_text(contents)
        photos = self.save / 'news' / 'html' / 'images' / 'person_pictures'
        photos.mkdir(parents=True)
        for number in range(1, 4):
            (photos / f'player_{number}.png').write_bytes(b'synthetic-image')
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        curl = self.bin / 'curl'
        curl.write_text('''#!/usr/bin/env python3
import os, pathlib, shutil, sys
from urllib.parse import urlsplit
args = sys.argv[1:]
sys.stdin.read()  # simulated curl auth config; never write it to disk
src = pathlib.Path(args[args.index('-T') + 1])
url = next(arg for arg in args if arg.startswith('https://'))
key = urlsplit(url).path.split('/', 2)[2]
if os.environ.get('MOCK_FAIL_SUFFIX') and key.endswith(os.environ['MOCK_FAIL_SUFFIX']):
    sys.exit(22)
target = pathlib.Path(os.environ['MOCK_R2']) / key
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(src, target)
''')
        curl.chmod(0o755)
        self.objects = self.base / 'objects'
        self.objects.mkdir()
        self.log = self.base / 'feed.log'
        self.env = {**os.environ, 'HOME': str(self.home), 'OOTPVERSE_REPO': str(self.repo),
                    'OOTP_FEED_SAVE': str(self.save), 'OOTP_FEED_LOG': str(self.log),
                    'OOTP_LEAGUE_ID': '777', 'R2_ACCOUNT_ID': '0' * 32,
                    'R2_ACCESS_KEY': 'TESTACCESSKEY', 'R2_SECRET_KEY': 'TESTSECRETKEY',
                    'R2_BUCKET': 'synthetic-bucket', 'R2_KEY': 'safe/export.zip',
                    'MOCK_R2': str(self.objects), 'PATH': str(self.bin) + os.pathsep + os.environ['PATH']}

    def run_feed(self, **changes):
        env = self.env.copy()
        env.update(changes)
        return subprocess.run(['bash', str(ROOT / 'scripts/feed/feed.sh')], env=env,
                              capture_output=True, text=True, timeout=30)

    def fetch(self, suffix, limit, dest):
        path = self.objects / ('safe/export.zip' + suffix)
        payload = path.read_bytes()
        if not payload or len(payload) > limit:
            raise ValueError('bad object size')
        dest.write(payload)
        return len(payload)

    def test_upload_and_reconstruction_match_selected_league(self):
        result = self.run_feed()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(stat.S_IMODE((self.repo / '.cache/export.zip').stat().st_mode), 0o600)
        metadata = json.loads((self.objects / 'safe/export.zip.manifest.json').read_text())
        self.assertEqual(metadata['league_id'], 777)
        self.assertEqual(metadata['count'], 1)
        self.assertEqual((self.objects / 'safe/export.zip.count').read_text(), '1\n')
        output = self.base / 'restored'
        fetch_export.reconstruct(self.fetch, output, 777)
        self.assertTrue((output / 'drop/csv/leagues.csv').is_file())
        self.assertTrue((output / 'drop/photos/player_1.png').is_file())
        self.assertTrue((output / 'drop/photos/player_3.png').is_file())
        self.assertFalse((output / 'drop/photos/player_2.png').exists())
        content = result.stdout + result.stderr + self.log.read_text()
        self.assertNotIn('TESTACCESSKEY', content)
        self.assertNotIn('TESTSECRETKEY', content)
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(self.fetch, self.base / 'wrong-league', 203)

    def test_multiple_numbered_parts_round_trip(self):
        # An allowlisted table with synthetic incompressible content forces a split.
        extra = self.save / 'import_export/csv/messages.csv'
        extra.write_bytes(os.urandom(fetch_export.PART_SIZE + 32_000))
        result = self.run_feed()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        metadata = json.loads((self.objects / 'safe/export.zip.manifest.json').read_text())
        self.assertEqual(metadata['count'], 2)
        self.assertEqual((self.objects / 'safe/export.zip.count').read_text(), '2\n')
        self.assertEqual((self.objects / 'safe/export.zip.part-001').stat().st_size, fetch_export.PART_SIZE)
        fetch_export.reconstruct(self.fetch, self.base / 'multi', 777)
        self.assertEqual((self.base / 'multi/drop/csv/messages.csv').read_bytes(), extra.read_bytes())
        second = self.objects / 'safe/export.zip.part-002'
        second.write_bytes(second.read_bytes() + b'changed')
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(self.fetch, self.base / 'multi-bad', 777)

    def test_dry_run_defaults_to_203_without_credentials(self):
        env = self.env.copy()
        for name in ('OOTP_LEAGUE_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'):
            env.pop(name, None)
        env['OOTP_FEED_DRY_RUN'] = '1'
        proc = subprocess.run(['bash', str(ROOT / 'scripts/feed/feed.sh')], env=env,
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        with zipfile.ZipFile(self.repo / '.cache/export.zip') as zf:
            self.assertIn('drop/photos/player_2.png', zf.namelist())
            self.assertNotIn('drop/photos/player_1.png', zf.namelist())
        self.assertFalse(any(self.objects.iterdir()))

    def test_no_save_does_not_discover_current_directory(self):
        env = self.env.copy()
        env.pop('OOTP_FEED_SAVE')
        env['OOTP_FEED_DRY_RUN'] = '1'
        proc = subprocess.run(['bash', str(ROOT / 'scripts/feed/feed.sh')], env=env,
                              capture_output=True, text=True, timeout=30)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('no OOTP save found', proc.stdout + proc.stderr)

    def test_uploader_rejects_invalid_league_and_endpoint_injection(self):
        for value in ('', '0', '-1', '1;echo injected', '9007199254740992'):
            result = self.run_feed(OOTP_LEAGUE_ID=value)
            self.assertNotEqual(result.returncode, 0, value)
        result = self.run_feed(R2_KEY='export.zip?x=1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.objects.rglob('*')), [])
        self.assertNotIn('TESTSECRETKEY', self.log.read_text())

    def test_count_or_manifest_failure_never_commits(self):
        result = self.run_feed(MOCK_FAIL_SUFFIX='.count')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.objects / 'safe/export.zip.manifest.json').exists())
        with self.assertRaises(FileNotFoundError):
            fetch_export.reconstruct(self.fetch, self.base / 'missing-commit', 777)
        result = self.run_feed(MOCK_FAIL_SUFFIX='.manifest.json')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.objects / 'safe/export.zip.manifest.json').exists())

    def test_interrupted_replacement_does_not_accept_old_manifest(self):
        self.assertEqual(self.run_feed().returncode, 0)
        extra = self.save / 'import_export/csv/messages.csv'
        extra.write_text('synthetic new content')
        self.assertNotEqual(self.run_feed(MOCK_FAIL_SUFFIX='.count').returncode, 0)
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(self.fetch, self.base / 'stale-manifest', 777)
        self.assertFalse((self.base / 'stale-manifest').exists())

    def test_schema_allowlist_is_complete_and_only_known_inputs_are_packed(self):
        schema = (ROOT / 'scripts/import/schema.ts').read_text()
        files_block = schema.split('export const FILES = {', 1)[1].split('} as const', 1)[0]
        schema_files = set(re.findall(r"'([^']+\.csv)'", files_block))
        self.assertEqual(CSV_FILES, schema_files)
        csv_dir = self.save / 'import_export/csv'
        for name in CSV_FILES:
            path = csv_dir / name
            if not path.exists():
                path.write_text('synthetic schema data\n')
        for name in ('secret.csv', '.credentials', 'extra.bin', 'players.csv.bak', 'TEAMS.CSV'):
            (csv_dir / name).write_text('do not upload')
        nested = csv_dir / 'nested'
        nested.mkdir()
        (nested / 'teams.csv').write_text('do not upload')
        logs = self.save / 'news/txt/leagues'
        logs.mkdir(parents=True)
        (logs / 'log_123.txt').write_text('synthetic play by play')
        (logs / 'log_password.txt').write_text('do not upload')
        (logs / 'log_123.txt.bak').write_text('do not upload')
        old_csv = self.repo / 'drop/csv'
        old_logs = self.repo / 'drop/logs'
        old_csv.mkdir(parents=True)
        old_logs.mkdir(parents=True)
        (old_csv / 'private.txt').write_text('old data; do not erase or upload')
        (old_logs / 'log_999.txt').write_text('old data; do not erase or upload')
        cache = self.repo / '.cache'
        cache.mkdir()
        (cache / 'chunks').symlink_to(csv_dir, target_is_directory=True)
        old_work = cache / 'ootpverse-feed-work.OLD12345'
        old_work.mkdir()
        (old_work / 'keep').write_text('not this run')
        result = self.run_feed()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with zipfile.ZipFile(self.repo / '.cache/export.zip') as zf:
            names = set(zf.namelist())
        self.assertEqual({name.removeprefix('drop/csv/') for name in names
                          if name.startswith('drop/csv/') and name != 'drop/csv/'}, CSV_FILES)
        self.assertEqual({name for name in names if name.startswith('drop/logs/')},
                         {'drop/logs/', 'drop/logs/log_123.txt'})
        self.assertEqual((old_csv / 'private.txt').read_text(), 'old data; do not erase or upload')
        self.assertTrue((old_logs / 'log_999.txt').exists())
        self.assertTrue((csv_dir / 'secret.csv').exists())
        self.assertTrue((cache / 'chunks').is_symlink())
        self.assertEqual((old_work / 'keep').read_text(), 'not this run')
        self.assertEqual(list(cache.glob('ootpverse-feed-work.*')), [old_work])

        # A later run never picks up a removed optional input or an old log.
        (csv_dir / 'messages.csv').unlink()
        shutil.rmtree(logs)
        self.assertEqual(self.run_feed(OOTP_FEED_DRY_RUN='1').returncode, 0)
        with zipfile.ZipFile(self.repo / '.cache/export.zip') as zf:
            self.assertNotIn('drop/csv/messages.csv', zf.namelist())
            self.assertFalse(any(name.startswith('drop/logs/') for name in zf.namelist()))

    def test_source_symlinks_fail_closed_without_modifying_save(self):
        csv_dir = self.save / 'import_export/csv'
        outside = self.base / 'secret'
        outside.write_text('private')
        logs = self.save / 'news/txt/leagues'
        logs.mkdir(parents=True)
        photos = self.save / 'news/html/images/person_pictures'
        cases = [(csv_dir / 'unrelated', outside), (csv_dir / 'messages.csv', outside),
                 (logs / 'log_123.txt', outside), (photos / 'player_1.png', outside)]
        for link, target in cases:
            with self.subTest(link=str(link)):
                original = link.read_bytes() if link.exists() else None
                if link.exists():
                    link.unlink()
                link.symlink_to(target)
                log_length = len(self.log.read_text()) if self.log.exists() else 0
                result = self.run_feed()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('symlink', self.log.read_text()[log_length:])
                self.assertTrue(link.is_symlink())
                self.assertEqual(outside.read_text(), 'private')
                link.unlink()
                if original is not None:
                    link.write_bytes(original)
        self.assertEqual(list(self.objects.rglob('*')), [])

    def test_failed_run_preserves_last_completed_archive_and_objects(self):
        self.assertEqual(self.run_feed().returncode, 0)
        archive = self.repo / '.cache/export.zip'
        previous_archive = archive.read_bytes()
        previous_objects = {p.relative_to(self.objects): p.read_bytes()
                            for p in self.objects.rglob('*') if p.is_file()}
        link = self.save / 'import_export/csv/messages.csv'
        link.symlink_to(self.base / 'missing-secret')
        result = self.run_feed()
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(link.is_symlink())
        self.assertEqual(archive.read_bytes(), previous_archive)
        self.assertEqual({p.relative_to(self.objects): p.read_bytes()
                          for p in self.objects.rglob('*') if p.is_file()}, previous_objects)
        self.assertFalse(list((self.repo / '.cache').glob('ootpverse-feed-work.*')))

    def test_source_directory_symlinks_are_rejected(self):
        csv_dir = self.save / 'import_export/csv'
        renamed = self.save / 'import_export/actual-csv'
        csv_dir.rename(renamed)
        csv_dir.symlink_to(renamed, target_is_directory=True)
        result = self.run_feed(OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('symlink', result.stdout + result.stderr)
        self.assertTrue(csv_dir.is_symlink())
        self.assertTrue((renamed / 'leagues.csv').is_file())

    def test_selected_save_symlink_and_save_inside_cache_are_rejected(self):
        link = self.base / 'save-link.lg'
        link.symlink_to(self.save, target_is_directory=True)
        result = self.run_feed(OOTP_FEED_SAVE=str(link))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('symlink', result.stdout + result.stderr)
        cache = self.repo / '.cache'
        cache.mkdir()
        nested_save = cache / 'nested.lg'
        self.save.rename(nested_save)
        result = self.run_feed(OOTP_FEED_SAVE=str(nested_save))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overlap', result.stdout + result.stderr)
        self.assertTrue((nested_save / 'import_export/csv/leagues.csv').is_file())
        self.assertFalse((cache / 'ootpverse-feed.lock').exists())
        self.assertEqual(list(self.objects.rglob('*')), [])

    def test_special_file_with_schema_name_fails_without_hanging(self):
        fifo = self.save / 'import_export/csv/messages.csv'
        os.mkfifo(fifo)
        result = self.run_feed()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('not a regular file', self.log.read_text())
        self.assertTrue(stat.S_ISFIFO(fifo.stat().st_mode))
        self.assertEqual(list(self.objects.rglob('*')), [])

    def test_overlap_and_staging_symlinks_never_delete_user_data(self):
        sentinel = self.save / 'import_export/csv/private.txt'
        sentinel.write_text('keep me')
        result = self.run_feed(OOTPVERSE_REPO=str(self.save), OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.save / '.cache').exists())
        cache = self.repo / '.cache'
        cache.symlink_to(self.save / 'import_export/csv', target_is_directory=True)
        result = self.run_feed(OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(cache.is_symlink())
        self.assertEqual(sentinel.read_text(), 'keep me')
        cache.unlink()
        cache.mkdir()
        archive = cache / 'export.zip'
        archive.symlink_to(sentinel)
        result = self.run_feed(OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(archive.is_symlink())
        self.assertEqual(sentinel.read_text(), 'keep me')
        archive.unlink()
        result = self.run_feed(OOTP_FEED_LOG=str(sentinel), OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_text(), 'keep me')
        linked_log = self.base / 'hardlinked.log'
        os.link(sentinel, linked_log)
        result = self.run_feed(OOTP_FEED_LOG=str(linked_log), OOTP_FEED_DRY_RUN='1')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(sentinel.read_text(), 'keep me')
        self.assertEqual(list(self.objects.rglob('*')), [])

    def test_corrupt_missing_changed_or_old_objects_fail_closed(self):
        self.assertEqual(self.run_feed().returncode, 0)
        part = self.objects / 'safe/export.zip.part-001'
        part.write_bytes(part.read_bytes() + b'bad')
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(self.fetch, self.base / 'bad', 777)
        self.assertFalse((self.base / 'bad').exists())
        self.assertEqual(self.run_feed().returncode, 0)
        count = self.objects / 'safe/export.zip.count'
        count.write_text('2\n')
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(self.fetch, self.base / 'wrong-count', 777)
        self.assertEqual(self.run_feed().returncode, 0)
        part.unlink()
        with self.assertRaises(FileNotFoundError):
            fetch_export.reconstruct(self.fetch, self.base / 'missing-part', 777)
        self.assertEqual(self.run_feed().returncode, 0)
        calls = [0]
        def changed(suffix, limit, dest):
            calls[0] += 1
            if suffix == '.manifest.json' and calls[0] > 1:
                dest.write(b'changed')
                return 7
            return self.fetch(suffix, limit, dest)
        with self.assertRaises(ValueError):
            fetch_export.reconstruct(changed, self.base / 'changed', 777)

    def test_rejects_bad_zip_paths_and_symlinks(self):
        for name, symlink in [('drop/csv/../../escape', False), ('drop/photos/link', True)]:
            archive = io.BytesIO()
            with zipfile.ZipFile(archive, 'w') as zf:
                zf.writestr('drop/csv/', '')
                info = zipfile.ZipInfo(name)
                if symlink:
                    info.create_system = 3
                    info.external_attr = (stat.S_IFLNK | 0o777) << 16
                zf.writestr(info, 'evil')
            payload = archive.getvalue()
            objects = {'.part-001': payload, '.count': b'1\n', '.manifest.json': json.dumps({
                'version': 1, 'count': 1, 'league_id': 777, 'sha256': hashlib.sha256(payload).hexdigest()
            }).encode()}
            def reader(suffix, limit, dest):
                data = objects[suffix]
                self.assertLessEqual(len(data), limit)
                dest.write(data)
            with self.assertRaises(ValueError):
                fetch_export.reconstruct(reader, self.base / ('evil-link' if symlink else 'evil-path'), 777)
        self.assertFalse((self.base / 'escape').exists())

    def test_config_rejects_invalid_values_without_echoing_secrets(self):
        with mock.patch.dict(os.environ, self.env, clear=True):
            self.assertEqual(config_from_env()[-1], 'safe/export.zip')
            for key, value in [('R2_ACCOUNT_ID', 'malicious.example'), ('R2_BUCKET', '-bad'),
                               ('R2_KEY', '../bad'), ('R2_SECRET_KEY', 'secret\nvalue')]:
                with mock.patch.dict(os.environ, {key: value}):
                    with self.assertRaises(ValueError) as error:
                        config_from_env()
                    self.assertNotIn(value, str(error.exception))

    def test_save_helper_preserves_existing_credentials(self):
        conf = self.home / '.ootpverse-feed.conf'
        conf.write_text("R2_SECRET_KEY='TESTSECRETKEY'\nOOTP_LG='old path'\n")
        proc = subprocess.run(['bash', str(ROOT / 'scripts/feed/set-save.sh'), str(self.save)],
                              env=self.env, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("R2_SECRET_KEY='TESTSECRETKEY'", conf.read_text())
        self.assertEqual(stat.S_IMODE(conf.stat().st_mode), 0o600)
        self.assertNotIn('TESTSECRETKEY', proc.stdout + proc.stderr)

    @unittest.skipUnless(importlib.util.find_spec('botocore'), 'botocore not installed')
    def test_r2_signature_matches_botocore(self):
        # Compare an actual generated request with the independent AWS reference signer.
        from botocore.auth import S3SigV4Auth
        from botocore.awsrequest import AWSRequest
        from botocore.credentials import Credentials
        seen = {}
        class Response:
            status = 200
            def __init__(self): self.blocks = [b'payload', b'']
            def read(self, size): return self.blocks.pop(0)
        class Connection:
            def __init__(self, host, timeout): seen['host'] = host
            def request(self, method, path, headers): seen.update(method=method, path=path, headers=headers)
            def getresponse(self): return Response()
            def close(self): pass
        with mock.patch('fetch_export.http.client.HTTPSConnection', Connection):
            fetch_export.R2Reader(('0' * 32, 'TESTACCESSKEY', 'TESTSECRETKEY', 'synthetic-bucket', 'safe/export.zip')).fetch('.part-001', 100, io.BytesIO())
        req = AWSRequest(method='GET', url='https://' + seen['host'] + seen['path'], headers={
            'host': seen['host'], 'x-amz-date': seen['headers']['x-amz-date'],
            'x-amz-content-sha256': seen['headers']['x-amz-content-sha256']})
        with mock.patch('botocore.auth.get_current_datetime') as clock:
            from datetime import datetime, timezone
            clock.return_value = datetime.strptime(seen['headers']['x-amz-date'], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
            S3SigV4Auth(Credentials('TESTACCESSKEY', 'TESTSECRETKEY'), 's3', 'auto').add_auth(req)
        self.assertEqual(seen['headers']['Authorization'], req.headers['Authorization'])


if __name__ == '__main__':
    unittest.main()
