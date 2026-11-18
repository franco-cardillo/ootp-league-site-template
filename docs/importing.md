# Importing your OOTP 27 save

This guide takes you from **your own exported save** to a local website. The commands are for a Mac or Linux-style terminal, run from the root of your clone. Windows users can adapt the paths and environment-variable syntax to their shell. Finish the [demo quick start](../README.md#try-the-fictional-demo) first so dependencies are installed.

## 1. Export and identify your league

1. In OOTP 27, export the CSV files from the save you want to use. The importer reads existing files; it does not open OOTP or create the export for you. Export again after playing if you want a newer snapshot. Don't export or copy while the game is writing the save.
2. Find that save's `import_export/csv` folder, for example `/path/to/Your Save.lg/import_export/csv`. Keep the export files together and use the same save and snapshot for any optional photos, reports, or logs.
3. Open `leagues.csv` in a text editor or spreadsheet and find your intended primary league's `league_id`. The examples use **203 only as an example**; replace it with yours. It must be a positive whole number, and must appear in `leagues.csv`. The default is 203, but setting it explicitly avoids importing the wrong league. `--league-id` can instead be passed to the importer and takes precedence over `OOTP_LEAGUE_ID`.

### CSV checklist

The current [import schema](../scripts/import/schema.ts) names **24 CSV files**, not 28. The importer reads these 23 as required, even if a particular history or game-stat table has no rows:

```text
leagues.csv                         sub_leagues.csv
divisions.csv                       teams.csv
team_record.csv                     team_batting_stats.csv
team_pitching_stats.csv             players.csv
players_batting.csv                 players_pitching.csv
players_career_batting_stats.csv    players_career_pitching_stats.csv
players_roster_status.csv           games.csv
players_game_batting.csv            players_game_pitching_stats.csv
players_career_fielding_stats.csv   messages.csv
team_history.csv                    team_history_record.csv
league_history.csv                  cities.csv
nations.csv
```

The remaining schema file, `players_fielding.csv`, is **optional**; when absent, fielding ratings cannot contribute to the relevant estimates. Use the original OOTP filenames, headings, and export format. Simply creating empty placeholder files is not a substitute for a complete export. Missing data or unusual settings can make a page incomplete even when an import passes its checks.

## 2. Import into a fresh staging directory

Choose a destination that does **not yet exist**, or is truly empty, and is outside the save and every input directory. The importer creates it if necessary. Use a different destination for **every attempt**, even after failure: it reserves the directory and leaves a marker behind. It does not delete an older bundle.

Replace both example paths and `203` with your own values. Here `run-001` must be a new, unique directory, not `public/data`:

```sh
OOTP_LEAGUE_ID=203 pnpm data:import \
  --in "/path/to/Your Save.lg/import_export/csv" \
  --out "./.cache/ootp-import/run-001" \
  --photos "/path/to/Your Save.lg/news/html/images/person_pictures"
```

`--photos` is optional: omit the flag and its path if you do not want portraits. Use portraits from **this same save**, not another league: player IDs can be reused. Unmatched or unavailable portraits fall back to initials. The importer can also accept optional `--logos "/path/to/logos"` or `--logs "/path/to/Your Save.lg/news/txt/leagues"` for same-save logos or game-log-derived stories, when you have them and have the right to use them.

**Safety rules:**

- Never write directly over `public/data`, another bundle, your save, or an existing staging run. Keep the output and **all** inputs completely separate: neither may be inside the other. This includes CSVs, photos, logos, logs, BNN reports, ratings, and optional Lahman files.
- Use ordinary directories and files, **not symlinks**. The output path, including existing parent components, must not contain a symlink. Avoid symlinks in input paths too.
- Choose a private staging location whose directories cannot be changed by untrusted users or other processes while the import runs. Exclusive report creation prevents overwriting an existing report or symlink, but does not make an actively writable staging tree trustworthy.
- The importer reserves an empty destination and applies integrity checks. Errors return a failing status. A late error may leave partial files; **never publish a failed stage**, even if it contains JSON. Correct the issue and retry with a different new destination. Checks cannot guarantee every value or feature is correct.

The report is `import-report.json` **inside the chosen stage** (for the example, `.cache/ootp-import/run-001/import-report.json`); no separate report is written in the working directory. A completed import writes `"ok": true`; a validation failure attempts to write `"ok": false` and exits unsuccessfully without writing bundle files. Other errors may leave no report or a partial stage; if report creation or writing fails (for example, if the path already exists or the disk is full), the command also fails, and a report may be missing or incomplete. Always require the **current command's successful exit** and a readable, `"ok": true` report in that run's stage. Open the stage's `meta.json` and check the league ID, simulation date, and counts; then compare standings, rosters, and stats with your game. The report and generated files can contain league data.

## 3. Put the successful bundle on the local site

Only after the import succeeded and you have reviewed it, stop the dev server and any other process that could change `public/data`. First back up and move the demo or old bundle out of the way. These examples are **not** a delete command. Run them from the clone root and check each result before continuing:

```sh
backup="$(mktemp -d "${HOME}/ootp-data-backup.XXXXXXXX")" &&
  [ -d public/data ] && [ ! -L public/data ] &&
  mv public/data "$backup/data" &&
  printf 'Previous bundle backed up at %s/data\n' "$backup"
```

The new backup folder must be somewhere you intend to keep private. If `public/data` is already absent, there is nothing there to back up; otherwise, if this command fails, stop and investigate. Make sure the backup is intact. The report is a diagnostic, not a site asset: save it somewhere private if desired, then remove it from the reviewed stage before moving that stage into `public/data`. Otherwise it will be included in the site build and could become public. Substituting **the successful stage you actually reviewed**:

```sh
[ ! -e public/data ] && [ ! -L public/data ] &&
  rm -- "./.cache/ootp-import/run-001/import-report.json" &&
  mv "./.cache/ootp-import/run-001" public/data
```

If `public/data` exists, this command refuses to move the stage; do not merge the two directories. Start `pnpm dev` and open http://localhost:3000; refresh the browser after replacing a bundle. To update later, export again, import into a different new stage, review it, and repeat the backup-and-move process. Do not use `pnpm demo --force` to clear the data: that option deletes **everything** currently under `public/data`.

## Optional: dated BNN prospect report

Without an explicitly supplied report, the prospect board uses calculated estimates; it is not an official BNN ranking or a forecast. To include your own BNN Annual Top 100 Prospects report, obtain the HTML report for the **same save, primary league, and snapshot**. The extractor expects a dated report with ranks 1–100 and distinct player IDs. It creates a static JSON snapshot; it does not retrieve or refresh the report for you. Never use someone else's report or assume IDs identify the same player across saves.

For example, create a fresh directory so the extractor cannot overwrite an earlier snapshot, replacing the source path and league ID:

```sh
mkdir -p .cache
mkdir .cache/bnn-snapshot-001 &&
  OOTP_LEAGUE_ID=203 python3 scripts/import/extract-bnn.py \
    "/path/to/your-same-save-annual-top-100-report.html" \
    ".cache/bnn-snapshot-001/bnn-rank.json"
```

Use it only when explicitly requested on a **new local import**; this example uses a different staging directory:

```sh
OOTP_LEAGUE_ID=203 pnpm data:import \
  --in "/path/to/Your Save.lg/import_export/csv" \
  --out "./.cache/ootp-import/run-002" \
  --bnn "./.cache/bnn-snapshot-001/bnn-rank.json"
```

You can also add the optional `--photos` flag from the earlier example. A missing, malformed, or wrong-league report fails the import. Matching is conservative: some names may be unmatched or ambiguous, and the report date can differ from the CSV date. Re-extract a newer same-save report when needed; a CSV update alone does not refresh these ranks. The optional cloud workflow does **not** include `--bnn`.

## Optional: historical comparisons (Lahman)

For a wider pool of historical comparisons, run this before a new import:

```sh
pnpm data:lahman
```

This downloads public baseball data into the Git-ignored `scripts/data/lahman/` directory. The destination must be new or empty: the fetcher never overwrites existing data, and does not support `--force`. To fetch another copy, choose a different new or empty directory with `node scripts/data/fetch-lahman.mjs --out DIRECTORY`. The importer automatically uses the four files in the default directory when available; without them, it can use eligible history from your save instead. The download needs internet access. Comparisons describe similarity in the available data, **not predictions** of a player's future.

Attribution from the [fetch script](../scripts/data/fetch-lahman.mjs): the **Lahman Baseball Database (SABR)** is published under **CC BY-SA 3.0**, and the **Chadwick Baseball Databank** adds **ODC-By 1.0**. See the fetch script and downloaded manifest for the selected source; review the relevant attribution and license requirements before distributing derived material. This external dataset is not covered by this project's MIT license.

## Limitations and publishing

The importer and UI are based on one user's OOTP 27 format plus synthetic fixtures, not comprehensive testing of all saves, settings, or OOTP versions. The main views focus on one selected primary league and affiliated organizations; unusual structures, absent data, incomplete game logs, and custom settings may produce gaps or fail. Some overall ratings, rankings, and story details are computed estimates rather than the game's official values. Always compare with your own save.

The output is a dated static snapshot. `pnpm build` copies the current `public/data` into `dist/`; static hosting needs an `index.html` fallback for browser routes. Anything served by a public site is public, including derived league data and imported portraits, regardless of whether your original save or storage is private. Do not publish your export, images, logs, reports, or generated data unless you are comfortable sharing them and have the rights to do so. The [optional feed/deployment guide](../scripts/feed/README.md) describes a Mac upload to private R2 and an Actions/Cloudflare Pages deployment; its real cloud workflow has not been tested end-to-end. An upload alone does not deploy, scheduled rebuild is opt-in, and exporting new CSVs from OOTP may be manual.
