import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {disambiguateTitles} from './disambiguator.js';

const MAX_TITLE_CHARS = 20;
const TITLE_STYLE = 'padding: 2px 6px; font-size: 0.85em;';
const OVERLAY_ICON_SIZE = 14;
const CONFIRMATION_DELAY_MS = 400;
const TOOLTIP_DELAY_MS = 600;
const TOOLTIP_FADE_IN_MS = 150;
const TOOLTIP_FADE_OUT_MS = 100;
const TOOLTIP_OFFSET_PX = 6;
const CLOSE_TOOLTIP = 'Close';
const MOVE_TOOLTIP = 'Move to next monitor';

export function decorateAppIcon(appIcon, app) {
    appIcon.label?.hide();
    const overlay = wrapInBinLayout(appIcon, appIcon._iconBin);
    decorate(appIcon, overlay, app.get_name(), {
        close: () => app.request_quit(),
        track: () => trackAppClosure(app),
        surface: () => app.activate(),
        move: () => moveAppWindowsToNextMonitor(appIcon),
    });
}

export function decorateWindowIcon(windowIcon, window) {
    decorate(windowIcon, windowIcon._icon, window.get_title?.() ?? '', {
        close: () => window.delete(global.get_current_time()),
        track: () => trackWindowClosure(window),
        surface: () => window.activate(global.get_current_time()),
        move: () => moveWindowToNextMonitor(window),
    });
}

function decorate(icon, overlay, name, actions) {
    icon._csoOriginalName = name;
    icon._csoTitle = prependTitle(icon, name);
    icon._csoClose = addCloseButton(overlay, () => {
        closeOrSurfaceConfirmation(icon, {
            close: actions.close,
            track: actions.track,
            surface: actions.surface,
            onClosed: () => removeIconFromSwitcher(icon),
        });
    });
    icon._csoMove = addMoveButton(overlay, () => {
        actions.move();
        removeIconFromSwitcher(icon);
    });
}

export function disambiguateIcons(icons) {
    if (!icons || icons.length < 2)
        return;
    const titles = disambiguateTitles(icons.map(i => i._csoOriginalName ?? ''));
    icons.forEach((icon, i) => {
        if (!icon._csoTitle)
            return;
        icon._csoTitle.text = truncate(titles[i], MAX_TITLE_CHARS);
    });
}

function prependTitle(actor, text) {
    const label = new St.Label({
        text: truncate(text, MAX_TITLE_CHARS),
        x_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
        style: TITLE_STYLE,
    });
    actor.add_child(label);
    actor.set_child_at_index(label, 0);
    return label;
}

function addCloseButton(host, onClose) {
    return addOverlayButton(host, {
        iconName: 'window-close-symbolic',
        styleClass: 'cso-close-button',
        xAlign: Clutter.ActorAlign.END,
        yAlign: Clutter.ActorAlign.START,
        tooltip: CLOSE_TOOLTIP,
        onClick: onClose,
    });
}

function addMoveButton(host, onMove) {
    return addOverlayButton(host, {
        iconName: 'object-flip-horizontal-symbolic',
        styleClass: 'cso-move-button',
        xAlign: Clutter.ActorAlign.START,
        yAlign: Clutter.ActorAlign.START,
        tooltip: MOVE_TOOLTIP,
        onClick: onMove,
    });
}

function addOverlayButton(host, {iconName, styleClass, xAlign, yAlign, tooltip, onClick}) {
    const button = new St.Button({
        style_class: styleClass,
        child: new St.Icon({icon_name: iconName, icon_size: OVERLAY_ICON_SIZE}),
        x_align: xAlign,
        y_align: yAlign,
        x_expand: true,
        y_expand: true,
        track_hover: true,
        can_focus: false,
    });
    button.connect('clicked', () => onClick());
    host.add_child(button);
    if (tooltip)
        attachHoverTooltip(button, tooltip);
    return button;
}

function attachHoverTooltip(actor, text) {
    let label = null;
    let timeoutId = 0;

    const cancelTimeout = () => {
        if (timeoutId === 0)
            return;
        GLib.source_remove(timeoutId);
        timeoutId = 0;
    };

    const removeLabel = () => {
        if (!label)
            return;
        const dying = label;
        label = null;
        dying.ease({
            opacity: 0,
            duration: TOOLTIP_FADE_OUT_MS,
            onComplete: () => dying.destroy(),
        });
    };

    const showLabel = () => {
        timeoutId = 0;
        if (!actor.hover)
            return GLib.SOURCE_REMOVE;
        label = new St.Label({text, style_class: 'cso-tooltip'});
        Main.uiGroup.add_child(label);
        positionAboveActor(label, actor);
        label.opacity = 0;
        label.ease({opacity: 255, duration: TOOLTIP_FADE_IN_MS});
        return GLib.SOURCE_REMOVE;
    };

    actor.connect('notify::hover', () => {
        if (actor.hover && timeoutId === 0 && !label)
            timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TOOLTIP_DELAY_MS, showLabel);
        else if (!actor.hover) {
            cancelTimeout();
            removeLabel();
        }
    });

    actor.connect('destroy', () => {
        cancelTimeout();
        label?.destroy();
        label = null;
    });
}

function positionAboveActor(label, actor) {
    const [actorX, actorY] = actor.get_transformed_position();
    const [actorW] = actor.get_transformed_size();
    const [labelW, labelH] = label.get_size();
    label.set_position(
        Math.floor(actorX + actorW / 2 - labelW / 2),
        Math.floor(actorY - labelH - TOOLTIP_OFFSET_PX),
    );
}

function wrapInBinLayout(parent, child) {
    const index = parent.get_children().indexOf(child);
    parent.remove_child(child);
    const wrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true,
        y_expand: true,
    });
    wrapper.add_child(child);
    parent.insert_child_at_index(wrapper, index);
    return wrapper;
}

function closeOrSurfaceConfirmation(icon, {close, track, surface, onClosed}) {
    close();
    const tracker = track();
    let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, CONFIRMATION_DELAY_MS, () => {
        timeoutId = 0;
        if (tracker.closed) {
            onClosed?.();
        } else {
            findEnclosingPopup(icon)?.fadeAndDestroy?.();
            surface();
        }
        tracker.cleanup?.();
        return GLib.SOURCE_REMOVE;
    });
    // The icon may be destroyed (popup dismissed) before the delay elapses; drop
    // the pending timeout so it never runs against an already-finalized actor.
    icon.connect('destroy', () => {
        if (timeoutId > 0)
            GLib.source_remove(timeoutId);
        tracker.cleanup?.();
    });
}

function trackWindowClosure(window) {
    const tracker = {closed: false};
    window.connectObject('unmanaged', () => {
        tracker.closed = true;
    }, tracker);
    tracker.cleanup = () => window.disconnectObject(tracker);
    return tracker;
}

function trackAppClosure(app) {
    const tracker = {closed: app.get_n_windows() === 0};
    app.connectObject('windows-changed', () => {
        if (app.get_n_windows() !== 0)
            return;
        tracker.closed = true;
    }, tracker);
    tracker.cleanup = () => app.disconnectObject(tracker);
    return tracker;
}

function moveWindowToNextMonitor(window) {
    const target = nextMonitorIndex(window.get_monitor());
    if (target === null)
        return;
    window.move_to_monitor(target);
}

function moveAppWindowsToNextMonitor(appIcon) {
    const target = nextMonitorIndex(global.display.get_current_monitor());
    if (target === null)
        return;
    appIcon.cachedWindows.forEach(w => w.move_to_monitor(target));
}

function nextMonitorIndex(current) {
    const n = global.display.get_n_monitors();
    if (n < 2)
        return null;
    return (current + 1) % n;
}

function removeIconFromSwitcher(icon) {
    const switcherList = findSwitcherList(icon);
    const index = switcherList?.icons.indexOf(icon) ?? -1;
    if (index === -1) {
        icon.hide();
        return;
    }

    const popup = findEnclosingPopup(icon);

    if (Array.isArray(switcherList._arrows)) {
        switcherList._arrows[index]?.destroy();
        switcherList._arrows.splice(index, 1);
    }
    switcherList.icons.splice(index, 1);
    switcherList.removeItem(index);

    if (switcherList.icons.length === 0)
        popup?.fadeAndDestroy?.();
}

function findSwitcherList(actor) {
    let parent = actor.get_parent();
    while (parent) {
        if (Array.isArray(parent.icons))
            return parent;
        parent = parent.get_parent();
    }
    return null;
}

function findEnclosingPopup(actor) {
    const ui = Main.uiGroup;
    let current = actor;
    while (current) {
        const parent = current.get_parent?.();
        if (parent === ui)
            return current;
        current = parent;
    }
    return null;
}

function truncate(text, max) {
    const chars = Array.from(text);
    return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}
