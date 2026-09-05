#!/usr/bin/env python3
"""Build the site's data index from a mirrored out/ tree:

  site/data/games.json           - one row per game            (game selector)
  site/data/<game-id>/game.json  - metadata + players + periods + event
                                   facets + grouped asset index

A "game" is any immediate sub-dir of out/ that has an events.csv. If out/
holds a single game's files directly, it is treated as one game, id "game".
"""
import ast
import csv
import json
import subprocess
import sys
import time
from pathlib import Path

dest = Path(sys.argv[1]).resolve()
src = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else None


def git(*args, cwd):
    try:
        return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()
    except Exception:
        return None


def read_csv(path):
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def parse_list(cell):
    try:
        v = ast.literal_eval(cell) if cell else []
        return [str(x) for x in v] if isinstance(v, (list, tuple)) else []
    except Exception:
        return []


def game_dirs(root):
    subs = [(d, d.name) for d in sorted(root.iterdir())
            if d.is_dir() and (d / "events.csv").is_file()]
    if subs:                                    # prefer game sub-dirs
        return subs
    if (root / "events.csv").is_file():         # root itself is one game
        return [(root, "game")]
    return []


def asset_index(gdir):
    groups: dict[str, list] = {}
    for p in sorted(gdir.rglob("*")):
        if not p.is_file() or p.name in {"game.json", "meta.json"}:
            continue
        rel = p.relative_to(gdir)
        top = rel.parts[0] if len(rel.parts) > 1 else "."
        groups.setdefault(top, []).append(
            {"path": str(rel).replace("\\", "/"), "bytes": p.stat().st_size,
             "ext": p.suffix.lower().lstrip(".")})
    return groups


def build_game(gdir, gid):
    events = read_csv(gdir / "events.csv") if (gdir / "events.csv").is_file() else []
    roster = read_csv(gdir / "roster.csv") if (gdir / "roster.csv").is_file() else []
    meta = json.loads((gdir / "meta.json").read_text()) if (gdir / "meta.json").is_file() else {}

    pj = gdir / "periods" / "periods.json"
    periods = json.loads(pj.read_text()).get("periods", []) if pj.is_file() else []

    teams = (list(dict.fromkeys(r["team"] for r in roster)) if roster
             else list(dict.fromkeys(e["team"] for e in events if e.get("team"))))
    home = meta.get("home") or (teams[0] if teams else None)
    away = meta.get("away") or (teams[1] if len(teams) > 1 else None)

    goals = [e for e in events if e.get("type") == "goal" and e.get("score")]
    score = meta.get("score") or (goals[-1]["score"] if goals else None)  # home:away

    # players that appear anywhere in events -> "hasEvents" hint for the picker
    involved = set()
    for e in events:
        involved.update(x for x in (e.get("player"), e.get("scorer")) if x)
        involved.update(parse_list(e.get("assists", "")))

    players = [
        {"team": r["team"], "number": r.get("number"), "name": r["name"],
         "pos": r.get("pos") or None, "flag": r.get("flag") or None,
         "hasEvents": r["name"] in involved}
        for r in roster
    ]

    game = {
        "id": gid,
        "date": meta.get("date"),
        "competition": meta.get("competition"),
        "video": meta.get("video"),
        "home": home, "away": away, "score": score,
        "label": " · ".join(x for x in [
            meta.get("date"),
            f"{away} @ {home}" if home and away else gid,
            f"({score})" if score else ""] if x),
        "periods": [
            {"period": p.get("period"), "vid_start": p.get("vid_start"),
             "vid_end": p.get("vid_end"), "dur_min": p.get("dur_min"),
             "wall_start": p.get("wall_start"), "wall_end": p.get("wall_end")}
            for p in periods
        ],
        "players": players,
        "filters": {
            "eventTypes":  sorted({e["type"] for e in events if e.get("type")}),
            "eventStates": sorted({s for e in events
                                   for s in (e.get("state") or "").split(",") if s}),
            "infractions": sorted({e["infraction"] for e in events if e.get("infraction")}),
            "teams": [t for t in (home, away) if t],
        },
        "hasTrackIdentity": (gdir / "identity" / "number_votes.csv").is_file(),
        "assets": asset_index(gdir),
    }
    (gdir / "game.json").write_text(json.dumps(game, indent=2))
    return game


games = []
for gdir, gid in game_dirs(dest):
    g = build_game(gdir, gid)
    games.append({k: g[k] for k in ("id", "label", "date", "competition",
                                    "home", "away", "score")}
                 | {"dir": gid, "periods": len(g["periods"]),
                    "players": len(g["players"])})

index = {
    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "sourceCommit": git("rev-parse", "HEAD", cwd=src) if src else None,
    "gameCount": len(games),
    "games": games,
}
(dest / "games.json").write_text(json.dumps(index, indent=2))
print(f"indexed {len(games)} game(s):", ", ".join(g["id"] for g in games) or "none")
