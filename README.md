# hockey-analysis

Static, client-side site that turns an ice-hockey game's analysis export into a
browsable view: pick a game, then filter by **period / team / player / event**,
with a rink-coordinate positional **heatmap** rendered from data.

## Layout

```
site/
  index.html  app.js  style.css  .nojekyll   # the GitHub Pages source (hand-written)
  preview.html                               # self-contained demo (data baked in)
  data/                                      # built by scripts/publish_out.sh — git-ignored
scripts/
  publish_out.sh    # mirror out/games/ -> site/data/ (drops video) + build the index
  gen_manifest.py   # site/data/games.json + <game>/game.json (Pages has no autoindex)
.github/workflows/pages.yml                  # build + deploy on push to main
publish-hockey-analysis.md                   # the full process / data-contract guide
```

## Build & preview locally

```bash
# 1. put an analysis run under out/games/<game-id>/  (events.csv, roster.csv,
#    periods/periods.json, identity/, lines/, heatmaps/*.grid.json + *_points.csv, …)
bash scripts/publish_out.sh          # -> site/data/  (+ games.json, game.json)
python3 -m http.server -d site 8000  # -> http://localhost:8000
```

`preview.html` needs none of that — open it directly.

## Heatmap = data

Each game exports `heatmaps/*.grid.json` (a pre-binned, smoothed density over the
60x30 m rink, `unit: "seconds"` occupied per 0.5 m cell) and `heatmaps/*_points.csv`
(the rink-metre point cloud). The page paints the grid to a `<canvas>`; for any
filter the pre-baked grids don't cover (a single player, a line) it bins the
point cloud client-side on the same `sel`.

## Deploy

Settings → Pages → Source: **GitHub Actions**. `pages.yml` runs `publish_out.sh`
on pushes to `main`, so `site/data/` is regenerated in CI (Model B). To serve
without CI, commit `site/data/` and drop the `Stage` step (Model A). Video is
never published — `publish_out.sh` aborts if any `*.mp4`/`*.mkv` reaches
`site/data/`.

> GitHub Pages deploys to the `github-pages` environment, which enforces the
> branch policy configured in the repository. If the workflow targets a feature
> branch, deployment will be rejected unless that branch is explicitly allowed in
> the environment protection rules. For a normal static site, deploy from `main`.

If `out/games` is not present yet, the script now publishes an empty manifest
instead of failing, which keeps the Pages workflow green while no game export
exists.
