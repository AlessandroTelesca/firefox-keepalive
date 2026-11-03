# Firefox Keepalive

Keeps Firefox running in the background so clicking it in the dock opens a window instantly instead of waiting for Firefox to start.

- When Firefox isn't running, it starts `firefox --private-window about:blank` (in its own systemd scope) and hides that window: it is minimized and left out of the dock, the overview and Alt+Tab. Windows you open afterwards are normal.
- If Firefox quits, it is started again a few seconds later. If it exits before ever opening a window, the extension stops relaunching it rather than looping.
- Disabling the extension makes the hidden window visible again; Firefox keeps running.

Limits: it looks for the distro-packaged Firefox (`org.mozilla.firefox.desktop`, launched as `firefox`); the Flatpak and Snap builds are not supported. Hiding the window relies on GNOME Shell and Dash to Dock reading `skip_taskbar` from JS, so a Shell update can break it.

Install:

```sh
gnome-extensions pack --force . && gnome-extensions install --force firefox-keepalive@alessandrot.shell-extension.zip
```

then log out and in, and `gnome-extensions enable firefox-keepalive@alessandrot`.

GNOME Shell 50.

License: GPL-2.0-or-later, see `LICENSE`.
