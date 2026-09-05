#!/usr/bin/env bash
# Mirror out/ (all games) into site/data/ for GitHub Pages: drop all video,
# then generate games.json + each game's game.json.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# SRC must be a root whose children are game dirs. assemble_game_dir.py builds
# out/games/<game-id>/; in a repo where the notebook writes straight into
# out/<game-id>/ (no dev scratch), pass out instead.
SRC="${1:-$REPO_ROOT/out/games}"
DEST="${2:-$REPO_ROOT/site/data}"

[ -d "$SRC" ] || { echo "no such dir: $SRC" >&2; exit 1; }
mkdir -p "$DEST"

# 1. Mirror, excluding video (and anything else non-web you add here).
rsync -a --delete --prune-empty-dirs \
  --exclude='*.mp4' --exclude='*.mov' --exclude='*.mkv' --exclude='*.avi' \
  --exclude='.DS_Store' \
  "$SRC"/ "$DEST"/
  # Lean site: also drop debug-heavy dirs —
  #   --exclude='motion/***' --exclude='p2scan/***' \
  #   --exclude='ts/***' --exclude='ts_fine/***' --exclude='*.npy'

# 2. Build the game index + per-game manifests the front-end reads
#    (Pages has no autoindex, so the file lists must be baked in).
python3 "$REPO_ROOT/scripts/gen_manifest.py" "$DEST" "$SRC"

# 3. Stop Jekyll from touching the tree.
touch "$DEST/../.nojekyll"

# 4. Fail loudly if any video slipped through.
if find "$DEST" -type f \( -name '*.mp4' -o -name '*.mov' -o -name '*.mkv' -o -name '*.avi' \) | grep -q .; then
  echo "ERROR: video leaked into $DEST" >&2; exit 1
fi

echo "published $(find "$DEST" -type f | wc -l) files -> $DEST"
