#!/bin/bash
# Never trace the config or upload commands, even if this script was invoked with bash -x.
set +x
set -uo pipefail

# Read an OOTP save directly and upload an export for CI. The save is read-only.
# By default, the newest *.lg under the usual Mac locations is selected.
# Override with OOTP_LG=/path/to/YourLeague.lg. CSVs come from
# import_export/csv, logs from news/txt/leagues, and player portraits from
# news/html/images/person_pictures, all under that same save.
# OOTP_FEED_DRY_RUN=1 builds the archive without credentials or any upload.

export GIT_TERMINAL_PROMPT=0

# Capture the caller's dry-run request before loading any local configuration.
readonly FEED_REQUESTED_DRY_RUN="${OOTP_FEED_DRY_RUN:-0}"
readonly FEED_REQUESTED_SAVE="${OOTP_FEED_SAVE:-}"
readonly FEED_REQUESTED_PHOTOS="${OOTP_FEED_REQUIRE_PHOTOS:-0}"
readonly FEED_REQUESTED_LEAGUE="${OOTP_LEAGUE_ID-}"
readonly FEED_REQUESTED_LEAGUE_SET="${OOTP_LEAGUE_ID+x}"
readonly FEED_REQUESTED_REPO="${OOTPVERSE_REPO-}"
# Optional: pin one save and provide upload credentials. Do not trace this file.
[ -f "$HOME/.ootpverse-feed.conf" ] && . "$HOME/.ootpverse-feed.conf"
set +x
# New local archives, logs, and temporary inputs are private by default.
umask 077

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)" || exit 1
REPO="${FEED_REQUESTED_REPO:-${OOTPVERSE_REPO:-$(cd "$SCRIPT_DIR/../.." && pwd)}}"
if [ "$FEED_REQUESTED_LEAGUE_SET" = x ]; then
  LEAGUE_ID="$FEED_REQUESTED_LEAGUE"
elif [ "${OOTP_LEAGUE_ID+x}" = x ]; then
  LEAGUE_ID="$OOTP_LEAGUE_ID"
else
  LEAGUE_ID=203
fi
# The importer uses JavaScript numbers; reject invalid or unsafe identifiers.
if ! python3 - "$LEAGUE_ID" <<'PYLEAGUE'
import re, sys
value = sys.argv[1]
if not re.fullmatch(r"[0-9]+", value) or not 1 <= int(value) <= 9007199254740991:
    sys.exit(1)
PYLEAGUE
then
  echo "OOTP_LEAGUE_ID must be a positive safe integer"
  exit 1
fi
LOG="${OOTP_FEED_LOG:-$HOME/Library/Logs/ootpverse-feed.log}"

find_save() {
  python3 - <<'PYFIND'
import os
home = os.path.expanduser('~')
roots = ('Library/Containers', 'Library/Application Support', 'Documents')
found = []
for root in roots:
    root = os.path.join(home, root)
    for current, dirs, _ in os.walk(root, followlinks=False):
        depth = os.path.relpath(current, root).count(os.sep) + (current != root)
        if depth >= 9:
            dirs[:] = []
        for name in list(dirs):
            if name.endswith('.lg'):
                path = os.path.join(current, name)
                try:
                    found.append((os.path.getmtime(path), path))
                except OSError:
                    pass
                dirs.remove(name)
if found:
    print(max(found)[1])
PYFIND
}

LG="${FEED_REQUESTED_SAVE:-${OOTP_LG:-$(find_save)}}"
if [ -z "$LG" ] || [ ! -d "$LG" ]; then
  echo "no OOTP save found — set OOTP_LG=/path/to/League.lg"
  exit 1
fi

# Refuse save/staging overlap and links in the actual source and cache paths.
# The save is read-only; only a fresh private work directory is ever cleared.
python3 - "$LG" "$REPO" "$LOG" <<'PYPATHS' || exit 1
import os, stat, sys
save_arg, repo_arg, log_arg = map(os.path.abspath, sys.argv[1:])
if os.path.islink(save_arg):
    sys.exit('selected save must not be a symlink')
save, repo, log = map(os.path.realpath, (save_arg, repo_arg, log_arg))
for relative in ('import_export/csv', 'news/html/images/person_pictures', 'news/txt/leagues'):
    source = save
    for part in relative.split('/'):
        source = os.path.join(source, part)
        if os.path.islink(source):
            sys.exit('symlink in feed source path: ' + source)
cache_arg = os.path.join(repo_arg, '.cache')
if os.path.islink(cache_arg):
    sys.exit('feed cache must not be a symlink')
cache = os.path.realpath(cache_arg)
if os.path.commonpath((save, cache)) in (save, cache):
    sys.exit('save and feed cache must not overlap: ' + cache)
if os.path.commonpath((repo, cache)) != repo:
    sys.exit('feed cache must stay inside the repository: ' + cache)
archive = os.path.join(cache_arg, 'export.zip')
if os.path.lexists(archive):
    if os.path.islink(archive) or not stat.S_ISREG(os.stat(archive).st_mode):
        sys.exit('feed archive must be a regular file, not a symlink or directory')
if os.path.islink(log_arg):
    sys.exit('feed log must not be a symlink')
if os.path.commonpath((save, log)) == save:
    sys.exit('feed log must not be inside the OOTP save')
if log == os.path.realpath(archive):
    sys.exit('feed log must not be the feed archive')
if os.path.exists(log_arg):
    log_stat = os.stat(log_arg)
    if not stat.S_ISREG(log_stat.st_mode) or log_stat.st_nlink > 1:
        sys.exit('feed log must be a regular file without multiple hard links')
PYPATHS

mkdir -p "$(dirname "$LOG")" || exit 1
exec >>"$LOG" 2>&1
echo "=== $(date '+%Y-%m-%d %H:%M:%S') feed start ==="
echo "save: $LG"

CSV="$LG/import_export/csv"
LOGS="$LG/news/txt/leagues"
PHOTOS="$LG/news/html/images/person_pictures"

if [ ! -d "$CSV" ]; then
  echo "no CSV export at $CSV — run OOTP's database export once"
  exit 1
fi

# Protect staging and uploads from overlapping runs of this feeder. If a run is
# forcibly killed, remove the lock only after verifying no feeder is running.
mkdir -p "$REPO/.cache" || exit 1
LOCK="$REPO/.cache/ootpverse-feed.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "another feed may be running (lock: $LOCK)"
  exit 1
fi
WORK="$(mktemp -d "$REPO/.cache/ootpverse-feed-work.XXXXXXXX")" || { rmdir "$LOCK"; exit 1; }
WORK_ID="$(python3 -c 'import os,sys; s=os.stat(sys.argv[1], follow_symlinks=False); print(str(s.st_dev) + ":" + str(s.st_ino))' "$WORK")" || { rmdir "$LOCK"; exit 1; }
ZIP_TMP="$WORK/export.zip.tmp"
cleanup() {
  # Only remove the fresh directory created by this run, after rechecking its
  # parent and separation from the save. Never clear drop/ or shared caches.
  python3 - "$WORK" "$REPO" "$LG" "$WORK_ID" <<'PYCLEAN' || echo "unsafe work directory; left in place: $WORK"
import os, re, shutil, sys
work_arg, repo, save_arg, work_id = sys.argv[1:]
cache_arg = os.path.join(repo, '.cache')
work, cache, save = map(os.path.realpath, (work_arg, cache_arg, save_arg))
if (os.path.islink(cache_arg) or os.path.islink(work_arg)
        or os.path.dirname(work) != cache
        or not re.fullmatch(r'ootpverse-feed-work\.[A-Za-z0-9]{8}', os.path.basename(work))
        or os.path.commonpath((save, work)) in (save, work)):
    sys.exit(1)
if os.path.isdir(work):
    s = os.stat(work, follow_symlinks=False)
    if str(s.st_dev) + ':' + str(s.st_ino) != work_id:
        sys.exit(1)
    shutil.rmtree(work)
PYCLEAN
  rmdir "$LOCK" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

python3 "$SCRIPT_DIR/stage_export.py" "$CSV" "$LOGS" "$WORK" || \
  { echo "input staging failed; no upload"; exit 1; }
HAVE_LOGS=0
[ -d "$WORK/drop/logs" ] && HAVE_LOGS=1

ZIP="$REPO/.cache/export.zip"
echo "packing export..."
# zipfile streams file contents; PNGs are already compressed, so store them as
# is. Never read an old drop/photos. Use staged CSVs from this run; broken or
# missing selection metadata aborts instead of silently dropping faces. The
# portrait cap leaves headroom for other Pages files, but does not guarantee
# the completed Pages build is below its total file limit.
if ! python3 - "$ZIP_TMP" "$WORK" "$PHOTOS" "$HAVE_LOGS" "$FEED_REQUESTED_PHOTOS" "$LEAGUE_ID" <<'PYZIP'
import csv, os, re, shutil, stat, sys, zipfile
archive, repo, photos, have_logs, require_photos, league_id = sys.argv[1:]
csv_dir = os.path.join(repo, 'drop', 'csv')
MLB = int(league_id)
MAX_PORTRAITS = 15000

def rows(filename, columns):
    """Read selection fields, rejecting missing columns and malformed rows."""
    with open(os.path.join(csv_dir, filename), encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f, strict=True)
        header = next(reader, None)
        if not header or len(set(header)) != len(header):
            raise ValueError(filename + ': missing or duplicate CSV header')
        missing = set(columns) - set(header)
        if missing:
            raise ValueError(filename + ': missing required columns: ' + ', '.join(sorted(missing)))
        indexes = [header.index(column) for column in columns]
        for row in reader:
            if len(row) != len(header):
                raise ValueError(filename + ': malformed row at line ' + str(reader.line_num))
            yield [row[index] for index in indexes]

def number(value, label, minimum=0):
    if not re.fullmatch(r'[0-9]+', value or ''):
        raise ValueError(label + ': missing or invalid integer: ' + repr(value))
    result = int(value)
    if result < minimum:
        raise ValueError(label + ': invalid integer: ' + repr(value))
    return result

# Parent chains distinguish actual MLB organizations from other level-1 leagues.
# League ancestry also exposes missing team parents in an MLB minor league.
leagues = {}
for league, parent, year in rows('leagues.csv', ('league_id', 'parent_league_id', 'season_year')):
    league = number(league, 'league_id', 1)
    if league in leagues:
        raise ValueError('duplicate league_id: ' + str(league))
    leagues[league] = (number(parent, 'parent_league_id'), year)
if MLB not in leagues:
    raise ValueError('leagues.csv: configured league is missing')
season = number(leagues[MLB][1], 'MLB season_year', 1)
if season < 1000 or season > 9999:
    raise ValueError('MLB season_year must be a four-digit year')

teams = {}
for team, league, parent in rows('teams.csv', ('team_id', 'league_id', 'parent_team_id')):
    team = number(team, 'team_id', 1)
    if team in teams:
        raise ValueError('duplicate team_id: ' + str(team))
    teams[team] = (number(league, 'team league_id', 1), number(parent, 'parent_team_id'))
if not teams or not any(league == MLB for league, parent in teams.values()):
    raise ValueError('teams.csv: no MLB teams found')

league_cache = {}
def mlb_league_ancestry(league):
    seen = set()
    while league and league != MLB and league not in league_cache:
        if league in seen:
            raise ValueError('cycle in league parent chain: ' + str(league))
        seen.add(league)
        if league not in leagues:
            raise ValueError('missing league in parent chain: ' + str(league))
        league = leagues[league][0]
    result = league == MLB or league_cache.get(league, False)
    for item in seen:
        league_cache[item] = result
    return result

team_cache = {0: False}
def mlb_team(team):
    if team in team_cache:  # OOTP uses team 0 for unassigned/free-agent players.
        return team_cache[team]
    original = team
    visited = set()
    in_mlb_minor_league = False
    while team:
        if team in visited:
            raise ValueError('cycle in team parent chain: ' + str(team))
        visited.add(team)
        if team not in teams:
            raise ValueError('missing team in affiliation chain: ' + str(team))
        league, parent = teams[team]
        if league == MLB:
            team_cache[original] = True
            return True
        in_mlb_minor_league |= mlb_league_ancestry(league)
        team = parent
    if in_mlb_minor_league:
        raise ValueError('MLB minor-league team has no MLB parent: ' + str(original))
    team_cache[original] = False
    return False

roster_ids = set()
roster_rows = 0
for player, team in rows('players_roster_status.csv', ('player_id', 'team_id')):
    roster_rows += 1
    player = number(player, 'roster player_id', 1)
    team = number(team, 'roster team_id')
    if mlb_team(team):
        roster_ids.add(player)
if not roster_rows:
    raise ValueError('players_roster_status.csv: no roster rows')

# The app uses bio team IDs for prospects. Include active bio team or org
# affiliations too, even when roster and bio snapshots disagree or a player
# is temporarily unassigned in roster status.
bio_ids = set()
bio_rows = 0
for player, team, organization, retired in rows('players.csv', ('player_id', 'team_id', 'organization_id', 'retired')):
    bio_rows += 1
    player = number(player, 'bio player_id', 1)
    team = number(team, 'bio team_id')
    organization = number(organization, 'bio organization_id')
    if retired not in ('0', '1'):
        raise ValueError('bio retired: invalid value: ' + repr(retired))
    if retired == '0':
        team_affiliated = mlb_team(team)
        org_affiliated = mlb_team(organization)
        if team_affiliated or org_affiliated:
            bio_ids.add(player)
if not bio_rows:
    raise ValueError('players.csv: no player rows')

stat_ids = set()
stat_counts = []
for filename in ('players_career_batting_stats.csv', 'players_career_pitching_stats.csv'):
    matched, line_count = set(), 0
    for player, year, league, split in rows(filename, ('player_id', 'year', 'league_id', 'split_id')):
        line_count += 1
        player = number(player, filename + ' player_id', 1)
        year = number(year, filename + ' year', 1)
        league = number(league, filename + ' league_id')
        split = number(split, filename + ' split_id')
        if year == season and league == MLB and split == 1:
            matched.add(player)
    if not line_count:
        raise ValueError(filename + ': no statistic rows')
    stat_counts.append(len(matched))
    stat_ids.update(matched)
eligible = roster_ids | bio_ids | stat_ids
print('portrait selection: season={}, affiliated roster IDs={}, active affiliated bio IDs={}, '
      'batting IDs={}, pitching IDs={}, MLB stat IDs={}, total eligible IDs={}'.format(
          season, len(roster_ids), len(bio_ids), *stat_counts, len(stat_ids), len(eligible)), flush=True)

def raise_walk_error(error):
    raise error

def add_tree(zf, relative):
    root_dir = os.path.join(repo, *relative.split('/'))
    zf.writestr(relative + '/', b'')
    for root, dirs, files in os.walk(root_dir, onerror=raise_walk_error):
        dirs.sort()
        files.sort()
        for name in dirs + files:
            if os.path.islink(os.path.join(root, name)):
                raise ValueError('symlink in staged export: ' + os.path.join(root, name))
        for name in files:
            if name == '.DS_Store':
                continue
            path = os.path.join(root, name)
            arcname = os.path.relpath(path, repo).replace(os.sep, '/')
            zf.write(path, arcname, compress_type=zipfile.ZIP_DEFLATED)

count = 0
with zipfile.ZipFile(archive, 'w', allowZip64=True) as zf:
    add_tree(zf, 'drop/csv')
    if have_logs == '1':
        add_tree(zf, 'drop/logs')
    try:
        entries = os.scandir(photos)
    except FileNotFoundError:
        print('no player pictures at ' + photos + ' — continuing without portraits')
    else:
        with entries:
            for entry in entries:
                if entry.is_symlink():
                    raise ValueError('symlink in portrait source: ' + entry.path)
                match = re.fullmatch(r'player_([0-9]+)\.png', entry.name)
                if match and int(match.group(1)) in eligible:
                    if count >= MAX_PORTRAITS:
                        raise ValueError('portrait count exceeds {}: refusing upload to preserve Pages file-count headroom'.format(MAX_PORTRAITS))
                    fd = os.open(entry.path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    try:
                        if not stat.S_ISREG(os.fstat(fd).st_mode):
                            raise ValueError('portrait is not a regular file: ' + entry.path)
                        with os.fdopen(fd, 'rb') as src:
                            fd = -1
                            with zf.open('drop/photos/' + entry.name, 'w', force_zip64=True) as dest:
                                shutil.copyfileobj(src, dest, length=1024 * 1024)
                    finally:
                        if fd != -1:
                            os.close(fd)
                    count += 1
                    if count % 5000 == 0:
                        print('portraits packed:', count, flush=True)
        print('photos:', count)
    if require_photos == '1' and count == 0:
        raise ValueError('no matching current-save portraits were packed; no upload')
PYZIP
then
  echo "export packing failed; no upload"
  exit 1
fi
python3 - "$ZIP_TMP" "$ZIP" <<'PYFINAL' || { echo "could not finalize $ZIP; no upload"; exit 1; }
import os, stat, sys
src, dst = sys.argv[1:]
if os.path.islink(os.path.dirname(dst)) or os.path.islink(dst):
    sys.exit('symlink in feed archive path')
if os.path.lexists(dst) and not stat.S_ISREG(os.stat(dst).st_mode):
    sys.exit('feed archive destination is not a regular file')
os.replace(src, dst)
PYFINAL
echo "zip: $(du -h "$ZIP" | cut -f1)"

if [ "$FEED_REQUESTED_DRY_RUN" = 1 ]; then
  echo "dry run: archive built; no upload"
  exit 0
fi

if [ -z "${R2_ACCESS_KEY:-}" ] || [ -z "${R2_SECRET_KEY:-}" ] || \
   [ -z "${R2_ACCOUNT_ID:-}" ] || [ -z "${R2_BUCKET:-}" ]; then
  echo "upload credentials or bucket are missing; no upload"
  exit 1
fi
R2_KEY="${R2_KEY:-export.zip}"
export R2_ACCOUNT_ID R2_ACCESS_KEY R2_SECRET_KEY R2_BUCKET R2_KEY
python3 "$SCRIPT_DIR/r2_config.py" || { echo "invalid R2 configuration; no upload"; exit 1; }

# Supply curl's auth configuration over stdin rather than putting credentials
# in its process arguments. Never echo the auth value or enable shell tracing.
upload_part() {
  local file="$1" content_type="$2" key="$3"
  local auth="$R2_ACCESS_KEY:$R2_SECRET_KEY"
  case "$auth" in
    *$'\n'*|*$'\r'*) echo "invalid upload credentials"; return 1 ;;
  esac
  auth=${auth//\\/\\\\}
  auth=${auth//\"/\\\"}
  printf 'user = "%s"\n' "$auth" | \
    curl -sS --fail --http1.1 --retry 8 --retry-delay 2 --retry-all-errors --aws-sigv4 "aws:amz:auto:s3" \
      --config - -X PUT -T "$file" -H "Content-Type: $content_type" -H "Expect:" \
      "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com/$R2_BUCKET/$key" -o /dev/null 2>/dev/null
}

# The receiver concatenates numbered parts, so larger chunks avoid hundreds of
# requests for portrait-heavy saves. Keep only one part on disk at a time.
CHUNKS="$WORK/chunks"
mkdir "$CHUNKS" || exit 1
BYTES=$(python3 -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$ZIP") || exit 1
PART_SIZE=16000000
total=$(( (BYTES + PART_SIZE - 1) / PART_SIZE ))
if [ "$total" -lt 1 ] || [ "$total" -gt 1000 ]; then
  echo "export exceeds supported part count; no upload"
  exit 1
fi
i=1
while [ "$i" -le "$total" ]; do
  name=$(printf 'part-%03d' "$i")
  f="$CHUNKS/$name"
  offset=$(( (i - 1) * PART_SIZE ))
  length=$(( BYTES - offset ))
  if [ "$length" -gt "$PART_SIZE" ]; then length=$PART_SIZE; fi
  if ! python3 - "$ZIP" "$f" "$offset" "$length" <<'PYSPLIT'
import sys
src, dest, offset, length = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
with open(src, 'rb') as source, open(dest, 'wb') as target:
    source.seek(offset)
    while length:
        block = source.read(min(length, 1024 * 1024))
        if not block:
            raise OSError('archive was truncated while preparing a chunk')
        target.write(block)
        length -= len(block)
PYSPLIT
  then
    echo "chunk preparation failed; no further uploads"
    exit 1
  fi
  upload_part "$f" "application/octet-stream" "$R2_KEY.$name" || \
    { echo "chunk $name failed; retry the feed before relying on the remote export"; exit 1; }
  rm -f "$f" || exit 1
  i=$((i + 1))
done
echo "uploaded $total chunks"
printf '%s\n' "$total" > "$CHUNKS/count" || exit 1
upload_part "$CHUNKS/count" "text/plain" "$R2_KEY.count" || \
  { echo "count upload failed; retry the feed before relying on the remote export"; exit 1; }
# The manifest is written last. A receiver verifies its checksum before using
# the archive, rejecting an interrupted upload or a mixture of generations.
python3 - "$ZIP" "$total" "$CHUNKS/manifest.json" "$LEAGUE_ID" <<'PYMANIFEST' || exit 1
import hashlib, json, sys
path, count, output, league_id = sys.argv[1:]
h = hashlib.sha256()
with open(path, 'rb') as f:
    for block in iter(lambda: f.read(1024 * 1024), b''):
        h.update(block)
with open(output, 'w', encoding='utf-8') as f:
    json.dump({'version': 1, 'count': int(count), 'sha256': h.hexdigest(), 'league_id': int(league_id)}, f, separators=(',', ':'))
    f.write('\n')
PYMANIFEST
upload_part "$CHUNKS/manifest.json" "application/json" "$R2_KEY.manifest.json" || \
  { echo "manifest upload failed; retry the feed before relying on the remote export"; exit 1; }
echo "uploaded export in $total parts with checksum manifest"
