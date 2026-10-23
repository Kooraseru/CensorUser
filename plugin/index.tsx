/*
 * CensorUser – reversible, client-side substitution of Discord identity fields.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addGlobalContextMenuPatch, removeGlobalContextMenuPatch } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import type { Message, User } from "@vencord/discord-types";
import { ChannelStore, Menu, MessageStore, ReferencedMessageStore, SelectedChannelStore, UserStore } from "@webpack/common";
import type { ReactElement } from "react";

const SNOWFLAKE = /^\d{15,22}$/;
const ROW_ATTR = "data-vc-censor-author";
const MEMBER_ATTR = "data-vc-censor-member";
const PROFILE_ATTR = "data-vc-censor-profile-user";
const REPLACEMENT_NAME = "████████";
const AVATAR_SOURCE = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="black"/></svg>'
);

interface SavedText { original: string; replacement: string; }
interface SavedAttribute { original: string | null; replacement: string | null; }
interface SavedStyle { original: string; priority: string; }

// Replacements are kept in memory, not applied to Discord's message or user stores.
// Each setting change restores every original field before making new substitutions.
const texts = new Map<Text, SavedText>();
const attributes = new Map<Element, Map<string, SavedAttribute>>();
const hidden = new Map<HTMLElement, SavedStyle>();
let observer: MutationObserver | undefined;
let pending = false;
let running = false;
const profileOwners = new Map<HTMLElement, string>();

const settings = definePluginSettings({
    censoredUserIds: {
        type: OptionType.STRING,
        description: "Discord user IDs to anonymize on this client. Does not change message contents or Discord servers.",
        default: "",
        multiline: true,
        onChange: refresh
    }
});

function censoredIds(): Set<string> {
    return new Set(settings.store.censoredUserIds.split(/[\s,;]+/).filter(id => SNOWFLAKE.test(id)));
}

function isCensored(id: string | undefined): boolean {
    return !!id && censoredIds().has(id);
}

function toggleCensor(id: string, fromProfileMenu = false): void {
    if (!SNOWFLAKE.test(id)) return;
    const next = censoredIds();
    if (next.has(id)) next.delete(id);
    else next.add(id);
    settings.store.censoredUserIds = [...next].join(", ");
    if (fromProfileMenu) associateOpenProfile(id);
    refresh();
}

/** Update a real DOM text node, rather than drawing a bar over text. */
function putText(node: Text, replacement: string, seen: Set<Text>): void {
    seen.add(node);
    const saved = texts.get(node);
    if (!saved) texts.set(node, { original: node.data, replacement });
    else {
        if (node.data !== saved.replacement) saved.original = node.data; // React updated the field.
        saved.replacement = replacement;
    }
    if (node.data !== replacement) node.data = replacement;
}

/** Preserve a node's original attributes for uncensoring. */
function putAttribute(node: Element, key: string, value: string | null, seen: Map<Element, Set<string>>): void {
    if (!seen.has(node)) seen.set(node, new Set());
    seen.get(node)!.add(key);
    let map = attributes.get(node);
    if (!map) attributes.set(node, map = new Map());
    const existing = map.get(key);
    if (!existing) map.set(key, { original: node.getAttribute(key), replacement: value });
    else {
        if (node.getAttribute(key) !== existing.replacement) existing.original = node.getAttribute(key);
        existing.replacement = value;
    }
    if (value === null) {
        if (node.hasAttribute(key)) node.removeAttribute(key);
    } else if (node.getAttribute(key) !== value) node.setAttribute(key, value);
}

/** Used only to *remove* decorations, cosmetics, profiles' personal sections, and activity. */
function removePresentation(node: HTMLElement, seen: Set<HTMLElement>): void {
    seen.add(node);
    if (!hidden.has(node)) {
        hidden.set(node, {
            original: node.style.getPropertyValue("display"),
            priority: node.style.getPropertyPriority("display")
        });
    }
    if (node.style.getPropertyValue("display") !== "none" || node.style.getPropertyPriority("display") !== "important") {
        node.style.setProperty("display", "none", "important");
    }
}

interface Changes {
    text: Set<Text>;
    attributes: Map<Element, Set<string>>;
    hidden: Set<HTMLElement>;
}

function redactName(element: Element | null, changes: Changes): void {
    if (!element) return;
    // Style the substituted block glyphs themselves, never an overlay.
    putAttribute(element, "data-vc-censor-replaced-name", "", changes.attributes);
    replaceAccessibilityLabels(element, changes);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let first = true;
    while ((node = walker.nextNode())) {
        const text = node as Text;
        // Retain formatting elements and event handlers; only substitute values.
        if (!text.data.trim() && !texts.has(text)) continue;
        putText(text, first ? REPLACEMENT_NAME : "", changes.text);
        first = false;
    }
}

/** Replace identifying labels used by tooltips and assistive technology. */
function replaceAccessibilityLabels(element: Element, changes: Changes): void {
    const nodes = [element, ...Array.from(element.querySelectorAll("[title], [aria-label], [alt]"))];
    for (const node of nodes) {
        if (node.closest("button") && !node.closest('[data-vc-censor-replaced-name]')) continue;
        for (const key of ["title", "aria-label", "alt"]) {
            if (node.hasAttribute(key)) putAttribute(node, key, "Censored User", changes.attributes);
        }
    }
}

function clearPersonalText(element: Element, changes: Changes, keepControls = false): void {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const text = node as Text;
        if (!text.data.trim() && !texts.has(text)) continue;
        const parent = text.parentElement;
        if (keepControls && parent?.closest("button, [role='button']")) {
            // Leave standard controls navigable. User-chosen fields never become controls.
            const label = (texts.get(text)?.original ?? text.data).trim();
            if (/^(?:view full profile|message|call|video|add friend|remove friend|share profile|more|close|censor user)$/i.test(label)) continue;
        }
        putText(text, "", changes.text);
    }
    replaceAccessibilityLabels(element, changes);
}

function replaceAvatar(image: HTMLImageElement, changes: Changes): void {
    putAttribute(image, "src", AVATAR_SOURCE, changes.attributes);
    putAttribute(image, "srcset", null, changes.attributes);
    putAttribute(image, "alt", "Censored User", changes.attributes);
    putAttribute(image, "title", null, changes.attributes);
    putAttribute(image, "data-vc-censor-replaced-avatar", "", changes.attributes);
}

function replaceAvatarIn(container: Element, changes: Changes, preferred?: string): void {
    const images = Array.from(container.querySelectorAll<HTMLImageElement>("img"));
    // Never substitute an unrelated icon or embedded image just because it is first.
    const image = images.find(img => preferred && urlBelongsTo(img.getAttribute("src") ?? "", preferred))
        ?? images.find(img => img.closest('[class*="avatar"], [class*="Avatar"]'));
    if (image) replaceAvatar(image, changes);
}

function stripDecorations(element: Element, changes: Changes): void {
    element.querySelectorAll<HTMLElement>(
        '[class*="avatarDecoration"], [class*="avatarAdornment"], [class*="avatarOverlay"], ' +
        '[class*="profileEffect"], [class*="nameplate"], [class*="collectible"], ' +
        '[class*="clanTag"], [class*="guildTag"], [class*="botTag"], [class*="badge"], ' +
        '[class*="roleIcon"], [class*="chiplet"], [class*="primaryGuild"], [class*="profileBadge"]'
    ).forEach(node => removePresentation(node, changes.hidden));
}

/** The author header is separate from the actual message content. */
function redactMessage(row: HTMLElement, userId: string, changes: Changes): void {
    const header = row.querySelector<HTMLElement>("h3");
    if (header) {
        const name = header.querySelector<HTMLElement>('[class*="username"], [class*="userName"]')
            ?? header.querySelector<HTMLElement>('[class*="headerText"]');
        redactName(name, changes);
        stripDecorations(header, changes);

        // Discord can put custom server tags beside the username in its header.
        if (name) {
            let sibling = name.nextElementSibling;
            while (sibling) {
                const next = sibling.nextElementSibling;
                if (!/timestamp|time/i.test(sibling.className || "")) {
                    if (sibling instanceof HTMLElement) removePresentation(sibling, changes.hidden);
                }
                sibling = next;
            }
        }
    }
    const avatars = Array.from(row.querySelectorAll<HTMLImageElement>("img"))
        .filter(img => !img.closest('[class*="repliedMessage"], [class*="replyPreview"], [class*="messageContent"], [class*="attachment"]'));
    const avatar = avatars.find(img => urlBelongsTo(img.getAttribute("src") ?? "", userId))
        ?? avatars.find(img => img.closest('[class*="avatar"], [class*="Avatar"]'));
    if (avatar) replaceAvatar(avatar, changes);
    // No other part of the message row is hidden or rewritten.
}

/** Reference IDs come from the message store, not the appearance of the reply. */
function replyAuthorId(row: HTMLElement): string | undefined {
    try {
        const match = row.id.match(/(?:^|chat-messages-)(\d{15,22})-(\d{15,22})$/);
        if (!match) return;
        const ref = MessageStore?.getMessage(match[1], match[2])?.messageReference;
        if (!ref) return;
        const original = ReferencedMessageStore?.getMessageByReference(ref)?.message
            ?? ReferencedMessageStore?.getMessage(ref.channel_id, ref.message_id)?.message
            ?? MessageStore?.getMessage(ref.channel_id, ref.message_id);
        return original?.author?.id;
    } catch { return; }
}

function redactReply(row: HTMLElement, ids: Set<string>, changes: Changes): void {
    const authorId = replyAuthorId(row);
    if (!authorId || !ids.has(authorId)) return;
    const reply = row.querySelector<HTMLElement>('[class*="repliedMessage"], [class*="replyPreview"]');
    if (!reply) return;
    const author = UserStore.getUser(authorId);
    const names = new Set([author?.username, author?.globalName].filter(Boolean));
    let authorNode: Element | null = reply.querySelector('[class*="username"], [class*="replyAuthor"], [class*="repliedAuthor"]');
    if (!authorNode) {
        authorNode = Array.from(reply.querySelectorAll("span, strong")).find(node =>
            node.children.length === 0 && names.has((node.textContent ?? "").trim().replace(/^@/, ""))
        ) ?? null;
    }
    redactName(authorNode, changes);
    const authorAvatar = Array.from(reply.querySelectorAll<HTMLImageElement>("img"))
        .find(img => urlBelongsTo(img.getAttribute("src") ?? "", authorId))
        ?? reply.querySelector<HTMLImageElement>('[class*="repliedAvatar"] img, img[class*="avatar"]');
    if (authorAvatar) replaceAvatar(authorAvatar, changes);
    stripDecorations(reply, changes);
    const tag = author?.primaryGuild?.tag;
    if (tag) {
        const walker = document.createTreeWalker(reply, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
            if ((node as Text).data.trim() !== tag) continue;
            const parent = (node as Text).parentElement;
            if (parent?.closest('[class*="tag"], [class*="Tag"], [class*="chiplet"]')) {
                putText(node as Text, "", changes.text);
            }
        }
    }
    // Do not redact the quote/snippet. It belongs to the message, not its identity.
}

/** A user ID is embedded in most custom Discord avatar URLs, without relying on display names. */
function urlBelongsTo(url: string, userId: string): boolean {
    return url.includes(`/avatars/${userId}/`) || url.includes(`/users/${userId}/avatars/`)
        || url.includes(`/guilds/`) && url.includes(`/users/${userId}/avatars/`);
}

function findMemberRow(anchor: HTMLElement): HTMLElement | null {
    return anchor.closest<HTMLElement>('[data-list-item-id]')
        ?? anchor.closest<HTMLElement>('[role="listitem"], [class*="member_"], [class*="member-"]');
}

function redactMember(row: HTMLElement, userId: string, changes: Changes): void {
    // Scope the replacements to this one member entry. Its click/context handlers remain intact.
    replaceAvatarIn(row, changes, userId);
    clearPersonalText(row, changes);
    const name = row.querySelector<HTMLElement>(
        '[class*="memberName"], [class*="username"], [class*="name_"], [class*="name-"]'
    );
    redactName(name, changes);
    stripDecorations(row, changes);
    for (const img of row.querySelectorAll<HTMLImageElement>("img")) {
        if (img.getAttribute("src") === AVATAR_SOURCE || img.closest("button, [role='button']")) continue;
        removePresentation(img, changes.hidden); // statuses, badges, decorations
    }
    for (const svg of row.querySelectorAll<SVGElement>("svg")) {
        if (svg.closest("button, [role='button']")) continue;
        removePresentation(svg as unknown as HTMLElement, changes.hidden);
    }
}

/** The active overflow menu is anchored to an existing, usable profile. */
function associateOpenProfile(userId: string): void {
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
        '[class*="userPopoutOuter"], [class*="userProfileOuter"], ' +
        '[class*="profileModal"], [class*="userProfileModal"]'
    )).filter(node => node.getClientRects().length > 0);
    const candidate = candidates.find(node => Array.from(node.querySelectorAll("img"))
        .some(img => urlBelongsTo(img.getAttribute("src") ?? "", userId)))
        ?? (candidates.length === 1 ? candidates[0] : null);
    if (candidate) profileOwners.set(candidate, userId);
}

function locateProfileRoot(element: Element): HTMLElement | null {
    let node: HTMLElement | null = element.parentElement;
    let found: HTMLElement | null = null;
    for (let i = 0; node && i < 22 && node !== document.body; i++, node = node.parentElement) {
        const cls = typeof node.className === "string" ? node.className : "";
        if (/userPopout|userProfileOuter|profilePanel|profileSidebar|userProfileModal|profileModal/i.test(cls)
            || node.getAttribute("role") === "dialog") found = node;
    }
    return found;
}

function redactProfile(root: HTMLElement, userId: string, changes: Changes): void {
    replaceAvatarIn(root, changes, userId);
    clearPersonalText(root, changes, true);
    const displayName = root.querySelector<HTMLElement>(
        '[class*="nickname"], [class*="displayName"], [class*="userName"], [class*="username"]'
    );
    redactName(displayName, changes);
    // Remove all cosmetics, user-selected styling, free-text fields, and activity.
    const privateSections =
        '[class*="profileEffect"], [class*="banner"], [class*="activity"], ' +
        '[class*="Activity"], [class*="customStatus"], [class*="pronouns"], ' +
        '[class*="bio"], [class*="aboutMe"], [class*="connectedAccount"], ' +
        '[class*="gameCollection"], [class*="wishlist"], [class*="mutual"], ' +
        '[class*="nameplate"], [class*="profileBadge"], [class*="guildTag"], ' +
        '[class*="clanTag"], [class*="avatarDecoration"], [class*="profileTheme"]';
    root.querySelectorAll<HTMLElement>(privateSections).forEach(node => removePresentation(node, changes.hidden));
    stripDecorations(root, changes);
    root.querySelectorAll<HTMLImageElement>("img").forEach(img => {
        if (img.getAttribute("src") !== AVATAR_SOURCE) removePresentation(img, changes.hidden);
    });
    root.querySelectorAll<HTMLElement>('a[href^="http"]').forEach(node => removePresentation(node, changes.hidden));
    const avatar = Array.from(root.querySelectorAll<HTMLImageElement>("img"))
        .find(img => img.getAttribute("src") === AVATAR_SOURCE);
    root.querySelectorAll<HTMLElement>('[style*="background-image"]').forEach(node => {
        // The black avatar image is retained. Decorative banners/effects are not.
        if (!avatar || !node.contains(avatar)) removePresentation(node, changes.hidden);
    });
}

/** Detect profile component reuse before applying previously cached ownership. */
function updatedProfileOwner(root: HTMLElement, cachedId: string): string {
    const image = root.querySelector<HTMLImageElement>(
        'img[class*="avatar"], img[class*="Avatar"], [class*="avatar"] img'
    );
    const src = image?.getAttribute("src") ?? "";
    const match = src.match(/\/avatars\/(\d{15,22})\//)
        ?? src.match(/\/users\/(\d{15,22})\/avatars\//);
    return match?.[1] ?? cachedId;
}

function selectedDMUserId(): string | undefined {
    try {
        const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        return channel?.type === 1 ? channel?.recipients?.[0] : undefined;
    } catch { return; }
}

/** Reconcile all currently displayed identity surfaces for the selected user IDs. */
function reconcile(): void {
    if (running || !document.body) return;
    running = true;
    // Do not recursively trigger ourselves through the MutationObserver.
    observer?.disconnect();
    try {
        const changes: Changes = {
            text: new Set(),
            attributes: new Map(),
            hidden: new Set()
        };
        const current = censoredIds();
        if (current.size) {
            for (const row of document.querySelectorAll<HTMLElement>(`li[${ROW_ATTR}]`)) {
                const author = row.getAttribute(ROW_ATTR);
                if (author && current.has(author)) redactMessage(row, author, changes);
                redactReply(row, current, changes);
            }
            for (const marker of document.querySelectorAll<HTMLElement>(`[${MEMBER_ATTR}]`)) {
                const id = marker.getAttribute(MEMBER_ATTR);
                if (id && current.has(id)) {
                    const row = findMemberRow(marker);
                    if (row) redactMember(row, id, changes);
                }
            }
            // User IDs from profile render props take priority over the avatar fallback.
            for (const marker of document.querySelectorAll<HTMLElement>(`[${PROFILE_ATTR}]`)) {
                const id = marker.getAttribute(PROFILE_ATTR);
                const root = locateProfileRoot(marker);
                if (root && id) profileOwners.set(root, id);
            }
            // A profile marker might not exist in some Discord builds.
            // Match exact user IDs in avatar URLs, never matching someone's name.
            for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
                if (img.closest(`li[${ROW_ATTR}], [data-list-item-id], [role="listitem"]`)) continue;
                const id = [...current].find(id => urlBelongsTo(img.getAttribute("src") ?? "", id));
                if (!id) continue;
                const root = locateProfileRoot(img);
                if (root) profileOwners.set(root, id);
            }
            for (const [root, cachedId] of profileOwners) {
                if (!root.isConnected) { profileOwners.delete(root); continue; }
                const marker = root.querySelector<HTMLElement>(`[${PROFILE_ATTR}]`);
                const owner = marker?.getAttribute(PROFILE_ATTR) || updatedProfileOwner(root, cachedId);
                if (owner !== cachedId) profileOwners.set(root, owner);
                if (current.has(owner)) redactProfile(root, owner, changes);
            }
            // The active 1:1 DM header belongs to exactly one user.
            const dm = selectedDMUserId();
            if (dm && current.has(dm)) {
                const user = UserStore.getUser(dm);
                const names = new Set([user?.username, user?.globalName].filter(Boolean));
                const titles = Array.from(document.querySelectorAll<HTMLElement>(
                    'header [class*="title"], header [class*="Title"]'
                ));
                const title = titles.find(node => names.has((texts.get(node.firstChild as Text)?.original
                    ?? node.textContent ?? "").trim()));
                if (title) {
                    redactName(title, changes);
                    const header = title.closest("header");
                    if (header) replaceAvatarIn(header, changes, dm);
                }
            }
        }
        restoreUnused(changes);
    } finally {
        running = false;
        observer?.observe(document.body, {
            childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ["class", "src", "srcset", "style"]
        });
    }
}

function restoreUnused(changes: Changes): void {
    for (const [node, saved] of texts) {
        if (changes.text.has(node)) continue;
        if (node.data === saved.replacement) node.data = saved.original;
        texts.delete(node);
    }
    for (const [element, saved] of attributes) {
        for (const [key, original] of saved) {
            if (changes.attributes.get(element)?.has(key)) continue;
            if (element.getAttribute(key) === original.replacement) {
                if (original.original === null) element.removeAttribute(key);
                else element.setAttribute(key, original.original);
            }
            saved.delete(key);
        }
        if (!saved.size) attributes.delete(element);
    }
    for (const [element, saved] of hidden) {
        if (changes.hidden.has(element)) continue;
        if (element.style.getPropertyValue("display") === "none"
            && element.style.getPropertyPriority("display") === "important") {
            if (saved.original) element.style.setProperty("display", saved.original, saved.priority);
            else element.style.removeProperty("display");
        }
        hidden.delete(element);
    }
}

function refresh(): void { reconcile(); }
function schedule(): void {
    if (pending || running) return;
    pending = true;
    queueMicrotask(() => { pending = false; reconcile(); });
}

/** Leave right-click, left-click, and full-profile navigation untouched. */
function addUserToggle(navId: string, children: Array<ReactElement<any> | null>, ...args: any[]): void {
    if (!/user|profile|message/i.test(navId)) return;
    const id = args.map(arg => arg?.user?.id ?? arg?.message?.author?.id ?? arg?.targetUser?.id)
        .find(id => typeof id === "string" && SNOWFLAKE.test(id)) as string | undefined;
    if (!id) return;
    children.push(
        <Menu.MenuCheckboxItem
            id="vc-censor-user-toggle"
            key="vc-censor-user-toggle"
            label="Censor User"
            checked={isCensored(id)}
            action={() => toggleCensor(id, /profile/i.test(navId))}
        />
    );
}

// Color applies to replacement glyphs, not to an overlay covering the original text.
const STYLE_ID = "vc-censor-user-replacements";
const STYLE_TEXT = [
    '[data-vc-censor-replaced-name] {',
    '  color: #000 !important;',
    '  -webkit-text-fill-color: #000 !important;',
    '  text-shadow: none !important;',
    '  background: none !important;',
    '  font-family: sans-serif !important;',
    '  font-weight: 700 !important;',
    '  letter-spacing: -1px !important;',
    '}',
    '[data-vc-censor-replaced-avatar] {',
    '  border-radius: 50% !important;',
    '}',
].join("\n");

export default definePlugin({
    name: "CensorUser",
    description: "Replace identifying data locally while keeping messages and profiles functional.",
    authors: [{ name: "Kooraseru", id: 0n }],
    tags: ["Chat", "Privacy"],
    settings,
    dependencies: ["MemberListDecoratorsAPI"],
    patches: [
        {
            // Confirmed at runtime: message-row author ID.
            find: "Message must not be a thread starter message",
            replacement: {
                match: /"aria-setsize":-1,(?=.{0,150}?#{intl::MESSAGE_A11Y_ROLE_DESCRIPTION})/,
                replace: "...$self.getMessageProps(arguments[0]),$&"
            }
        },
        {
            // Profile popout widget gets a User prop, independent of visible text.
            find: '"UserProfilePopout");',
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),/,
                replace: "$&$self.profileMarker({user:$1}),"
            }
        },
        {
            // 1:1 DM sidebar uses a separate profile widget implementation.
            find: ".SIDEBAR,disableToolbar:",
            replacement: {
                match: /user:(\i),widgets:.{0,100}?\}\),(?=.{0,100}unownedWishlistItems:\i,wishlistId:\i)/,
                replace: "$&$self.profileMarker({user:$1}),"
            }
        }
    ],
    getMessageProps(props: { message?: Message; }) {
        return { [ROW_ATTR]: props?.message?.author?.id };
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
            style.textContent = STYLE_TEXT;
            document.head.appendChild(style);
        }
        addGlobalContextMenuPatch(addUserToggle);
        observer = new MutationObserver(schedule);
        if (document.body) reconcile();
    },
    stop() {
        observer?.disconnect();
        observer = undefined;
        removeGlobalContextMenuPatch(addUserToggle);
        profileOwners.clear();
        document.getElementById(STYLE_ID)?.remove();
        restoreUnused({ text: new Set(), attributes: new Map(), hidden: new Set() });
    }
});
