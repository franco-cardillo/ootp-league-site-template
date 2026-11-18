# Optional Mac feed and Cloudflare Pages deployment

The uploader reads the CSVs **already exported by OOTP** from the chosen save's `import_export/csv`. It does not run OOTP or export new CSVs. Export data again inside OOTP after playing, then upload. The uploader never triggers GitHub or rebuilds the site. GitHub Actions reads the last completed upload only when you manually start a deployment or explicitly enable the optional schedule below.

The CSV archive includes only the exact, case-sensitive filenames in the importer's [24-file schema](../import/schema.ts), including optional `players_fielding.csv` when present. Missing files are not filled in; the later import can fail if required exports are absent. Other CSVs, hidden files, non-CSV files, backups and subdirectories in the CSV directory are not copied. For stories it includes only direct `news/txt/leagues/log_<numeric game ID>.txt` files, and it selects same-save `player_<numeric ID>.png` portraits as described below. These restrictions do not inspect or sanitize file contents: schema CSVs, logs and images can still contain private data. Review the actual export and archive before uploading or publishing.

**Privacy:** R2 can remain private, but anything deployed to Pages—including CSV-derived league data, game stories and imported portraits—is public. Review your export, publishing rights and site contents first. Do not commit exports, configuration or credentials. The checkout, GitHub Actions logs and anyone with repository write access must be trusted; only deploy trusted code, because workflow code can use these secrets. Protect the repository and GitHub Actions settings. Use a dedicated bucket and narrowly scoped tokens.

## 1. Create private R2 storage and a Pages project

Create a private R2 bucket in your Cloudflare account, using the default jurisdiction (the scripts do not support jurisdiction-specific endpoints). Do not enable public R2 access. Create an R2 S3 API token scoped to this bucket with Object Read & Write for the Mac, and a separate Object Read-only R2 token for GitHub Actions. Record the **Access Key ID** and **Secret Access Key**, not the token value. See [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/) and [private bucket notes](https://developers.cloudflare.com/r2/buckets/create-buckets/).

Create an existing Cloudflare Pages **Direct Upload** project and choose its production branch. A Direct Upload project cannot later be converted to Git integration. Create a separate Cloudflare API token with account-level **Cloudflare Pages: Edit** permission for deployment. See [Cloudflare's Direct Upload CI guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/). R2 credentials and the Pages API token are different.

## 2. Configure and upload from the Mac

Requires Python 3 and a curl build supporting `--aws-sigv4`, `--retry-all-errors`, and HTTPS; the Mac must have network access to R2. If the system curl is too old, install a newer curl on your PATH. Copy `scripts/feed/feed.conf.example` to `~/.ootpverse-feed.conf` and restrict it with `chmod 600 ~/.ootpverse-feed.conf`. Edit it privately with your own values; it is a **trusted shell-sourced file**, so don't use untrusted content or enable shell tracing.

Local settings (in the config or environment):

- `OOTP_LG`: the full local `.lg` save directory; if absent, the newest discovered save in common Mac locations is used. Prefer pinning it using `bash scripts/feed/set-save.sh "/path/to/Your League.lg"`; this preserves existing settings.
- `OOTP_LEAGUE_ID`: positive JavaScript-safe integer selecting the primary league, default `203`. Set the **same ID** in GitHub's configuration. Portrait selection follows this league and its affiliated organizations.
- `OOTPVERSE_REPO`: local clone path, optional; defaults to the clone containing `feed.sh`. Its `.cache/` must not overlap the save, and must not be a symlink. The feed reserves `.cache/export.zip` for the latest successful local archive.
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET`: the R2 account ID, Mac write-token Access Key ID and Secret Access Key, and private bucket. Do not expose these values.
- `R2_KEY`: object-key prefix, default `export.zip`; only ASCII letters, digits, `_`, `-`, `.`, and `/` are accepted, without empty or dot path segments. Use the same value in GitHub. This prefix is not an HTTP URL.
- `OOTP_FEED_LOG` changes the local log path. The following are per-run **environment variables**, not config-file options: `OOTP_FEED_DRY_RUN=1` builds `.cache/export.zip` locally without uploading or needing R2 credentials; `OOTP_FEED_REQUIRE_PHOTOS=1` refuses an upload with zero matching portraits; `OOTP_FEED_SAVE` overrides the selected save for that invocation.

After exporting CSVs in OOTP, run `bash scripts/feed/feed.sh` from the clone. It writes a local log under `~/Library/Logs/ootpverse-feed.log` by default. For an optional 15-minute Mac upload schedule, run `bash scripts/feed/install.sh`; it performs an upload first and installs a launch agent only if successful. It does not install or require GitHub credentials. The Mac must be running, and sleeping/offline periods can delay uploads. To stop it: `launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.ootpverse.feed.plist"` and remove that plist. A failed upload should be retried before deploying.

The feeder reads but never deletes or writes the save. It creates a private, uniquely named `.cache/ootpverse-feed-work.*` directory for each run and removes only that run's directory after path and save-overlap checks; it does not clear or use existing `drop/` or `.cache/chunks`. It replaces `.cache/export.zip` only after packing succeeds. A forced kill may leave the work directory and lock behind: verify no feeder is running and inspect those specific paths before removing them manually. A selected save that is itself a symlink, symlinks in the three source directory paths, or any direct symlink entry in those source directories cause a failure rather than being followed; nested directories are not traversed. The cache directory, archive and log themselves also must not be symlinks. Use ordinary source files and keep other processes from changing the save or staging paths during a run. The archive and any abandoned work directory contain private export data; protect and delete them appropriately when no longer needed.

For scheduled uploads, persist `OOTP_LG`, `OOTP_LEAGUE_ID`, and all R2 settings in the private config file. The launch agent does not inherit interactive-shell credentials or other one-off variables; it inherits the installer's `PATH` to find tools. Credentials are not written to the launch-agent plist.

## 3. Configure GitHub Actions

In your own repository's **Settings → Secrets and variables → Actions**, create repository **secrets**:

- `R2_ACCOUNT_ID`: the 32-character hexadecimal R2 account ID.
- `R2_ACCESS_KEY` and `R2_SECRET_KEY`: the read-only R2 token's Access Key ID and Secret Access Key.
- `CLOUDFLARE_ACCOUNT_ID`: the 32-character hexadecimal account ID of the Pages project; it may equal the R2 account ID.
- `CLOUDFLARE_API_TOKEN`: the Pages Edit API token.

Create repository **variables**:

- `R2_BUCKET`: your private bucket name.
- `R2_KEY`: same object-key prefix as the uploader; optional, default `export.zip`.
- `OOTP_LEAGUE_ID`: same league ID as the Mac; optional, default `203`.
- `CLOUDFLARE_PAGES_PROJECT`: your existing Pages project name.
- `CLOUDFLARE_PAGES_BRANCH`: production branch configured for that project, optional, default `main`. Another branch makes a preview, not production.
- `OOTP_ENABLE_SCHEDULED_DEPLOY`: optional; set exactly `true` only to opt in to automatic daily deploys. Missing or any other value skips the scheduled job.

Review `.github/workflows/deploy-pages.yml`. In the Actions tab, select **Deploy private OOTP feed to public Pages** → **Run workflow** on a trusted revision. This downloads via private authenticated S3/R2 requests, validates and extracts the completed feed, imports it, checks the import report, builds, and deploys `dist/`. Failure prevents the subsequent deployment. Import and deploy command output is suppressed because logs can be visible to repository readers; reproduce import failures locally and check Cloudflare's dashboard for deployment errors. No public R2 URL is used.

### Optional scheduled rebuild

The workflow also has a daily `17 4 * * *` schedule, **04:17 UTC**; the job does nothing unless the `OOTP_ENABLE_SCHEDULED_DEPLOY` repository variable is exactly `true`. Each opted-in run performs a full import, build, and deployment even if the upload did not change, consuming GitHub Actions minutes and possibly Cloudflare operations. Change the cron in your default-branch workflow to a suitable UTC cadence, or delete the variable to stop scheduled deployments. The scheduled event may still appear as a skipped workflow run while disabled.

GitHub schedules use the default branch and can be delayed or dropped, and GitHub may automatically disable a scheduled workflow after 60 days of public-repository inactivity. See [GitHub schedule documentation](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). A schedule does not notice an upload immediately and is not evidence that OOTP exported new CSVs. For quicker updates, upload after exporting and manually dispatch the workflow.

## Protocol and limitations

The uploader uses `<R2_KEY>.part-001`, `.part-002`, …, and `<R2_KEY>.count` containing a decimal count plus newline. Each part is at most 16,000,000 bytes; the maximum is 1,000 parts. It writes `<R2_KEY>.manifest.json` last with the count, selected league ID, and SHA-256 of the entire ZIP. The workflow refuses a league ID that differs from its own setting. The workflow requires this marker, rereads count and manifest, and verifies the reconstructed ZIP checksum before extraction; missing parts, mixed old/new parts, a changed marker, or unsafe ZIP entries fail closed. Old uploads without a manifest must be uploaded again using this version. This detects incomplete/concurrent reads but is not a transactional multi-writer protocol: use only **one Mac/writer per bucket and prefix**, and never start another upload until the prior upload completes. A failed upload can leave unusable partial objects; retry to recover. Old higher-numbered parts are not automatically deleted. R2 object retention and deleting stale objects are the bucket owner's responsibility.

The importer supports its documented input scope, not every OOTP configuration. Logs and portraits are optional; the uploader limits portraits to 15,000 but that does not guarantee Cloudflare Pages file-count or size limits. The workflow uses no custom rankings snapshot or logos; add these locally through the documented importer workflow if wanted. The uploader's source files may change while OOTP is saving/exporting; avoid running it during that operation.

Run the synthetic offline protocol tests with `python3 -m unittest discover -s tests -p 'feed*_test.py' -v`. The optional independent signature comparison is skipped if `botocore` is not installed. Real R2 permissions, Mac launchd/curl compatibility, GitHub scheduling and Cloudflare Pages deployment must be validated in the adopter's own account; no live cloud test is implied.
