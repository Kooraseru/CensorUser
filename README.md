# CensorUser

A standalone Vencord userplugin for **visual identity masking** – not message censorship.

- Open a user or message context menu and use the **Censor User** checkbox. Checked means anonymized; uncheck it to restore their identity. The state is remembered by Discord user ID.
- Chat message headers show a fixed-width black name bar, a black avatar, and no username-adjacent identity tags, badges, or avatar decorations.
- **Original message bodies, attachments, embeds, timestamps, and reactions remain visible.** No message data is modified.
- The censored-user ID list persists globally, including when switching between DMs, group DMs, and server channels. Loaded message rows are updated automatically.
- Clicking an anonymized author name or avatar in a message is prevented from opening the profile. In an active 1:1 DM with a censored user, known profile sidebar containers are hidden.

## Limitations

**This is a prototype, not guaranteed screenshot-safe anonymization.** Discord UI elements without a reliable user-ID association cannot be confidently masked by this implementation. In particular, user profiles opened via other routes, group DM/member lists, mentions made by other users, tooltips, notifications, DM navigation titles and third-party plugin UI **may still identify a censored user**. Visual CSS changes do not remove names from underlying Discord data or developer tools. Inspect the screen before recording/sharing it.

The implementation intentionally masks structurally identifiable author components rather than replacing all matching text everywhere, which would alter conversation content or censor unrelated users with similar names. Profile and sidebar selectors may change with Discord updates.

## MSYS2 / Git Bash – install or update

Requires Git, Node.js, and pnpm available on `PATH`.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.sh)
```

First run: clone this repository and upstream Vencord separately under `%LOCALAPPDATA%/CensorUser` on Windows, copy the plugin into `src/userplugins/censorUser`, install dependencies, build, and launch the interactive injector. Later runs: fast-forward pull both repositories and rebuild. Restart Discord after updating.

If you already installed Vencord, future runs reuse that checkout. To rerun the injector manually, use `pnpm inject` from the Vencord directory.

You can also run directly from a plugin checkout:

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

GPL-3.0-or-later.