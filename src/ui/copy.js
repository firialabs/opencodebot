/** Friendly text that shows up in dialogs. Kept in one place so it is easy
 *  to re-word, translate, or review without digging through logic. */

export function welcomeHtml() {
  return `
    <p>Hi! OpenCodeBot lets you build programs for your Firia Labs device by
    snapping blocks together. No typing required — but the real Python is
    always right there in the <strong>Python</strong> tab if you want to peek.</p>
    <ol>
      <li><strong>Pick your device</strong> at the top — CodeBot, CodeX or CodeAIR.</li>
      <li><strong>Plug it in</strong> with a USB cable and press <strong>Connect</strong>.</li>
      <li><strong>Drag some blocks</strong>, then press <strong>Run</strong>.</li>
    </ol>
    <p>Nothing you make here leaves your computer, and once this page has
    loaded it keeps working without internet.</p>`
}

export const HELP_HTML = `
  <h3>Getting connected</h3>
  <ul>
    <li>Use Chrome or Edge on a computer or Chromebook — they can talk to USB devices.</li>
    <li>Plug the device in, press <strong>Connect</strong>, then choose it from the list the browser shows.</li>
    <li>If the device stops answering, unplug it, plug it back in, and press Connect again.</li>
  </ul>
  <h3>The two tabs</h3>
  <ul>
    <li><strong>Talk to device</strong> is a live Python prompt on the device. Type in it!
      Press <kbd>Tab</kbd> to complete a name and <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop a program.</li>
    <li><strong>Python</strong> shows exactly the code your blocks make.</li>
  </ul>
  <h3>Shortcuts</h3>
  <ul>
    <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd> — run your program</li>
    <li><kbd>Esc</kbd> — stop a running program</li>
    <li><kbd>Ctrl</kbd>+<kbd>S</kbd> — save your project to a file</li>
  </ul>`

export const ABOUT_HTML = `
  <p>OpenCodeBot is a free, open-source block editor for the Firia Labs
  <strong>CodeBot</strong>, <strong>CodeX</strong> and <strong>CodeAIR</strong>.
  It is a gentle on-ramp — when your students are ready for full Python, the
  CodeSpace platform is waiting for them.</p>
  <p>Your programs run as real CircuitPython on the device, using the same
  libraries documented at
  <a href="https://docs.firialabs.com/" target="_blank" rel="noreferrer">docs.firialabs.com</a>.</p>
  <p>Found a bug, or want a block that is missing? Contributions are very
  welcome on GitHub.</p>`
