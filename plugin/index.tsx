/*
 * CensorUser – a reversible, local message privacy overlay.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";

const STYLE_ID = "vc-censor-user-style";
const AUTHOR_ATTRIBUTE = "data-vc-censor-author";
const SNOWFLAKE = /^\d{15,22}$/;

/** Store immutable IDs rather than changeable usernames. */
function parseIds(value: string): string[] {
    return [...new Set(value.split(/[\s,;]+/).filter(id => SNOWFLAKE.test(id)))];
}

const settings = definePluginSettings({
    censoredUserIds: {
        type: OptionType.STRING,
        description: "Censored Discord user IDs. Use the Censor User context-menu checkbox to toggle them.",
        default: "",
        multiline: true,
        onChange: () => refreshStyles()
    }
});

function isCensored(id: string | undefined): boolean {
    return Boolean(id && parseIds(settings.store.censoredUserIds).includes(id));
}

/**
 * Update a stylesheet rather than modifying Discord's message data. Updating
 * the stylesheet also affects message rows already mounted in the viewport.
 */
function refreshStyles(): void {
    const style = document.getElementById(STYLE_ID);
    if (!style) return;

    const ids = parseIds(settings.store.censoredUserIds);
    if (!ids.length) {
        style.textContent = "";
        return;
    }

    const rows = ids.map(id => `li[${AUTHOR_ATTRIBUTE}="${id}"]`);
    const selectors = (suffix = "") => rows.map(row => row + suffix).join(",\n");

    style.textContent = `
${selectors()} {
    position: relative !important;
    min-height: 38px !important;
    box-sizing: border-box !important;
}
${selectors(" > *")} {
    display: none !important;
}
${selectors("::after")} {
    content: "[CENSORED USER]  [MESSAGE REDACTED]" !important;
    display: block !important;
    width: fit-content !important;
    max-width: calc(100% - 60px) !important;
    margin: 4px 0 4px 54px !important;
    padding: 7px 10px !important;
    border-radius: 4px !important;
    background: var(--background-secondary, var(--background-base-lower, #222)) !important;
    color: var(--text-muted, #a8a8a8) !important;
    font: 12px/1.4 var(--font-primary, sans-serif) !important;
    pointer-events: none !important;
}
`;
}

function toggleCensor(id: string): void {
    if (!SNOWFLAKE.test(id)) return;
    const ids = new Set(parseIds(settings.store.censoredUserIds));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    settings.store.censoredUserIds = [...ids].join(", ");
    refreshStyles();
}

const addCensorToggle: NavContextMenuPatchCallback = (children, props: { user?: User; message?: Message; }) => {
    const id = (props?.user ?? props?.message?.author)?.id;
    if (!id || !SNOWFLAKE.test(id)) return;

    children.push(
        <Menu.MenuCheckboxItem
            id="vc-censor-user-toggle"
            key="vc-censor-user-toggle"
            label="Censor User"
            checked={isCensored(id)}
            action={() => toggleCensor(id)}
        />
    );
};

export default definePlugin({
    name: "CensorUser",
    description: "Locally redact messages from selected Discord users. Toggle from the user context menu.",
    authors: [{ name: "Kooraseru", id: 0n }],
    tags: ["Chat", "Privacy"],
    settings,
    contextMenus: {
        "user-context": addCensorToggle,
        "message": addCensorToggle
    },
    patches: [
        {
            // Match the same message-row prop location used by Vencord's
            // ThemeAttributes plugin, while keeping our own data attribute.
            find: "Message must not be a thread starter message",
            replacement: {
                match: /"aria-setsize":-1,(?=.{0,150}?#{intl::MESSAGE_A11Y_ROLE_DESCRIPTION})/,
                replace: "...$self.getMessageProps(arguments[0]),$&"
            }
        }
    ],
    getMessageProps(props: { message?: Message; }) {
        return { [AUTHOR_ATTRIBUTE]: props?.message?.author?.id };
    },
    start() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }
        refreshStyles();
    },
    stop() {
        document.getElementById(STYLE_ID)?.remove();
    }
});
