# Brand assets

The official Firia Labs artwork this project uses, kept here unmodified so the
derived icons can be traced back to a source.

| File | What it is |
|---|---|
| `firia-logo.svg` | The full Firia Labs lockup: bot head, "FIRIA" in `#4EB748`, "LABS" on the gold banner. Not shipped in the app — it lives here as the source for the head mark below. |
| `../public/icons/firia-bot.svg` | The Cody rocket mascot, used in the app header. Unmodified. |
| `../public/icons/firia-bot-head.svg` | The square head mark, used as the favicon, the PWA icon and the empty-workspace hint. |

## How the head mark was made

`firia-bot-head.svg` is `firia-logo.svg` with the wordmark paths removed and
the viewBox re-cropped square around what remains. Nothing was redrawn: the
head is the original artwork, so it stays pixel-identical to the logo's.

To regenerate it after a logo update, drop every path whose bounding box lies
entirely to the right of the head (x >= 150 in the logo's viewBox units),
prune the groups that leaves empty, then set the viewBox to a square centred
on the remaining bounding box with about 12% padding.

## Colours

Taken from `firia-logo.svg` itself, not from a screenshot:

- `#4EB748` Firia Green — the "FIRIA" wordmark, and the OpenCodeBot title text
- `#4C4D4F` Dark Gray — "LABS", and the bot's outlines
- `#F4D036` / `#F4D038` gold — the bot's ears and eyes, and the logo banner
