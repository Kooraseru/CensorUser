/*
 * CensorUser – local identity masking without hiding conversation content.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addGlobalContextMenuPatch, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, User } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageStore, ReferencedMessageStore, SelectedChannelStore } from "@webpack/common";
import type { ReactElement } from "react";

const AUTHOR_ATTRIBUTE = "data-vc-censor-author";
const ACTIVE_ATTRIBUTE = "data-vc-censor-active";
const STYLE_ID = "vc-censor-user-style";
const MEMBER_ATTRIBUTE = "data-vc-censor-member";
const PROFILE_ATTRIBUTE = "data-vc-censor-profile-user";
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
            '[class*="roleIcon"], [class*="nameplate"], [class*="badge"], [class*="chiplet"]'
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


/** Resolve the author of a reply through the referenced message, never the displayed text. */
function referencedAuthor(row: HTMLElement): User | undefined {
    try {
        const match = row.id.match(/(?:^|chat-messages-)(\d{15,22})-(\d{15,22})$/);
        if (!match) return;
        const message = MessageStore?.getMessage(match[1], match[2]);
        const ref = message?.messageReference;
        if (!ref) return;
        const original = ReferencedMessageStore?.getMessageByReference(ref)?.message
            ?? ReferencedMessageStore?.getMessage(ref.channel_id, ref.message_id)?.message
            ?? MessageStore?.getMessage(ref.channel_id, ref.message_id);
        return original?.author;
    } catch {
        // A missing/evicted reply must not interrupt masking other messages.
        return;
    }
}

/** Only mask the reply's identity components; leave its quoted message intact. */
function markReply(row: HTMLElement, censored: Set<string>): void {
    const reply = row.querySelector<HTMLElement>('[class*="repliedMessage"], [class*="replyPreview"]');
    if (!reply) return;
    const author = referencedAuthor(row);
    const active = !!author?.id && censored.has(author.id);
    reply.toggleAttribute("data-vc-censor-reply", active);
    if (!active || !author) return;
    const names = new Set([author.username, author.globalName].filter(
        (name): name is string => typeof name === "string" && !!name
    ));
    const name = reply.querySelector<HTMLElement>(
        '[class*="username"], [class*="replyAuthor"], [class*="repliedAuthor"]'
    ) ?? Array.from(reply.querySelectorAll<HTMLElement>("span, strong")).find(node =>
        node.children.length === 0 && names.has((node.textContent ?? "").replace(/^@/, "").trim())
    );
    name?.setAttribute("data-vc-censor-reply-name", "");
    reply.querySelector<HTMLElement>(
        'img[class*="avatar"], [class*="avatar"] img, [class*="repliedAvatar"]'
    )?.setAttribute("data-vc-censor-reply-avatar", "");
    reply.querySelectorAll<HTMLElement>(
        '[class*="clanTag"], [class*="guildTag"], [class*="badge"], ' +
        '[class*="roleIcon"], [class*="avatarDecoration"], [class*="nameplate"], [class*="chiplet"]'
    ).forEach(el => el.setAttribute("data-vc-censor-reply-extra", ""));
}

/** MemberListDecoratorsAPI supplies the actual User ID for each member row. */
function markMemberRows(censored: Set<string>): void {
    for (const marker of document.querySelectorAll<HTMLElement>('[data-vc-censor-member]')) {
        const row = marker.closest<HTMLElement>('[data-list-item-id]')
            ?? marker.closest<HTMLElement>(
                '[role="listitem"], [class*="member_"][class*="container"], ' +
                '[class*="member-"], [class*="member_"]'
            );
        if (!row) continue;
        row.toggleAttribute("data-vc-censor-member-active",
            censored.has(marker.getAttribute(MEMBER_ATTRIBUTE) ?? ""));
    }
}

/** Mark popout or sidebar roots using a User prop inserted by Vencord patches. */
function markProfiles(censored: Set<string>): void {
    for (const marker of document.querySelectorAll<HTMLElement>('[data-vc-censor-profile-user]')) {
        const id = marker.getAttribute(PROFILE_ATTRIBUTE) ?? "";
        let ancestor: HTMLElement | null = marker.parentElement;
        let profile: HTMLElement | null = null;
        for (let depth = 0; ancestor && depth < 14; depth++, ancestor = ancestor.parentElement) {
            const cls = typeof ancestor.className === "string" ? ancestor.className : "";
            if (/userPopout|userProfileOuter|profilePanel|profileSidebar|userProfileModal/i.test(cls)
                || ancestor.getAttribute("role") === "dialog") profile = ancestor;
            if (ancestor === document.body) break;
        }
        profile?.toggleAttribute("data-vc-censor-profile-active", censored.has(id));
    }
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
        markReply(row, censored);
    }
    markMemberRows(censored);
    markProfiles(censored);
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
    const member = event.target.closest<HTMLElement>('[data-vc-censor-member-active]');
    const replyName = event.target.closest<HTMLElement>('[data-vc-censor-reply-name]');
    if (!member && !replyName &&
        !(row && event.target.closest('h3, [data-vc-censor-avatar]'))) return;
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


const EXTRA_CSS = [
    '[data-vc-censor-reply] [data-vc-censor-reply-name] {',
    '    display: inline-flex !important;',
    '    width: 88px !important; min-width: 88px !important;',
    '    height: 16px !important; max-height: 16px !important;',
    '    overflow: hidden !important; font-size: 0 !important;',
    '    color: transparent !important; -webkit-text-fill-color: transparent !important;',
    '    background: #000 !important; border-radius: 2px !important;',
    '    user-select: none !important; text-shadow: none !important;',
    '}',
    '[data-vc-censor-reply] [data-vc-censor-reply-name] * { visibility: hidden !important; }',
    '[data-vc-censor-reply] [data-vc-censor-reply-extra] { display: none !important; }',
    '[data-vc-censor-reply] [data-vc-censor-reply-avatar] {',
    '    filter: brightness(0) !important; background: #000 !important;',
    '    border-radius: 50% !important;',
    '}',
    '[data-vc-censor-member-active] { position: relative !important; }',
    '[data-vc-censor-member-active] > * { opacity: 0 !important; }',
    '[data-vc-censor-member-active]::before,',
    '[data-vc-censor-member-active]::after {',
    '    content: "" !important; position: absolute !important;',
    '    display: block !important; background: #000 !important;',
    '    pointer-events: none !important; z-index: 4 !important;',
    '}',
    '[data-vc-censor-member-active]::before {',
    '    width: 32px !important; height: 32px !important;',
    '    border-radius: 50% !important;',
    '    left: 10px !important; top: 50% !important;',
    '    transform: translateY(-50%) !important;',
    '}',
    '[data-vc-censor-member-active]::after {',
    '    width: 90px !important; height: 16px !important;',
    '    border-radius: 2px !important;',
    '    left: 52px !important; top: 50% !important;',
    '    transform: translateY(-50%) !important;',
    '}',
    '[data-vc-censor-profile-active] { display: none !important; }'
].join("\n");

export default definePlugin({
    name: "CensorUser",
    description: "Mask user identities across message histories while keeping messages readable.",
    authors: [{ name: "Kooraseru", id: 0n }],
    tags: ["Chat", "Privacy"],
    settings,
    dependencies: ["MemberListDecoratorsAPI"],
    patches: [
        {
            // Confirmed at runtime to tag each message <li>.
            find: "Message must not be a thread starter message",
            replacement: {
                match: /"aria-setsize":-1,(?=.{0,150}?#{intl::MESSAGE_A11Y_ROLE_DESCRIPTION})/,
                replace: "...$self.getMessageProps(arguments[0]),$&"
            }
        },
        {
            // Profile popout widgets expose the owning User.
            find: '"UserProfilePopout");',
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),/,
                replace: "$&$self.profileMarker({user:$1}),"
            }
        },
        {
            // Profile sidebar has a separate widget renderer.
            find: ".SIDEBAR,disableToolbar:",
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),(?=.{0,100}unownedWishlistItems:\i,wishlistId:\i)/,
                replace: "$&$self.profileMarker({user:$1}),"
            }
        }
    ],
    getMessageProps(props: { message?: Message; }) {
        return { [AUTHOR_ATTRIBUTE]: props?.message?.author?.id };
    },
    profileMarker({ user }: { user?: User; }) {
        return user ? <span data-vc-censor-profile-user={user.id} hidden /> : null;
    },
    renderMemberListDecorator({ user }: { user: User; }) {
        return <span data-vc-censor-member={user.id} hidden />;
    },
    start() {
        if (!document.getElementById(STYLE_ID)) {
            const style = document.createElement("style");
            style.id = STYLE_ID;
            style.textContent = CSS + "\n" + EXTRA_CSS;
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
        document.querySelectorAll<HTMLElement>(
            'li[data-vc-censor-active], [data-vc-censor-member-active], [data-vc-censor-profile-active]'
        ).forEach(el => {
            el.removeAttribute(ACTIVE_ATTRIBUTE);
            el.removeAttribute("data-vc-censor-member-active");
            el.removeAttribute("data-vc-censor-profile-active");
        });
        document.querySelectorAll<HTMLElement>('[data-vc-censor-reply]')
            .forEach(el => el.removeAttribute("data-vc-censor-reply"));
        document.body.removeAttribute("data-vc-censor-selected-dm");
        document.getElementById(STYLE_ID)?.remove();
    }
});
