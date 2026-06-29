import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {decorateAppIcon, decorateWindowIcon, disambiguateIcons} from './icon-decorations.js';

const MONITOR_POLL_MS = 150;

export default class CurrentScreenOnlyExtension extends Extension {
    enable() {
        this._activePopups = new Set();
        this._timeoutIds = [];
        this._injectionManager = new InjectionManager();
        this._appSwitcherProto = null;

        this._patchWindowList();
        this._routePrimaryMonitorToCurrentWhilePopupActive();
        this._patchIconDecorations();
        this._patchPopupLifecycle();
    }

    disable() {
        this._injectionManager.clear();

        // Dismiss any switcher popup still open at disable time so its destroy
        // handlers run synchronously now — cancelling the pending timeouts (here
        // and in the icon decorations) and dropping references to this extension.
        [...this._activePopups].forEach(popup => popup.destroy());

        this._timeoutIds.forEach(id => GLib.source_remove(id));
        this._timeoutIds = null;

        // Clear popups before restoring so the primaryMonitor getter reports the
        // real primary again, not the monitor under the pointer.
        this._activePopups.clear();
        this._restorePrimaryMonitor();
        this._activePopups = null;

        this._injectionManager = null;
        this._appSwitcherProto = null;
    }

    _patchWindowList() {
        this._injectionManager.overrideMethod(
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
        this._injectionManager.overrideMethod(
            AltTab.AppIcon.prototype, '_init',
            original => function (app) {
                original.call(this, app);
                decorateAppIcon(this, app);
            });

        if (!AltTab.WindowIcon)
            return;

        this._injectionManager.overrideMethod(
            AltTab.WindowIcon.prototype, '_init',
            original => function (window, mode) {
                original.call(this, window, mode);
                decorateWindowIcon(this, window);
            });
    }

    _patchPopupLifecycle() {
        const trackPopup = popup => {
            this._activePopups.add(popup);
            const timeoutId = this._watchMonitorChange(popup);
            popup.connect('destroy', () => {
                this._activePopups?.delete(popup);
                this._cancelTimeout(timeoutId);
            });
        };

        this._injectionManager.overrideMethod(
            AltTab.WindowSwitcherPopup.prototype, '_init',
            original => function (...args) {
                original.apply(this, args);
                trackPopup(this);
                disambiguateIcons(this._items);
            });

        const ext = this;
        this._injectionManager.overrideMethod(
            AltTab.AppSwitcherPopup.prototype, '_init',
            original => function () {
                original.call(this);
                trackPopup(this);
                ext._ensureAppSwitcherFilter(this);
                disambiguateIcons(this._items);
            });
    }

    _watchMonitorChange(popup) {
        const lastMonitor = global.display.get_current_monitor();
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, MONITOR_POLL_MS, () => {
            const current = global.display.get_current_monitor();
            if (current === lastMonitor)
                return GLib.SOURCE_CONTINUE;
            // Drop this id before fadeAndDestroy: the popup's destroy handler calls
            // _cancelTimeout(id), and the source also auto-removes via SOURCE_REMOVE,
            // so the id must already be gone to avoid a double GLib.source_remove.
            this._dropTimeout(id);
            popup.fadeAndDestroy?.();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.push(id);
        return id;
    }

    _cancelTimeout(id) {
        if (this._dropTimeout(id))
            GLib.source_remove(id);
    }

    _dropTimeout(id) {
        const index = this._timeoutIds?.indexOf(id) ?? -1;
        if (index === -1)
            return false;
        this._timeoutIds.splice(index, 1);
        return true;
    }

    _ensureAppSwitcherFilter(popup) {
        if (this._appSwitcherProto)
            return;

        const proto = popup._switcherList.constructor.prototype;
        this._appSwitcherProto = proto;

        this._injectionManager.overrideMethod(
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
