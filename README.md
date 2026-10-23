# CensorUser

A standalone Vencord userplugin for **visual identity masking** – not message censorship.

- Open a user or message context menu and use the **Censor User** checkbox. Checked means anonymized; uncheck it to restore their identity. The state is remembered by Discord user ID.
- Message headers use a black name bar and avatar, without nearby user tags, badges, or decorations.
- **Reply previews** resolve the original author's Discord ID and mask that author's name, avatar, and tags when the referenced message is available. The quoted text remains visible.
- **Member lists** use Vencord's `MemberListDecoratorsAPI` to identify users and hide the selected member's name, image, tags, and status. Context-menu access is retained for reversing censorship.
- **User profile popouts and DM profile sidebars** are suppressed when their user ID can be associated with the renderer. This hides visible statuses, decorations, banners, and activity cards in those profile views.
- **Original message bodies, attachments, embeds, timestamps, and reactions remain visible.** No message data is modified.
- The censored-user ID list persists globally, including when switching between DMs, group DMs, and server channels. Loaded message rows are updated automatically.

## Limitations

**This is a prototype, not guaranteed screenshot-safe anonymization.** The updated reply, member-list, and profile handling relies on current Discord/Vencord rendering structures and still needs live runtime validation. In particular, mentions by other users, some profile-opening routes, tooltips, notifications, search results, DM navigation titles, and third-party plugin UI **may still identify a censored user**. Visual CSS changes do not remove names from underlying Discord data or developer tools. Inspect the screen before recording/sharing it.

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