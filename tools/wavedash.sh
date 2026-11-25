#!/bin/sh
# Builds Capitan Pachino 64 for Wavedash (https://wavedash.com) and uploads it as a new build:
#   sh tools/wavedash.sh [pachino64]
# wavedash.toml (at the root) says where: _wavedash/, filled here the way the Pages workflow
# assembles the site (index.html, js/, vendor/, models/; not src_model/).
# With the `wavedash` CLI on PATH it then runs `wavedash build push` (WAVEDASH_TOKEN from the
# environment); without it, or with WAVEDASH_DRY_RUN=1, it only says what it would push.
# Publishing a build is a separate step. The game id: WAVEDASH_GAME_ID_PACHINO64 or WAVEDASH_GAME_ID,
# else game_id in wavedash.toml.
set -e
cd "$(dirname "$0")/.."
GAMES="pachino64"
only=${1:-all}
case " all $GAMES " in
  *" $only "*) only=pachino64 ;;
  *) echo "unknown game '$only': pachino64 (the only one), or all" >&2; exit 2 ;;
esac

# Every relative path the build's pages and scripts name must be in it; none may start at /.
check() {
  b=$1
  [ -f "$b/index.html" ] || { echo "$b/index.html is missing" >&2; exit 1; }
  bad=$(find "$b" -type f \( -name '*.html' -o -name '*.js' -o -name '*.css' \) ! -path '*/vendor/*' ! -name '*.min.js' |
    while read -r f; do
      d=$(dirname "$f")
      { grep -oE '(src|href)="[^"]*"' "$f" | sed -E 's/^(src|href)="//; s/"$//'
        grep -oE "(from|import\\() *['\"]\\.{1,2}/[^'\"]*['\"]" "$f" | sed -E "s/^(from|import\\() *['\"]//; s/['\"]\$//"
      } | while read -r r; do
        case $r in '' | '#'* | *'://'* | '//'* | data:* | mailto:* | javascript:* | *'$'* | *'{'*) continue ;; /*) echo "$f: $r starts at /"; continue ;; esac
        p=${r%%[?#]*}
        [ -z "$p" ] || [ -e "$d/$p" ] || echo "$f: $r is not in the build"
      done
    done)
  [ -z "$bad" ] || { echo "$bad" >&2; exit 1; }
}

# The variable that holds a game's id, and the id: game_id <game> <folder of its wavedash.toml>.
id_var() { echo "WAVEDASH_GAME_ID_$(echo "$1" | tr 'a-z-' 'A-Z_')"; }
game_id() {
  eval "id=\${$(id_var "$1"):-}"
  [ -n "$id" ] || [ "$only" = all ] || id=${WAVEDASH_GAME_ID:-}
  [ -n "$id" ] || id=$(sed -n 's/^game_id *= *"\([^"]*\)".*/\1/p' "$2/wavedash.toml")
  echo "$id"
}

# Uploads one build: push <game> <folder of its wavedash.toml> <its upload_dir>.
push() {
  slug=$1 conf=$2 build=$3
  check "$build"
  id=$(game_id "$slug" "$conf")
  msg=${WAVEDASH_MESSAGE:-"$slug $(git rev-parse --short HEAD 2>/dev/null || echo local)"}
  size=$(du -sh "$build" | cut -f1)
  if command -v wavedash >/dev/null 2>&1 && [ -z "${WAVEDASH_DRY_RUN:-}" ]; then
    case $id in '' | SET-ME) echo "$slug: no Wavedash game id: set $(id_var "$slug") or game_id in $conf/wavedash.toml" >&2; exit 1 ;; esac
    [ -n "${WAVEDASH_TOKEN:-}" ] || echo "$slug: WAVEDASH_TOKEN is not set; the CLI uses its own login, if any" >&2
    echo "$slug: pushing $build ($size) to Wavedash game $id"
    (cd "$conf" && WAVEDASH_GAME_ID=$id wavedash build push -m "$msg")
  else
    echo "$slug: would push $build ($size) to Wavedash game ${id:-SET-ME}: cd $conf && wavedash build push -m \"$msg\""
  fi
}

rm -rf _wavedash
mkdir _wavedash
cp -r index.html js vendor models _wavedash/
push pachino64 . _wavedash
