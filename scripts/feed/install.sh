#!/bin/bash
# Optional macOS setup: run one upload, then schedule subsequent uploads.
set +x
set -uo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)" || exit 1
export OOTPVERSE_REPO="$REPO"
for tool in python3 curl launchctl; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required tool not found: $tool" >&2
    exit 1
  fi
done
if [ "$(uname -s)" != Darwin ]; then
  echo "The launch agent installer is for macOS only." >&2
  exit 1
fi
if [ "${OOTP_FEED_DRY_RUN:-0}" = 1 ]; then
  echo "Unset OOTP_FEED_DRY_RUN before installing an upload schedule." >&2
  exit 1
fi

echo "Running the first feed; the save is read-only."
if ! bash "$REPO/scripts/feed/feed.sh"; then
  echo "Feed failed. Check the local feed log and configuration; no schedule was installed." >&2
  exit 1
fi

PLIST="$HOME/Library/LaunchAgents/com.ootpverse.feed.plist"
mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs" || exit 1
# plistlib escapes paths, including spaces and XML metacharacters. No shell -c.
python3 - "$PLIST" "$REPO" "$HOME" <<'PYPLIST' || exit 1
import os, plistlib, sys
plist, repo, home = sys.argv[1:]
config = {
    'Label': 'com.ootpverse.feed',
    'ProgramArguments': ['/bin/bash', os.path.join(repo, 'scripts/feed/feed.sh')],
    'EnvironmentVariables': {'HOME': home, 'OOTPVERSE_REPO': repo, 'PATH': os.environ['PATH']},
    'StartInterval': 900,
    'RunAtLoad': False,
    'StandardErrorPath': os.path.join(home, 'Library/Logs/ootpverse-feed.err'),
}
with open(plist, 'wb') as f:
    plistlib.dump(config, f)
PYPLIST
launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || :
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST" >/dev/null 2>&1; then
  echo "Could not load the launch agent. The plist was created but is not scheduled." >&2
  exit 1
fi
echo "Upload scheduled every 15 minutes while the Mac is running."
echo "An upload does not rebuild the site; manually run the GitHub Actions deployment."
echo "Published Pages contents are public."
