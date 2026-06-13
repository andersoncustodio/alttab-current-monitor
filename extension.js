import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Patcher} from './patcher.js';
import {decorateAppIcon, decorateWindowIcon, disambiguateIcons} from './icon-decorations.js';

const MONITOR_POLL_MS = 150;

export default class CurrentScreenOnlyExtension extends Extension {
    enable() {
        this._activePopups = new Set();
        this._popupWatchers = new Set();
        this._popupDestroyIds = new Map();
        this._patcher = new Patcher();
        this._appSwitcherProto = null;

        this._patchWindowList();
        this._routePrimaryMonitorToCurrentWhilePopupActive();
        this._patchIconDecorations();
        this._patchPopupLifecycle();
    }

    disable() {
        this._patcher.restoreAll();

        // Disconnect destroy handlers from any popups still open at disable time;
        // popups closed normally already removed themselves from the map.
        this._popupDestroyIds.forEach((id, popup) => popup.disconnect(id));
        this._popupDestroyIds.clear();
        this._popupDestroyIds = null;

        this._popupWatchers.forEach(stop => stop());
        this._popupWatchers.clear();
        this._popupWatchers = null;

        // Clear popups before restoring so the primaryMonitor getter reports the
        // real primary again, not the monitor under the pointer.
        this._activePopups.clear();
        this._restorePrimaryMonitor();
        this._activePopups = null;

        this._patcher = null;
        this._appSwitcherProto = null;
    }

    _patchWindowList() {
        this._patcher.patch(
            AltTab.WindowSwitcherPopup.prototype, '_getWindowList',
            original => function () {
                return filterToCurrentMonitor(original.call(this));
            });
    }

    _routePrimaryMonitorToCurrentWhilePopupActive() {
        const lm = Main.layoutManager;
        const popups = this._activePopups;
        let backing = lm.primaryMonitor;

        // While a switcher popup is open, report the monitor under the pointer as
        // the primary one. SwitcherPopup centres itself on primaryMonitor, so this
        // makes Alt-Tab appear on the active monitor. The override is global for the
        // popup's lifetime; it reverts to the real primary once none are open.
        Object.defineProperty(lm, 'primaryMonitor', {
            configurable: true,
            enumerable: true,
            get() {
                return popups.size > 0 ? this.currentMonitor : backing;
            },
            set(value) {
                backing = value;
            },
        });
    }

    _restorePrimaryMonitor() {
        const lm = Main.layoutManager;
        const current = lm.primaryMonitor;
        delete lm.primaryMonitor;
        lm.primaryMonitor = current;
    }

    _patchIconDecorations() {
        this._patcher.patch(
            AltTab.AppIcon.prototype, '_init',
            original => function (app) {
                original.call(this, app);
                decorateAppIcon(this, app);
            });

        if (!AltTab.WindowIcon)
            return;

        this._patcher.patch(
            AltTab.WindowIcon.prototype, '_init',
            original => function (window, mode) {
                original.call(this, window, mode);
                decorateWindowIcon(this, window);
            });
    }

    _patchPopupLifecycle() {
        const trackPopup = popup => {
            this._activePopups.add(popup);
            const stopWatching = this._watchMonitorChange(popup);
            this._popupWatchers.add(stopWatching);
            const destroyId = popup.connect('destroy', () => {
                this._activePopups?.delete(popup);
                this._popupWatchers?.delete(stopWatching);
                this._popupDestroyIds?.delete(popup);
                stopWatching();
            });
            this._popupDestroyIds.set(popup, destroyId);
        };

        this._patcher.patch(
            AltTab.WindowSwitcherPopup.prototype, '_init',
            original => function (...args) {
                original.apply(this, args);
                trackPopup(this);
                disambiguateIcons(this._items);
            });

        const ext = this;
        this._patcher.patch(
            AltTab.AppSwitcherPopup.prototype, '_init',
            original => function () {
                original.call(this);
                trackPopup(this);
                ext._ensureAppSwitcherFilter(this);
                disambiguateIcons(this._items);
            });
    }

    _watchMonitorChange(popup) {
        let lastMonitor = global.display.get_current_monitor();
        let id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MONITOR_POLL_MS, () => {
            const current = global.display.get_current_monitor();
            if (current === lastMonitor)
                return GLib.SOURCE_CONTINUE;
            id = 0;
            popup.fadeAndDestroy?.();
            return GLib.SOURCE_REMOVE;
        });
        return () => {
            if (id > 0) {
                GLib.source_remove(id);
                id = 0;
            }
        };
    }

    _ensureAppSwitcherFilter(popup) {
        if (this._appSwitcherProto)
            return;

        const proto = popup._switcherList.constructor.prototype;
        this._appSwitcherProto = proto;

        this._patcher.patch(
            proto, '_addIcon',
            original => function (appIcon) {
                appIcon.cachedWindows = filterToCurrentMonitor(appIcon.cachedWindows);
                if (appIcon.cachedWindows.length === 0)
                    return undefined;
                return original.call(this, appIcon);
            });

        this._rebuildAppSwitcherList(popup);
    }

    _rebuildAppSwitcherList(popup) {
        const SwitcherList = popup._switcherList.constructor;
        popup._switcherList.destroy();
        popup._switcherList = new SwitcherList(
            Shell.AppSystem.get_default().get_running(), popup);
        popup._items = popup._switcherList.icons;
    }
}

function filterToCurrentMonitor(windows) {
    const monitor = global.display.get_current_monitor();
    return windows.filter(w => w.get_monitor() === monitor);
}
