# Worker notes

Running notes from the app worker, for whoever picks up next.

## HANDOFF (Nov 12, 2026)

### State
- Merged into main (Nov 12): #1 Jill's block fixes (else if via + and -
  buttons, CodeBot line sensor, proximity and power LEDs, was pressed), #2 the
  DeviceTarget interface (`docs/device-targets.md`) with the loopback device
  and hardware-free tests, #3 licences and TRADEMARKS.md, #4 the remaining
  blocks the device docs showed were missing.
- Every block's device call has been checked against docs.firialabs.com, and
  the manager confirmed the CodeBot ones against botcore's source.
- Open:
  - #5 `feat/usability`: visible New button, project names (rename in place;
    the name labels the browser tab and the saved file).
  - #6 `feat/text-mode`, stacked on #5: blocks/text toggle. Edit as Python,
    Run sends typed code, Back to blocks asks before losing typed changes.
    One-way on purpose: Python does not turn back into blocks.
- Tests: `npm run build`, then `OCB_CHROMIUM=/opt/pw-browsers/chromium npm test`
  in this cloud container (its Playwright browser version differs). Suites:
  protocol, smoke, device, project, text-mode, subpath.
- docs.firialabs.com: reachable with curl from this environment; the WebFetch
  tool still cannot resolve it.
- Hosting: the public release will not be on github.io (David, Nov 11). Keep
  the app free of assumptions about host or base path; the subpath suite
  guards that.

### Left to do, in suggested order
1. Strings in one place (i18n): every user-facing string (block messages and
   tooltips, toolbox category names, `src/ui/copy.js`, `index.html`, notices
   in `device-manager.js` and `app.js`) into one string table, keyed, with
   English as the default locale. The product name ("OpenCodeBot") in one
   constant, so the rename is cheap.
2. Accessibility: keyboard navigation of the workspace (Blockly's keyboard
   navigation plugin), labels on icon-only buttons (🧹, ⋯), focus order,
   contrast of white block text on the category colours, screen reader
   announcements for status changes (the status bar should be a live region).
3. Privacy: confirm nothing leaves the browser (fonts are bundled; check the
   service worker and any other request), and say so in the About dialog.
4. From the feedback doc, not code: launch as a labeled beta with 5 to 6
   starter lessons per device.

### Next step
Start on item 1 (strings in one place), since item 2 adds strings too.
