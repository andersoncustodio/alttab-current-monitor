# Alt-Tab — Current Monitor

This is a GNOME Shell extension.

It filters the windows shown in the Alt-Tab switcher to those of the
current monitor, and adds a few quality-of-life controls on top of each
icon.

Compatible with GNOME 46 through 50.

## Features

- **Filter by monitor** — Alt-Tab only shows apps/windows on the monitor
  where the cursor is.
- **Popup follows the cursor** — the switcher centres on the active
  monitor instead of always on the primary.
- **Always-on titles** — every icon shows its app/window name, not only
  the highlighted one.
- **Common-prefix collapse** — titles that share a leading run of words
  are abbreviated by their initials, so similar entries stay
  distinguishable. Example: `Some Long Shared Prefix ABC` and
  `Some Long Shared Prefix XYZ` become `S.L.S.P. ABC` and `S.L.S.P. XYZ`.
- **Close button** — a small `X` in the top-right corner of each entry
  closes the window/app without dismissing the switcher. If the window
  refuses to close (e.g. it asks to save), the switcher dismisses and the
  window is activated instead.
- **Move to next monitor** — a button on each entry sends the
  window/app to the next monitor without dismissing the switcher.
- **Hover tooltips** — the icon buttons have hover tooltips describing
  their action.
- **Auto-dismiss on monitor change** — moving the pointer to another
  monitor closes the popup so the next Alt-Tab opens on that monitor.

## Install

Manually:

```sh
cd ~/.local/share/gnome-shell/extensions
git clone https://github.com/andersoncustodio/alttab-current-monitor.git alttab-current-monitor@andersoncustodio.com
```

Reload GNOME Shell:

  1. **X11**: open the Run a Command dialog with `Alt+F2`, type `r`,
     press Enter.
  2. **Wayland**: log out and back in.

Then enable:

```sh
gnome-extensions enable alttab-current-monitor@andersoncustodio.com
```

## Code layout

```
extension.js         entry point — orchestrates the patches
patcher.js           generic prototype-method patch/restore helper
disambiguator.js     pure title disambiguation algorithm
icon-decorations.js  per-icon title + close / move buttons (St / Clutter)
stylesheet.css       :hover / :active styling for the icon buttons
```

## License & credits

Fork of [Current screen only on window switcher](https://github.com/mmai/Current_screen_only_on_window_switcher)
by Henri Bourcereau. Distributed under the **MIT License**.

See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE) for details.
