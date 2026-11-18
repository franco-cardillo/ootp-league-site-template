#!/usr/bin/env python3
"""Read the numbered R2 feed via authenticated S3 GET and safely unpack it.

The final manifest is mandatory: old feeds without it must be uploaded again.
No R2 endpoint, credentials, response body, or private data are printed.
"""
import hashlib
import hmac
import http.client
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from urllib.parse import quote

from r2_config import config_from_env

PART_SIZE = 16_000_000
MAX_PARTS = 1000
MAX_FILES = 100_000
MAX_UNPACKED = 20 * 1024**3
MAX_FILE = 2 * 1024**3
EMPTY_SHA256 = hashlib.sha256(b'').hexdigest()


def _sign(key, value):
    return hmac.new(key, value.encode('utf-8'), hashlib.sha256).digest()


class R2Reader:
    def __init__(self, config):
        account, self.access, self.secret, self.bucket, self.key = config
        self.host = account + '.r2.cloudflarestorage.com'

    def fetch(self, suffix, limit, dest):
        # The supported key alphabet has no URL syntax; quote each path component
        # anyway so the signature and request path use the same canonical form.
        path = '/' + quote(self.bucket, safe='') + '/' + quote(self.key + suffix, safe='/')
        now = datetime.now(timezone.utc)
        day, stamp = now.strftime('%Y%m%d'), now.strftime('%Y%m%dT%H%M%SZ')
        headers = 'host:' + self.host + '\nx-amz-content-sha256:' + EMPTY_SHA256 + '\nx-amz-date:' + stamp + '\n'
        signed_headers = 'host;x-amz-content-sha256;x-amz-date'
        canonical = '\n'.join(('GET', path, '', headers, signed_headers, EMPTY_SHA256))
        scope = day + '/auto/s3/aws4_request'
        string_to_sign = '\n'.join(('AWS4-HMAC-SHA256', stamp, scope,
                                     hashlib.sha256(canonical.encode()).hexdigest()))
        signing_key = _sign(_sign(_sign(_sign(('AWS4' + self.secret).encode(), day), 'auto'), 's3'), 'aws4_request')
        signature = hmac.new(signing_key, string_to_sign.encode(), hashlib.sha256).hexdigest()
        authorization = (f'AWS4-HMAC-SHA256 Credential={self.access}/{scope}, '
                         f'SignedHeaders={signed_headers}, Signature={signature}')
        connection = http.client.HTTPSConnection(self.host, timeout=120)
        try:
            connection.request('GET', path, headers={'Host': self.host, 'x-amz-date': stamp,
                               'x-amz-content-sha256': EMPTY_SHA256, 'Authorization': authorization})
            response = connection.getresponse()
            # No redirects: credentials are never forwarded to another host.
            if response.status != 200:
                raise ValueError('R2 object unavailable')
            received = 0
            while True:
                block = response.read(min(1024 * 1024, limit - received + 1))
                if not block:
                    break
                received += len(block)
                if received > limit:
                    raise ValueError('R2 object exceeds size limit')
                dest.write(block)
            if received == 0:
                raise ValueError('R2 object is empty')
            return received
        finally:
            connection.close()


def _small(fetch, suffix, limit=4096):
    import io
    buf = io.BytesIO()
    fetch(suffix, limit, buf)
    return buf.getvalue()


def _manifest(raw):
    data = json.loads(raw.decode('utf-8'))
    if (not isinstance(data, dict) or set(data) != {'version', 'count', 'sha256', 'league_id'}
            or type(data['version']) is not int or data['version'] != 1
            or type(data['count']) is not int or not 1 <= data['count'] <= MAX_PARTS
            or type(data['league_id']) is not int or not 1 <= data['league_id'] <= 9007199254740991
            or not isinstance(data['sha256'], str) or not re.fullmatch(r'[0-9a-f]{64}', data['sha256'])):
        raise ValueError('invalid manifest')
    return data


def _count(raw):
    if not re.fullmatch(rb'[1-9][0-9]{0,3}\n', raw):
        raise ValueError('invalid count')
    count = int(raw)
    if count > MAX_PARTS:
        raise ValueError('too many parts')
    return count


def _extract(archive, output):
    with zipfile.ZipFile(archive) as zf:
        infos = zf.infolist()
        if len(infos) > MAX_FILES:
            raise ValueError('too many archive entries')
        names = set()
        total = 0
        for info in infos:
            name = info.filename
            parts = name.rstrip('/').split('/')
            mode = (info.external_attr >> 16) & 0xffff
            if (not name or name.startswith('/') or '\\' in name
                    or any(p in ('', '.', '..') for p in parts)
                    or any(ord(c) < 32 for c in name)
                    or len(parts) < 2 or parts[0] != 'drop'
                    or parts[1] not in ('csv', 'logs', 'photos')
                    or stat.S_ISLNK(mode) or info.flag_bits & 1
                    or name in names):
                raise ValueError('unsafe archive entry')
            if len(parts) == 2 and not info.is_dir():
                raise ValueError('invalid archive root')
            names.add(name)
            if info.file_size > MAX_FILE:
                raise ValueError('archive file too large')
            total += info.file_size
            if total > MAX_UNPACKED:
                raise ValueError('archive too large')
            target = output.joinpath(*PurePosixPath(name).parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(target, 'xb') as dst:
                    shutil.copyfileobj(src, dst, length=1024 * 1024)
    if not (output / 'drop' / 'csv').is_dir():
        raise ValueError('CSV directory missing')


def reconstruct(fetch, destination, expected_league=203):
    """A fetch callable enables fully offline protocol tests."""
    destination = Path(destination).absolute()
    if destination.exists() or destination.is_symlink():
        raise ValueError('destination already exists')
    destination.parent.mkdir(parents=True, exist_ok=True)
    manifest_raw = _small(fetch, '.manifest.json')
    metadata = _manifest(manifest_raw)
    if metadata['league_id'] != expected_league:
        raise ValueError('league ID does not match the completed upload')
    count_raw = _small(fetch, '.count', 16)
    count = _count(count_raw)
    if count != metadata['count']:
        raise ValueError('manifest and count disagree')
    with tempfile.TemporaryDirectory(prefix='.ootp-feed-', dir=destination.parent) as temp:
        archive = Path(temp) / 'export.zip'
        with open(archive, 'wb') as target:
            for i in range(1, count + 1):
                fetch(f'.part-{i:03d}', PART_SIZE, target)
        digest = hashlib.sha256()
        with open(archive, 'rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != metadata['sha256']:
            raise ValueError('archive checksum mismatch')
        if (_small(fetch, '.manifest.json') != manifest_raw
                or _small(fetch, '.count', 16) != count_raw):
            raise ValueError('feed changed during download')
        extracted = Path(temp) / 'extracted'
        extracted.mkdir()
        _extract(archive, extracted)
        extracted.rename(destination)


def main():
    if len(sys.argv) != 2:
        print('usage: python3 scripts/feed/fetch_export.py DESTINATION', file=sys.stderr)
        return 2
    try:
        league = os.environ.get('OOTP_LEAGUE_ID') or '203'
        if not re.fullmatch(r'[0-9]+', league) or not 1 <= int(league) <= 9007199254740991:
            raise ValueError('invalid league ID')
        reader = R2Reader(config_from_env())
        reconstruct(reader.fetch, sys.argv[1], int(league))
    except Exception:
        # Exceptions from HTTP, ZIP metadata and filesystem paths can contain
        # sensitive values. Do not forward them to a potentially public log.
        print('Private feed download or validation failed; check configuration and retry a completed upload.', file=sys.stderr)
        return 1
    print('Private feed download and checksum validation completed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
