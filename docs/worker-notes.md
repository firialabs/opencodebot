# Worker notes

Running notes from the app worker, for whoever picks up next.

## HANDOFF (Nov 11, 2026)

### State
- PR #1 `fix/jill-blocks`: else if via + and - buttons on the if block
  (`@blockly/block-plus-minus`); CodeBot line sensor LED, proximity LED, power
  LED and "button was pressed" blocks; smoke test covers them.
  The botcore calls are from memory: docs.firialabs.com is blocked by the cloud
  session's network policy. Verify on a real CodeBot.
- PR #2 `feat/device-targets`: the DeviceTarget interface
  (`src/device/device-target.js`, written up in `docs/device-targets.md`), a
  `loopback` pretend device, `?device=<kind>` selection, `writeFile` and
  `autoConnect` on the serial device, and `tests/device.mjs` (Connect, Run,
  Stop with no hardware).
- Local test runs: `OCB_CHROMIUM=/opt/pw-browsers/chromium npm test` after
  `npm run build` (the cloud container's Playwright browser version differs).

### Left to do, in suggested order
1. Block gaps on CodeX and CodeAIR against docs.firialabs.com (needs that host
   allowed, or someone with the docs open). CodeBot candidates still missing:
   proximity range, USB power check, line sensor threshold.
2. Blocks and text toggle (teachers asked): an editable Python view, with a
   clear one-way warning when going from text back to blocks.
3. i18n: move every user-facing string (blocks, toolbox, `src/ui/copy.js`,
   `index.html`, notices in `device-manager.js`) into one strings module; keep
   the product name in one constant so the rename is cheap.
4. Accessibility: keyboard navigation (Blockly keyboard-navigation plugin),
   labels on icon buttons, contrast check on block colours with white text.
5. Privacy: confirm no network calls beyond the page itself (fonts are bundled;
   check the PWA and anything else), and say so in the About dialog.
6. From the Jill and Joules feedback doc (read Nov 11):
   - "No way to clear a program and start over": New project exists but sits
     in the hidden ⋯ menu. Put a visible New / Start over button in the top bar.
   - "Couldn't rename files": projects have no name. Add a project name field
     that also names the downloaded file.
   - Python view is read-only (same as item 2).
   - github.io may be blocked by school filters; the doc suggests a custom
     domain (blocks.firialabs.com). A manager or David decision, not code.
   - Launch as a labeled beta with 5 to 6 starter lessons per device.

### Next step
Start on item 3 (strings in one place), since 2 and 4 both add strings.
