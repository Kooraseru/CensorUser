/*
 * CensorUser – reversible, local identity masking for Discord.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addGlobalContextMenuPatch, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, User } from "@vencord/discord-types";
import { Menu } from "@webpack/common";
import type { ReactElement } from "react";

const STYLE_ID = "vc-censor-user-style";
const AUTHOR_ATTRIBUTE = "data-vc-censor-author";
const SNOWFLAKE = /^\d{15,22}$/;

function parseIds(value: string): string[] {
    return [...new Set(value.split(/[\s,;]+/).filter(id => SNOWFLAKE.test(id)))];
}

const settings = definePluginSettings({
    censoredUserIds: {
        type: OptionType.STRING,
        description: "Discord user IDs whose identities should be masked locally. Message text remains readable.",
        default: "",
        multiline: true,
        onChange: () => refreshStyles()
    }
});

function isCensored(id: string | undefined): boolean {
    return Boolean(id && parseIds(settings.store.censoredUserIds).includes(id));
}

function toggleCensor(id: string): void {
    if (!SNOWFLAKE.test(id)) return;
    const ids = new Set(parseIds(settings.store.censoredUserIds));
    if (ids.has(id)) ids.delete(id);
    else ids.add(id);
    settings.store.censoredUserIds = [...ids].join(", ");
    refreshStyles();
}

/**
 * Apply visual identity masking to message headers only. The message body,
 * attachments, embeds, reactions, and links remain rendered normally.
 * This is not a security boundary or full-profile anonymizer.
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
    const names = rows.flatMap(row => [
        `${row} [class*="username_"]`,
        `${row} [class*="username-"]`,
        `${row} [class*="headerText_"] [class*="username"]`,
        `${row} [class*="headerText-"] [class*="username"]`
    ]).join(",\n");
    const avatars = rows.flatMap(row => [
        `${row} [class*="avatar_"] img`,
        `${row} [class*="avatar-"] img`,
        `${row} img[class*="avatar"]`,
        `${row} [class*="avatarDecoration"]`,
        `${row} [class*="avatarDecoration"] img`
    ]).join(",\n");

    style.textContent = `
/* Keep the username's layout, but make its contents illegible. */
${names} {
    color: transparent !important;
    background: #000 !important;
    border-radius: 2px !important;
    text-shadow: none !important;
    -webkit-text-fill-color: transparent !important;
    user-select: none !important;
}
/* Remove identifying avatar imagery and decorations without collapsing layout. */
${avatars} {
    opacity: 0 !important;
}
${rows.map(row => `${row} [class*="avatar_"], ${row} [class*="avatar-"]`).join(",\n")} {
    background: #000 !important;
    border-radius: 50% !important;
}
`;
}

/** Global patch covers profile overflow menus with different nav IDs. */
function patchUserMenu(navId: string, children: Array<ReactElement<any> | null>, ...args: any[]): void {
    if (!/user|profile|message/i.test(navId)) return;

    let id: string | undefined;
    for (const arg of args) {
        id = arg?.user?.id ?? arg?.message?.author?.id ?? arg?.targetUser?.id;
        if (id && SNOWFLAKE.test(id)) break;
    }
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
}

export default definePlugin({
    name: "CensorUser",
    description: "Hide selected users' identities while preserving their messages.",
    authors: [{ name: "Kooraseru", id: 0n }],
    tags: ["Chat", "Privacy"],
    settings,
    patches: [
        {
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
        addGlobalContextMenuPatch(patchUserMenu);
        refreshStyles();
    },
    stop() {
        removeGlobalContextMenuPatch(patchUserMenu);
        document.getElementById(STYLE_ID)?.remove();
    }
});
