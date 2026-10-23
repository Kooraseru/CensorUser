# CensorUser

A standalone Vencord plugin for **identity masking**, not message censorship.

- Right-click a user or open a supported user/profile context menu and toggle **Censor User**.
- Censored authors' message usernames appear as black bars; chat avatars are blacked out.
- **Messages, attachments, embeds and reactions remain visible.**
- Preferences are saved by Discord user ID, and masking is reversible.
- Current scope is message-row identities. Profile cards, member lists, banners, badges, profile effects, mentions and other identity-bearing surfaces are **not yet reliably masked**. Do not rely on this prototype for privacy-sensitive screenshots.
- Context menu coverage varies with Discord's internal menu IDs; profile overflow support needs live testing.

## MSYS2 / Git Bash installation or update

Requires Git, Node.js and pnpm:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.sh)
```

The first run clones this repository and upstream Vencord under `%LOCALAPPDATA%/CensorUser` (when available), copies the plugin into `src/userplugins/censorUser`, installs dependencies, builds and invokes the injector. Later runs update both repositories using `git pull --ff-only` and rebuild. **Restart Discord after updating.** If the first-run injector download fails, run `pnpm inject` from the Vencord directory.

```bash
bash scripts/sync.sh
bash scripts/sync.sh --inject
bash scripts/sync.sh --no-update
bash scripts/sync.sh --vencord-dir /path/to/Vencord
```

PowerShell alternative:

```powershell
irm https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.ps1 | iex
```

This is visual redaction only. It does not modify Discord's message store or remote data, and it does not prevent someone from revealing identities using other UI elements or developer tools.

License: GPL-3.0-or-later.
