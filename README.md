# OOTP League Site Template

A hobby project for turning an Out of the Park Baseball save into a browsable league website. Explore standings, teams, players, scores, prospects, and history using a fictional demo first, then optionally import your own OOTP 27 export. Some pages and details depend on what your save contains; the watchlist is a placeholder, not an account feature.

This is a **static snapshot**, not a connection to your running game. The site does not export your save; updating a published site requires the optional deployment workflow described below.

## Try the fictional demo

You need **Node.js 22 or newer**, **pnpm 12.16.1**, and **Python 3**. Python is used by optional tools; no OOTP save is needed for the demo. If you already have Node and npm but not the required pnpm version, you can install it with `npm install -g pnpm@12.16.1`.

1. Create your own repository from this template, then clone **your** repository. Replace the placeholder with its clone URL:

   ```sh
   git clone "<YOUR-REPOSITORY-CLONE-URL>" ootp-league-site
   cd ootp-league-site
   ```

2. Install the locked dependencies, generate the demo, and start the site:

   ```sh
   pnpm install --frozen-lockfile
   pnpm demo
   pnpm dev
   ```

3. Open **http://localhost:3000**. The demo's teams, players, scores, stories, and statistics are invented. Press `Ctrl+C` in the terminal to stop the server. The development server listens on all network interfaces, so use a trusted network or firewall if other devices should not reach it.

`pnpm demo` writes to `public/data` and refuses to overwrite a nonempty directory. **Do not use `--force` casually:** it deletes and replaces the *entire* current `public/data` directory, including imported data and other files. Back up anything you want to keep first.

## Use your own save

Export your own save's CSVs from OOTP 27, find your primary league's `league_id` in `leagues.csv`, and import into a **new, unique staging directory**. Portraits from that same save are optional. After a successful import, back up and move the old demo out of the way before moving the staged bundle to `public/data`.

Follow the [step-by-step import guide](docs/importing.md) for the exact files, commands, safe replacement steps, optional BNN report and Lahman comparisons, and troubleshooting. Never import directly over an existing bundle, and never publish a failed import.

In short, the paths work like this:

```text
Your OOTP save → your CSV export (+ optional same-save images/report)
               → importer → new staging directory → public/data → website
Fictional demo generator ─────────────────────────→ public/data → website
```

The importer is based on one user's OOTP 27 export format and synthetic test fixtures. It is not a guarantee that every OOTP version, league structure, custom setting, or export will work. Verify the result against your game before sharing it.

## Build and share

With the intended demo or successfully imported bundle in `public/data`, run:

```sh
pnpm build
```

The static website is written to `dist/`. A host must serve the files and send browser routes back to `index.html`; the included `public/_redirects` supplies the Cloudflare Pages fallback. Building alone does not publish anything.

The repository is the **template source**, not a hosted copy of your save: generated `public/data` is ignored by Git. A build nevertheless includes that data in `dist/`. **Anyone can read data, portraits, and other content published on a public site**, even if your repository or intermediate storage is private. Review the contents, privacy, and your rights before sharing. Keep exports, generated game assets, credentials, and machine-specific configuration out of the public repository.

For an optional Mac uploader, private R2 storage, and GitHub Actions → Cloudflare Pages workflow, see [the feed and deployment guide](scripts/feed/README.md). The uploader packages only schema-named CSVs and selected logs and portraits, rejects source symlinks, and uses isolated staging outside the save; still review the archive because those files may contain private information. That cloud workflow has synthetic/offline coverage but **has not been tested end-to-end on a real cloud account**. Uploading alone does not trigger a deployment; manually run the workflow or explicitly opt into its scheduled rebuild. OOTP CSV export may still be a manual step.

## License and attribution

This independent fan project is not affiliated with or endorsed by Out of the Park Developments or OOTP Baseball. The [MIT license](LICENSE) covers this project's code and documentation, not OOTP/game assets, your save or other user data, or the external Lahman/Chadwick dataset. Supply only assets and data you have the right to use; none of your save's portraits, logos, reports, or CSVs are shipped by this template. The optional historical dataset has its own attribution and licenses, described in the [import guide](docs/importing.md#optional-historical-comparisons-lahman).
