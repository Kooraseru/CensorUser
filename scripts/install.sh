#!/usr/bin/env bash
# First-run setup and repeatable updater for MSYS2 / Git Bash on Windows.
set -euo pipefail

if [[ -n "${CENSORUSER_ROOT:-}" ]]; then
    root="$CENSORUSER_ROOT"
elif command -v cygpath >/dev/null 2>&1 && [[ -n "${LOCALAPPDATA:-}" ]]; then
    root="$(cygpath -u "$LOCALAPPDATA")/CensorUser"
else
    root="$HOME/.local/share/CensorUser"
fi

repo="$root/Plugin"
vencord="$root/Vencord"
first_run=0

command -v git >/dev/null 2>&1 || { echo 'Git is required.' >&2; exit 1; }
mkdir -p "$root"

if [[ ! -d "$repo/.git" ]]; then
    [[ ! -e "$repo" ]] || { echo "Refusing to overwrite $repo" >&2; exit 1; }
    git clone https://github.com/Kooraseru/CensorUser.git "$repo"
fi

[[ -d "$vencord/.git" ]] || first_run=1
if (( first_run )); then
    bash "$repo/scripts/sync.sh" --inject --vencord-dir "$vencord"
else
    bash "$repo/scripts/sync.sh" --vencord-dir "$vencord"
fi
