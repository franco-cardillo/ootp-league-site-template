#!/usr/bin/env python3
"""Extract a *static* BNN snapshot, not a live or automatically refreshed feed.

Usage: OOTP_LEAGUE_ID=203 python3 scripts/import/extract-bnn.py /path/to/report.html public/data/bnn-rank.json
Use --league-id to override OOTP_LEAGUE_ID; either must be a positive safe integer (default 203).
The report's player and team IDs are snapshot metadata, not authoritative join keys.
"""
import argparse
import hashlib
import json
import os
import re
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path


class ReportParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.row = None
        self.cell = None
        self.player_id = None
        self.org_id = None
        self.entries = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'tr':
            self.row = []
            self.player_id = self.org_id = None
        elif tag == 'td' and self.row is not None:
            self.cell = []
        elif tag == 'a' and self.cell is not None:
            href = attrs.get('href', '')
            match = re.search(r'/players/player_(\d+)\.html', href)
            if match:
                self.player_id = int(match.group(1))
            match = re.search(r'/teams/team_(\d+)\.html', href)
            if match:
                self.org_id = int(match.group(1))

    def handle_data(self, data):
        if self.cell is not None:
            self.cell.append(data)

    def handle_endtag(self, tag):
        if tag == 'td' and self.cell is not None and self.row is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            if self.player_id is not None:
                if len(self.row) < 9 or self.org_id is None:
                    raise ValueError(f'Incomplete player row: {self.row!r}')
                rank, name, org, age, position = self.row[:5]
                level_index = 8 if position in {'SP', 'RP', 'CL', 'P'} else 10
                self.entries.append({
                    'rank': int(rank), 'name': name, 'reportPlayerId': self.player_id,
                    'organizationId': self.org_id, 'organization': org,
                    'age': int(age), 'position': position, 'level': self.row[level_index],
                })
            self.row = self.cell = None


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument('report_html')
    cli.add_argument('output_json')
    cli.add_argument('--league-id', default=os.environ.get('OOTP_LEAGUE_ID', '203'))
    args = cli.parse_args()
    if not re.fullmatch(r'[0-9]+', args.league_id) or not 0 < int(args.league_id) <= 9007199254740991:
        cli.error('OOTP_LEAGUE_ID / --league-id must be a positive safe integer')
    league_id = int(args.league_id)
    source = Path(args.report_html).read_bytes()
    text = source.decode('utf-8-sig')
    header = re.search(r'ANNUAL TOP 100 PROSPECTS</div>\s*<div[^>]*>(\d{2}/\d{2}/\d{4})</div>', text)
    if not header:
        raise ValueError('Cannot find the report date in the league header')
    parser = ReportParser()
    parser.feed(text)
    entries = sorted(parser.entries, key=lambda row: row['rank'])
    if [row['rank'] for row in entries] != list(range(1, 101)):
        raise ValueError('Report must contain exactly one occurrence of every rank 1–100')
    if len({row['reportPlayerId'] for row in entries}) != 100:
        raise ValueError('Report contains duplicated player IDs')
    snapshot = {
        'schemaVersion': 1,
        'reportDate': datetime.strptime(header.group(1), '%m/%d/%Y').date().isoformat(),
        'leagueId': league_id,
        'source': f'OOTP BNN Annual Top 100 Prospects, primary league {league_id}',
        'sourceSha256': hashlib.sha256(source).hexdigest(),
        'note': 'Static report snapshot; it does not update with the CSV feed. Replace manually from a newer official report. Report IDs are not safe cross-snapshot join keys.',
        'entries': entries,
    }
    Path(args.output_json).write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f"Extracted {len(entries)} ranks from {snapshot['reportDate']} to {args.output_json}")


if __name__ == '__main__':
    main()
