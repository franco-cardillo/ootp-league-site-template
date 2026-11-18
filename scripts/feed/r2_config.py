#!/usr/bin/env python3
"""Validate the deliberately restricted R2 configuration without printing values."""
import os
import re
import sys


def config_from_env():
    account = os.environ.get('R2_ACCOUNT_ID', '')
    access = os.environ.get('R2_ACCESS_KEY', '')
    secret = os.environ.get('R2_SECRET_KEY', '')
    bucket = os.environ.get('R2_BUCKET', '')
    key = os.environ.get('R2_KEY') or 'export.zip'
    if not re.fullmatch(r'[0-9a-fA-F]{32}', account):
        raise ValueError('R2_ACCOUNT_ID must be a 32-character hexadecimal account ID')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket):
        raise ValueError('R2_BUCKET must be a valid Cloudflare bucket name')
    # R2 issues ASCII credentials. Colons and control characters are refused,
    # including because curl's --user separates the two values with a colon.
    for name, value in [('R2_ACCESS_KEY', access), ('R2_SECRET_KEY', secret)]:
        if not re.fullmatch(r'[A-Za-z0-9_+/=-]{1,256}', value):
            raise ValueError(name + ' is missing or invalid')
    if (len(key) > 512 or not re.fullmatch(r'[A-Za-z0-9._/-]+', key)
            or any(part in ('', '.', '..') for part in key.split('/'))):
        raise ValueError('R2_KEY must be a relative ASCII object-key prefix without dot segments')
    return account, access, secret, bucket, key


def main():
    try:
        config_from_env()
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
