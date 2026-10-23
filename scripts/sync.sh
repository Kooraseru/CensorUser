#!/usr/bin/env bash
# Sync CensorUser and upstream Vencord, build, and optionally launch the injector.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
vencord_dir="${CENSORUSER_VENCORD_DIR:-$(dirname "$repo_root")/Vencord}"
inject=0
no_update=0

while (($#)); do
    case "$1" in
        --inject) inject=1 ;;
        --no-update) no_update=1 ;;
        --vencord-dir)
            shift
            (($#)) || { echo 'Missing --vencord-dir value' >&2; exit 2; }
            vencord_dir="$1"
            ;;
        -h|--help)
            echo 'Usage: scripts/sync.sh [--inject] [--no-update] [--vencord-dir PATH]'
            exit 0
            ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
    shift
done

for cmd in git node pnpm; do
    command -v "$cmd" >/dev/null 2>&1 || { echo "Missing dependency: $cmd" >&2; exit 1; }
done
[[ -f "$repo_root/plugin/index.tsx" ]] || { echo 'Missing plugin/index.tsx' >&2; exit 1; }

if (( ! no_update )) && [[ -d "$repo_root/.git" ]]; then
    git -C "$repo_root" pull --ff-only
fi

if [[ ! -d "$vencord_dir/.git" ]]; then
    [[ ! -e "$vencord_dir" ]] || { echo "Refusing to overwrite $vencord_dir" >&2; exit 1; }
    mkdir -p "$(dirname "$vencord_dir")"
    git clone https://github.com/Vendicated/Vencord.git "$vencord_dir"
elif (( ! no_update )); then
    git -C "$vencord_dir" pull --ff-only
fi

plugin_dir="$vencord_dir/src/userplugins/censorUser"
mkdir -p "$plugin_dir"
cp "$repo_root/plugin/index.tsx" "$plugin_dir/index.tsx"

(
    cd "$vencord_dir"
    pnpm install --frozen-lockfile
    pnpm build
    if (( inject )); then
        echo 'Choose your Discord installation when the Vencord injector opens.'
        pnpm inject
    fi
)

echo 'CensorUser build complete. Restart Discord; enable CensorUser in Vencord settings.'
