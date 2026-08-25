# Icons

Generated from the Brew Terminal logo supplied by the project owner. These are no longer
placeholders.

## Source of record

`assets/brand/brew-terminal-logo-source.png` is the owner's original artwork, committed
unmodified. It is a two-panel presentation sheet — the full lockup on the left, the app icon
on the right — so it is not directly usable as an icon source.

`assets/brand/app-icon-1024.png` is the square 1024x1024 icon source derived from it, and is
what `tauri icon` consumes.

## How the icon source was derived

The supplied icon tile measures 485x497 px — 2.5% taller than wide. Stretching it to a square
would have distorted the monogram, so instead the container was redrawn at full resolution and
the original monogram pixels were composited inside it. Measured from the artwork:

| Property       | Value                      |
| -------------- | -------------------------- |
| Corner radius  | 21.2% of the side          |
| Border stroke  | 1.43% of the side          |
| Monogram width | 55.9% of the side, centred |
| Brand orange   | `#FE7D06`                  |
| Tile fill      | `#000000`                  |

Note that `#FE7D06` is the logo's orange and is close to, but not the same as, the app's
`--accent` token (`#F97316` in the dark theme). The tokens are tuned for contrast against
each theme's surfaces — see the note above `--accent` in `src/styles/tokens.css` — so they are
deliberately not slaved to the logo.

**Resolution ceiling:** the highest-resolution copy of the mark in the supplied sheet is that
485 px tile, so the 1024 px source is a ~2.1x upscale. The container is redrawn and therefore
crisp at any size; the monogram is not. It is legible down to 24 px and resolves to an
orange tile with a light shape at 16 px. If a higher-resolution export of the mark ever
exists, replacing `app-icon-1024.png` and re-running the command below is the whole fix.

## Regenerating

```bash
npm run tauri icon assets/brand/app-icon-1024.png
```

That command also emits `ios/` and `android/` directories. Brew Terminal is desktop-only —
mobile layouts are an explicit non-goal in `docs/PRODUCT_SCOPE_V0_1.md` — so both are deleted
after running it. Nothing in the build consumes them.

`bundle.icon` in `tauri.conf.json` lists `icon.icns` (macOS) and `icon.ico` (Windows)
alongside the PNG sizes that Linux uses.
