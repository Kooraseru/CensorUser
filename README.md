# CensorUser

A standalone custom Vencord plugin that **replaces rendered identity fields locally**. It does not erase chat messages, overlay black rectangles over the interface, or modify Discord's server-side user/message records.

## Behavior

- Open a user or profile context menu and check **Censor User**. Uncheck it to restore their identity. Censored IDs persist across conversations and Discord restarts.
- **Messages:** Replace the selected author's displayed name with black block characters and their avatar image source with a neutral black SVG. Their message text, attachments, quoted content, embeds, reactions, and timestamps remain readable.
- **Replies:** Resolve the referenced author's ID through Discord's message stores, then replace the author name/avatar and remove nearby identifying tags. The quote remains intact.
- **Members/DM lists:** Replace names and profile image sources in the identified user's row. Remove associated custom status, tags, decorations, and other identity fields while preserving row interactions.
- **Profiles:** Keep popouts and full-profile navigation functional. Replace identity text/image fields and remove personalized profile sections, status, about/bio, decorations/effects, linked accounts, and activity.
- **Restoration:** The plugin tracks original rendered text, image attributes, and visibility styles in memory and restores them when censorship is switched off. It does not replace or overwrite Discord's user data objects.

## MSYS2 / Git Bash – install or update

Requires Git, Node.js 22+, and pnpm on your PATH.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Kooraseru/CensorUser/main/scripts/install.sh)
```

The first run clones this repo plus upstream Vencord separately under `%LOCALAPPDATA%/CensorUser` on Windows, installs dependencies, builds, and runs Vencord's injector. Later runs use `git pull --ff-only` and rebuild. Restart Discord after updating.

You can also run the synced checkout directly:

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

## Limitations

**This is a prototype and is not guaranteed safe for anonymized screenshots or recordings.** Discord changes internal component structures, and some fields may still appear through search, mentions, tooltips, notifications, third-party plugins, profile widgets, or undocumented UI paths. The replacement is applied to the rendered client view; the underlying Discord data remains available to the client and its developer tools.

The replacement/restoration helpers pass source syntax/type checks using Vencord-compatible stubs and targeted unit tests. A full Vencord build and the live Discord rendering paths have **not** been verified for this revision. Review the visible output before publishing it.

License: GPL-3.0-or-later.
