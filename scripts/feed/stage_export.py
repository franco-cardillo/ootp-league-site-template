#!/usr/bin/env python3
"""Stage only known importer inputs from the selected save; never modify it."""
import os
from pathlib import Path
import re
import shutil
import stat
import sys

# Keep in sync with FILES in scripts/import/schema.ts (including optional files).
CSV_FILES = frozenset({
    'leagues.csv', 'sub_leagues.csv', 'divisions.csv', 'teams.csv',
    'team_record.csv', 'team_batting_stats.csv', 'team_pitching_stats.csv',
    'players.csv', 'players_batting.csv', 'players_pitching.csv',
    'players_career_batting_stats.csv', 'players_career_pitching_stats.csv',
    'players_roster_status.csv', 'games.csv', 'players_game_batting.csv',
    'players_game_pitching_stats.csv', 'players_career_fielding_stats.csv',
    'players_fielding.csv', 'messages.csv', 'team_history.csv',
    'team_history_record.csv', 'league_history.csv', 'cities.csv', 'nations.csv',
})


def copy_regular(source, destination):
    # Reject links even if replaced after directory enumeration. O_NONBLOCK keeps
    # a substituted FIFO from hanging the feeder before fstat can reject it.
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(source, flags)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise ValueError('not a regular file: ' + str(source))
        with os.fdopen(fd, 'rb') as src:
            fd = -1
            with open(destination, 'xb') as dest:
                shutil.copyfileobj(src, dest, length=1024 * 1024)
    finally:
        if fd != -1:
            os.close(fd)


def stage_directory(source, destination, accepts):
    destination.mkdir(parents=True)
    with os.scandir(source) as entries:
        for entry in entries:
            # Never follow any direct symlink in an input directory, including
            # links with names that would otherwise be ignored.
            if entry.is_symlink():
                raise ValueError('symlink in feed source: ' + entry.path)
            if accepts(entry.name):
                copy_regular(entry.path, destination / entry.name)


def main(csv_dir, logs_dir, work):
    work = Path(work)
    stage_directory(csv_dir, work / 'drop/csv', lambda name: name in CSV_FILES)
    if os.path.isdir(logs_dir):
        stage_directory(logs_dir, work / 'drop/logs',
                        lambda name: re.fullmatch(r'log_[0-9]+\.txt', name) is not None)


if __name__ == '__main__':
    try:
        main(*sys.argv[1:])
    except (OSError, ValueError) as error:
        print('feed staging failed: ' + str(error), file=sys.stderr)
        sys.exit(1)
