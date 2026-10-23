# CensorUser

A standalone [Vencord](https://github.com/Vendicated/Vencord) userplugin. Right-click a user or their message and toggle **Censor User**. Chat rows from that author are replaced locally with a redacted placeholder, including the message text, name, avatar, and embedded content.

**Status: prototype.** Message-row tagging follows Vencord's own `ThemeAttributes` patch, but live Discord behavior is not verified. This is visual redaction, *not* complete anonymization: member lists, mentions elsewhere, search, notifications, and underlying Discord data are not censored.

## MSYS2 / Git Bash – one command to install or update

Run with Git, Node.js, and pnpm available:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.sh)
```

The first run clones this repository and upstream Vencord separately under `%LOCALAPPDATA%/CensorUser` when available, or `$HOME/.local/share/CensorUser` otherwise. It copies the plugin into `src/userplugins/censorUser`, runs `pnpm install --frozen-lockfile`, builds, and launches the interactive Vencord injector. Restart Discord and enable **CensorUser** in Vencord plugin settings.

**Run the same command to update.** Both Git checkouts use `git pull --ff-only`, followed by another build. No Vencord fork or tokens required.

From an existing clone:

```bash
bash scripts/sync.sh
bash scripts/sync.sh --inject
bash scripts/sync.sh --no-update
bash scripts/sync.sh --vencord-dir /path/to/Vencord
```

Use `CENSORUSER_ROOT` and `CENSORUSER_VENCORD_DIR` to override paths.

## PowerShell alternative

```powershell
irm https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.ps1 | iex
```

## Files

- `plugin/index.tsx` – Vencord plugin
- `scripts/install.sh` and `scripts/sync.sh` – MSYS2 installer and updater
- `scripts/install.ps1` and `scripts/sync.ps1` – PowerShell equivalents

The upstream Vencord source is never committed to this repo. No force-resets are performed. The plugin copies only its own file into the separate Vencord checkout.

## Scope

The toggle applies globally per Discord user ID. It masks the selected user's own chat message rows and does not alter MessageStore or Discord servers. It does **not** guarantee fully anonymous screenshots and may need updating when Discord changes its internal message renderer.

[Custom plugin documentation](https://docs.vencord.dev/installing/custom-plugins/) · [Build instructions](https://docs.vencord.dev/installing/) · [GPL-3.0-or-later license](https://www.gnu.org/licenses/gpl-3.0.txt).
