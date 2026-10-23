/*
 * CensorUser – local identity masking without hiding conversation content.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addGlobalContextMenuPatch, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Message } from "@vencord/discord-types";
import { ChannelStore, Menu, SelectedChannelStore } from "@webpack/common";
import type { ReactElement } from "react";

const AUTHOR_ATTRIBUTE = "data-vc-censor-author";
const ACTIVE_ATTRIBUTE = "data-vc-censor-active";
const STYLE_ID = "vc-censor-user-style";
const SNOWFLAKE = /^\d{15,22}$/;

let observer: MutationObserver | undefined;
let updateQueued = false;

function ids(): Set<string> {
    return new Set(settings.store.censoredUserIds.split(/[\s,;]+/).filter(id => SNOWFLAKE.test(id)));
}

const settings = definePluginSettings({
    censoredUserIds: {
        type: OptionType.STRING,
        description: "Discord user IDs to anonymize. Messages remain readable; identity hiding is visual only.",
        default: "",
        multiline: true,
        onChange: () => refresh()
    }
});

function isCensored(id: string | undefined): boolean {
    return Boolean(id && ids().has(id));
}

function toggleCensor(id: string): void {
    if (!SNOWFLAKE.test(id)) return;
    const current = ids();
    if (current.has(id)) current.delete(id);
    else current.add(id);
    settings.store.censoredUserIds = Array.from(current).join(", ");
    refresh();
}

/**
 * Tag identity components rather than hiding all children of a message row.
 * The content, attachments, embeds, timestamps, and reactions stay intact.
 */
function markMessage(row: HTMLElement, enabled: boolean): void {
    row.toggleAttribute(ACTIVE_ATTRIBUTE, enabled);
    if (!enabled) return;

    const header = row.querySelector<HTMLElement>("h3");
    if (header) {
        const name = header.querySelector<HTMLElement>(
            '[class*="headerText"], [class*="username"]'
        );
        name?.setAttribute("data-vc-censor-name", "");

        // Discord may place identity tags outside the username wrapper.
        header.querySelectorAll<HTMLElement>(
            '[class*="clanTag"], [class*="guildTag"], [class*="botTag"], ' +
            '[class*="roleIcon"], [class*="nameplate"], [class*="badge"]'
        ).forEach(node => node.setAttribute("data-vc-censor-extra", ""));
    }

    // Only the first avatar belongs to the message author; later ones can
    // belong to embeds, attachments, or linked content.
    const avatar = row.querySelector<HTMLElement>(
        'img[class*="avatar"], svg[class*="avatar"], [class*="avatar"] img'
    );
    const avatarRoot = avatar?.closest<HTMLElement>(
        'a[class*="avatar"], div[class*="avatar"], span[class*="avatar"]'
    ) ?? avatar;
    avatarRoot?.setAttribute("data-vc-censor-avatar", "");

    row.querySelectorAll<HTMLElement>(
        '[class*="avatarDecoration"], [class*="avatarAdornment"], [class*="avatarOverlay"]'
    ).forEach(node => node.setAttribute("data-vc-censor-extra", ""));
}

/** Only a one-to-one DM may be associated with a single user identity. */
function isSelectedCensoredDM(censored: Set<string>): boolean {
    try {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        return Boolean(channel && channel.type === 1 &&
            channel.recipients?.some((id: string) => censored.has(id)));
    } catch {
        return false;
    }
}

function updateDom(): void {
    const censored = ids();
    for (const row of document.querySelectorAll<HTMLElement>('li[data-vc-censor-author]')) {
        const id = row.getAttribute(AUTHOR_ATTRIBUTE) ?? "";
        markMessage(row, censored.has(id));
    }
    document.body.toggleAttribute("data-vc-censor-selected-dm", isSelectedCensoredDM(censored));
}

function refresh(): void {
    updateDom();
}

function scheduleUpdate(): void {
    if (updateQueued) return;
    updateQueued = true;
    queueMicrotask(() => {
        updateQueued = false;
        updateDom();
    });
}

/** Prevent clicking author name/avatar from opening a censored user profile. */
function preventProfileClick(event: MouseEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('li[data-vc-censor-active]');
    if (!row) return;

    // Do not interfere with message bodies, attachments or context menus.
    if (!event.target.closest('h3, [data-vc-censor-avatar], [class*="avatar"]')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
}

/** Also supports overflow profile menus whose identifiers change by context. */
function patchUserMenu(navId: string, children: Array<ReactElement<any> | null>, ...args: any[]): void {
    if (!/user|profile|message/i.test(navId)) return;
    const userId = args.map(arg => arg?.user?.id ?? arg?.message?.author?.id ?? arg?.targetUser?.id)
        .find(id => typeof id === "string" && SNOWFLAKE.test(id)) as string | undefined;
    if (!userId) return;

    // Use Vencord's native checked menu control. The same user ID is
    // evaluated whenever the menu is opened, including after restarting.
    children.push(
        <Menu.MenuCheckboxItem
            id="vc-censor-user-toggle"
            key="vc-censor-user-toggle"
            label="Censor User"
            checked={isCensored(userId)}
            action={() => toggleCensor(userId)}
        />
    );
}

const CSS = [
    'li[data-vc-censor-active] [data-vc-censor-name] {',
    '    display: inline-flex !important;',
    '    align-items: center !important;',
    '    width: 88px !important;',
    '    min-width: 88px !important;',
    '    min-height: 16px !important;',
    '    max-height: 16px !important;',
    '    overflow: hidden !important;',
    '    border-radius: 2px !important;',
    '    background: #000 !important;',
    '    color: transparent !important;',
    '    -webkit-text-fill-color: transparent !important;',
    '    text-shadow: none !important;',
    '    font-size: 0 !important;',
    '    user-select: none !important;',
    '    pointer-events: none !important;',
    '}',
    'li[data-vc-censor-active] [data-vc-censor-name] * { visibility: hidden !important; }',
    'li[data-vc-censor-active] [data-vc-censor-extra] { display: none !important; }',
    'li[data-vc-censor-active] [data-vc-censor-avatar] {',
    '    background: #000 !important;',
    '    filter: brightness(0) !important;',
    '    border-radius: 50% !important;',
    '    pointer-events: none !important;',
    '}',
    'body[data-vc-censor-selected-dm] [class*="profilePanel"],',
    'body[data-vc-censor-selected-dm] [class*="profileSidebar"] {',
    '    display: none !important;',
    '}'
].join("\n");

export default definePlugin({
    name: "CensorUser",
    description: "Mask user identities across message histories while keeping messages readable.",
    authors: [{ name: "Kooraseru", id: 0n }],
    tags: ["Chat", "Privacy"],
    settings,
    patches: [
        {
            // This patch was confirmed to tag real <li> message rows in Discord.
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
            style.textContent = CSS;
            document.head.appendChild(style);
        }
        addGlobalContextMenuPatch(patchUserMenu);
        document.addEventListener("click", preventProfileClick, true);
        observer = new MutationObserver(scheduleUpdate);
        observer.observe(document.body, { childList: true, subtree: true });
        refresh();
    },
    stop() {
        observer?.disconnect();
        observer = undefined;
        removeGlobalContextMenuPatch(patchUserMenu);
        document.removeEventListener("click", preventProfileClick, true);
        document.querySelectorAll<HTMLElement>('li[data-vc-censor-active]')
            .forEach(row => row.removeAttribute(ACTIVE_ATTRIBUTE));
        document.body.removeAttribute("data-vc-censor-selected-dm");
        document.getElementById(STYLE_ID)?.remove();
    }
});
