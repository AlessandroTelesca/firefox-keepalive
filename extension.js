// SPDX-License-Identifier: GPL-2.0-or-later
// SPDX-FileCopyrightText: 2026 AlessandroTelesca

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const APP_ID = 'org.mozilla.firefox.desktop';
// systemd-run --scope execs Firefox in place (same PID, own app scope instead
// of gnome-shell's cgroup); /usr/bin/firefox also execs the real binary.
const ARGV = [
    'systemd-run', '--user', '--scope', '--quiet', '--collect',
    '--description=Firefox keepalive',
    'firefox', '--private-window', 'about:blank',
];
// Let login settle / let a quitting Firefox release its profile lock.
const LAUNCH_DELAY_S = 3;
// A keepalive that dies this fast without ever opening a window is crashing;
// stop instead of relaunching in a loop.
const MIN_LIFETIME_US = 10 * GLib.USEC_PER_SEC;

// Re-evaluate dock/dash icons that already counted the window.
const refreshApp = win =>
    Shell.WindowTracker.get_default().get_window_app(win)?.emit('windows-changed');

// Keeps one hidden private Firefox window alive so Firefox stays resident:
// dock clicks then only open a new window in the running process.
export default class FirefoxKeepaliveExtension extends Extension {
    enable() {
        this._enabled = true;
        this._app = Shell.AppSystem.get_default().lookup_app(APP_ID);
        if (!this._app) {
            console.warn(`firefox-keepalive: ${APP_ID} not found`);
            return;
        }
        this._stateId = this._app.connect('notify::state', () => this._scheduleLaunch());
        this._createdId = global.display.connect('window-created', (_display, win) => this._onWindow(win));
        // Re-enabled while our Firefox is still running: hide its window again.
        for (const actor of global.get_window_actors())
            this._onWindow(actor.meta_window);
        this._scheduleLaunch();
    }

    disable() {
        this._enabled = false;
        if (this._launchId)
            GLib.source_remove(this._launchId);
        this._launchId = null;
        if (this._app) {
            this._app.disconnect(this._stateId);
            global.display.disconnect(this._createdId);
        }
        this._app = null;
        if (this._window)
            this._unhide(this._window);
        this._window = null;
        // The keepalive Firefox (this._proc) keeps running; it is re-adopted on enable.
    }

    _scheduleLaunch() {
        if (!this._enabled || this._launchId || this._proc ||
            this._app.state !== Shell.AppState.STOPPED)
            return;
        this._launchId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, LAUNCH_DELAY_S, () => {
            this._launchId = null;
            if (this._enabled && !this._proc && this._app.state === Shell.AppState.STOPPED)
                this._launch();
            return GLib.SOURCE_REMOVE;
        });
    }

    _launch() {
        let proc;
        try {
            proc = Gio.Subprocess.new(ARGV, Gio.SubprocessFlags.NONE);
        } catch (e) {
            console.error(`firefox-keepalive: launch failed: ${e.message}`);
            return;
        }
        const startedAt = GLib.get_monotonic_time();
        this._proc = proc;
        this._pid = Number(proc.get_identifier());
        this._keepaliveSeq = null;
        proc.wait_async(null, () => {
            const crashed = this._keepaliveSeq === null &&
                GLib.get_monotonic_time() - startedAt < MIN_LIFETIME_US;
            this._proc = null;
            this._pid = null;
            this._keepaliveSeq = null;
            if (crashed) {
                console.error('firefox-keepalive: Firefox exited before opening a window; not relaunching');
                return;
            }
            this._scheduleLaunch();
        });
    }

    _onWindow(win) {
        if (this._keepaliveSeq === null && this._pid && win.get_pid() === this._pid) {
            // The first window of the Firefox process we started is the keepalive;
            // later windows of the same process are the user's.
            this._keepaliveSeq = win.get_stable_sequence();
        }
        if (this._keepaliveSeq === null || win.get_stable_sequence() !== this._keepaliveSeq)
            return;
        this._window = win;
        win.connectObject('unmanaged', () => {
            if (this._window === win)
                this._window = null;
        }, this);
        this._hide(win);
    }

    _hide(win) {
        // Mutter has no skip-taskbar setter for Wayland clients, but GNOME Shell
        // (overview, Alt+Tab) and Dash to Dock read these properties from JS,
        // so shadowing them on this window's wrapper hides it everywhere.
        Object.defineProperty(win, 'skip_taskbar', {value: true, configurable: true});
        Object.defineProperty(win, 'skipTaskbar', {value: true, configurable: true});
        win.minimize();
        refreshApp(win);
    }

    _unhide(win) {
        win.disconnectObject(this);
        delete win.skip_taskbar;
        delete win.skipTaskbar;
        refreshApp(win);
    }
}
