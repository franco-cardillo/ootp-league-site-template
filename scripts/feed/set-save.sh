#!/bin/bash
# Pin the feeder to an existing OOTP save without overwriting R2 credentials.
set +x
set -uo pipefail
if [ $# -ne 1 ]; then
  echo 'Usage: bash scripts/feed/set-save.sh "/path/to/Your League.lg"' >&2
  exit 2
fi
SAVE="${1%/}"
if [ ! -d "$SAVE" ]; then
  echo "The selected save folder does not exist." >&2
  exit 1
fi
python3 - "$HOME/.ootpverse-feed.conf" "$SAVE" <<'PYCONF' || exit 1
import os, pathlib, re, shlex, sys, tempfile
config, save = pathlib.Path(sys.argv[1]), sys.argv[2]
if config.is_symlink() or (config.exists() and not config.is_file()):
    sys.exit('Configuration must be a regular file, not a symlink.')
old = config.read_text(encoding='utf-8') if config.exists() else ''
lines = [line for line in old.splitlines() if not re.match(r'^\s*(?:export\s+)?OOTP_LG\s*=', line)]
lines.append('OOTP_LG=' + shlex.quote(save))
fd, temporary = tempfile.mkstemp(prefix='.ootpverse-feed-', dir=config.parent)
try:
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    os.replace(temporary, config)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PYCONF
echo 'Save path updated in ~/.ootpverse-feed.conf; existing settings were preserved.'
echo 'Run bash scripts/feed/feed.sh to upload.'
