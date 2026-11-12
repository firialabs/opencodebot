// English: the reference table. Every key lives here first; other languages
// translate what they can and fall back to this for the rest.
// {app} is the product's name; other {placeholders} are filled in by the code.
// A key ending in Html is HTML. A value of { one, other } is chosen by {count}.
export default {
  'app.name': 'OpenCodeBot',
  'app.description': 'Friendly block coding for Firia Labs CodeBot, CodeX, and CodeAIR.',
  'app.tagline': 'blocks that fly, roll & glow',

  // The top bar
  'chip.pick': 'Pick a device',
  'chip.menuHead': 'I am using a…',
  'btn.connect': 'Connect',
  'btn.disconnect': 'Disconnect',
  'btn.run': 'Run',
  'btn.stop': 'Stop',
  'btn.more': 'More',
  'btn.new': 'New',
  'btn.newTitle': 'Start a new project',
  'project.default': 'My project',
  'project.nameLabel': 'Project name',
  'project.nameTitle': 'Click to rename your project',
  'project.pageTitle': '{name} · {app}',
  'menu.new': '🆕 New project',
  'menu.open': '📂 Open project…',
  'menu.save': '💾 Save project',
  'menu.exportPy': '🐍 Download Python',
  'menu.copyPy': '📋 Copy Python',
  'menu.help': '❓ Help & shortcuts',
  'menu.about': '💚 About {app}',

  // The work area
  'blocks.hint': 'Drag blocks from the left to build your program!',
  'splitter.label': 'Resize panels',
  'tab.terminal': 'Talk to device',
  'tab.python': 'Python',
  'term.clear': 'Clear the terminal',
  'term.hintHtml': 'Type here to chat with your device. <kbd>Ctrl</kbd>+<kbd>C</kbd> stops a program.',
  'term.greeting': 'Hi! This is a live Python prompt on your device.',
  'term.greetingHint': 'Plug a device in, press Connect, and start typing.',
  'term.connected': '{device} connected, firmware {version} ({date})',
  'term.disconnected': 'Device disconnected.',
  'term.sending': 'Sending your program…',

  // The status bar
  'status.offline': 'Not connected',
  'status.connecting': 'Connecting',
  'status.ready': 'Ready',
  'status.loading': 'Sending',
  'status.running': 'Running',
  'status.error': 'Oops',
  'status.start': 'Plug in your device with a USB cable, then press Connect.',
  'status.sendingPct': 'Sending your program… {pct}%',
  'status.programError': '{name}: {message}',

  // Toasts and dialogs
  'modal.ok': 'Got it',
  'switched.title': 'Switched to {device} blocks',
  'switched.detail': 'Your project still has {names} blocks in it.',
  'adopted.readyTitle': '{device} is ready!',
  'adopted.readyDetail': 'Here is a tiny program to try.',
  'adopted.connectedTitle': '{device} connected',
  'adopted.connectedDetail': 'Your blocks are ready to run.',
  'run.emptyTitle': 'Nothing to run yet',
  'run.emptyDetail': 'Drag some blocks in first!',
  'run.wrongTitle': 'Those blocks are for another device',
  'run.wrongDetail': 'Your project uses {names} blocks, but a {device} is plugged in.',
  'error.atLine': '(Python line {line})',
  'pick.otherTitle': 'A different device is plugged in',
  'pick.otherDetail': 'Unplug the {device} first, or press Connect again after swapping.',
  'pick.switchTitle': 'Switch to {device}?',
  'pick.switchBodyHtml': '<p>Your project uses {names} blocks, which a {device} cannot run.</p><p>Start a fresh project, or keep these blocks and switch anyway?</p>',
  'pick.startFresh': 'Start fresh',
  'pick.keep': 'Keep my blocks',
  'new.title': 'Start a new project?',
  'new.bodyHtml': '<p>Your current blocks will be cleared. This cannot be undone.</p><p>To keep them, press <b>Keep my blocks</b>, then Save project from the ⋯ menu.</p>',
  'new.confirm': 'Yes, start over',
  'new.started': 'New project. Have fun!',
  'pySaved.title': 'Python saved',
  'pySaved.detail': 'Look in your Downloads folder for main.py.',
  'pyCopied.title': 'Python copied!',
  'pyCopyFailed.title': 'Could not copy',
  'pyCopyFailed.detail': 'Select the code in the Python tab instead.',
  'help.title': 'Help & shortcuts',
  'about.title': 'About {app}',
  'saved.title': 'Project saved',
  'saved.detail': 'Look in your Downloads folder for {file}.',
  'opened.title': 'Project opened!',
  'openFailed.title': 'Could not open that file',
  'openFailed.notProject': 'That file does not look like an {app} project.',
  'browser.note': 'This browser cannot connect to devices. Try Chrome or Edge.',
  'browser.noSerial': 'This browser does not support Web Serial, so {app} cannot talk to your device.',
  'browser.noSerialHint': 'You can still build blocks and download the Python. Chrome or Edge on a computer will connect.',
  'welcome.title': 'Welcome to {app}!',
  'welcome.confirm': "Let's go!",
  'welcome.bodyHtml': `
    <p>Hi! {app} lets you build programs for your Firia Labs device by
    snapping blocks together. No typing required, but the real Python is
    always right there in the <strong>Python</strong> tab if you want to peek.</p>
    <ol>
      <li><strong>Pick your device</strong> at the top: CodeBot, CodeX or CodeAIR.</li>
      <li><strong>Plug it in</strong> with a USB cable and press <strong>Connect</strong>.</li>
      <li><strong>Drag some blocks</strong>, then press <strong>Run</strong>.</li>
    </ol>
    <p>Nothing you make here leaves your computer, and once this page has
    loaded it keeps working without internet.</p>`,
  'help.bodyHtml': `
    <h3>Getting connected</h3>
    <ul>
      <li>Use Chrome or Edge on a computer or Chromebook. They can talk to USB devices.</li>
      <li>Plug the device in, press <strong>Connect</strong>, then choose it from the list the browser shows.</li>
      <li>If the device stops answering, unplug it, plug it back in, and press Connect again.</li>
    </ul>
    <h3>The two tabs</h3>
    <ul>
      <li><strong>Talk to device</strong> is a live Python prompt on the device. Type in it!
        Press <kbd>Tab</kbd> to complete a name and <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop a program.</li>
      <li><strong>Python</strong> shows exactly the code your blocks make.</li>
      <li><strong>🆕 New</strong> starts over. Click the project name next to it to rename your project.</li>
    </ul>
    <h3>Shortcuts</h3>
    <ul>
      <li><kbd>Ctrl</kbd>+<kbd>Enter</kbd>: run your program</li>
      <li><kbd>Esc</kbd>: stop a running program</li>
      <li><kbd>Ctrl</kbd>+<kbd>S</kbd>: save your project to a file</li>
    </ul>`,
  'about.bodyHtml': `
    <p>{app} is a free, open-source block editor for the Firia Labs
    <strong>CodeBot</strong>, <strong>CodeX</strong> and <strong>CodeAIR</strong>.
    It is a gentle on-ramp: when your students are ready for full Python, the
    CodeSpace platform is waiting for them.</p>
    <p>Your programs run as real CircuitPython on the device, using the same
    libraries documented at
    <a href="https://docs.firialabs.com/" target="_blank" rel="noreferrer">docs.firialabs.com</a>.</p>
    <p>Found a bug, or want a block that is missing? Contributions are very
    welcome on GitHub.</p>`,

  // Python errors, as a student reads them
  'pyerr.NameError': 'Something has no name yet',
  'pyerr.SyntaxError': 'The device could not read that code',
  'pyerr.TypeError': 'Those pieces do not fit together',
  'pyerr.ValueError': 'That value was out of range',
  'pyerr.ZeroDivisionError': 'Cannot divide by zero',
  'pyerr.MemoryError': 'The program is too big for the device',
  'pyerr.ImportError': 'A missing part of the device library',
  'pyerr.OSError': 'The device had trouble with that',
  'pyerr.other': 'Your program stopped: {name}',

  // The devices (their names are products, and stay as they are)
  'device.generic': 'device',
  'device.codebot.fullName': 'CodeBot CB3',
  'device.codebot.tagline': 'Rolling robot: motors, line sensors, proximity',
  'device.codex.fullName': 'CodeX handheld',
  'device.codex.tagline': 'Handheld: color screen, sound, buttons, sensors',
  'device.codeair.fullName': 'CodeAIR drone',
  'device.codeair.tagline': 'Flying drone: take off, fly, light up the sky',
  'device.codebot_cb2.fullName': 'CodeBot CB2 (older model)',
  'device.codebot_cb2.tagline': 'Older CodeBot, not supported by {app} yet',
  'kind.serial': 'USB cable',
  'kind.loopback': 'Pretend device (for testing)',

  // Talking to a board over USB
  'usb.noSerialTitle': 'This browser cannot talk to devices',
  'usb.noSerialDetail': 'Try Chrome or Edge on a computer. They support Web Serial.',
  'usb.looking': 'Looking for your device…',
  'usb.noneChosen': 'No device chosen.',
  'usb.couldNotOpen': 'Could not open the device.',
  'usb.couldNotOpenTitle': 'Could not open that device',
  'usb.busy': 'Something else may be using the device. Close other coding tabs or apps and try again.',
  'usb.blocked': 'The browser blocked access. Make sure the page is loaded over https.',
  'usb.unsupportedTitle': "{device} isn't supported yet",
  'usb.unsupportedDetail': '{app} works with CodeBot CB3, CodeX and CodeAIR.',
  'usb.hello': 'Saying hello to your {device}…',
  'usb.alreadyRunning': 'Your device is running a program.',
  'usb.unplugged': 'Device unplugged.',
  'usb.ready': 'Ready when you are!',
  'usb.finished': 'Program finished.',
  'usb.notConnectedTitle': 'No device connected',
  'usb.notConnectedDetail': 'Press Connect and pick your board first.',
  'usb.sending': 'Sending your program…',
  'usb.running': 'Your program is running!',
  'usb.stopped': 'Stopped.',
  'usb.notAnsweringTitle': "Your {device} isn't answering",
  'usb.notAnsweringDetail': 'Unplug the USB cable, plug it back in, then press Connect again.',
  'usb.loadFailedTitle': "That program didn't load",
  'usb.tryAgain': 'Please try again.',
  'usb.saved': 'Saved {file}.',
  'usb.saveFailedTitle': 'Could not save {file}',
  'usb.stopping': 'Stopping…',
  'usb.stoppedReady': 'Stopped. Ready when you are!',
  'usb.noAnswer': 'Device did not answer.',

  // The toolbox
  'cat.logic': '🤔 Logic',
  'cat.loops': '🔁 Loops',
  'cat.math': '🔢 Math',
  'cat.text': '🔤 Text',
  'cat.lists': '📋 Lists',
  'cat.variables': '📦 Variables',
  'cat.functions': '🧰 Functions',
  'cat.screen': '🖥️ Screen',
  'cat.lights': '✨ Lights',
  'cat.sound': '🎵 Sound',
  'cat.sensors': '👀 Sensors',
  'cat.radio': '🛜 Radio',
  'cat.drive': '🚗 Drive',
  'cat.fly': '🚁 Fly',
  'cat.basics': '🧩 Basics',

  // Starter programs
  'starter.hello': 'Hi there!',

  // The simulator, in the app
  'btn.simulate': 'Simulate',
  'btn.simulateTitle': 'Try your program on a simulated device',
  'btn.stopSimulator': 'Stop simulator',
  'tab.sim': 'Simulator',
  'kind.sim': 'Simulator',
  'sim.noneYetTitle': 'No simulated {device} yet',
  'sim.noneYetDetail': 'The simulator has CodeBot, CodeX and CodeAIR so far.',
  'sim.cannotTitle': "{device} can't be simulated yet",
  'sim.thatDevice': 'That device',
  'sim.starting': 'Starting the simulator…',
  'sim.stoppedTitle': 'The simulator stopped',
  'sim.stoppedDetail': 'Reload the page to start it again.',
  'sim.problemTitle': 'The simulator hit a problem',
  'sim.keysCodex': 'Arrow keys press its direction pad, A and B its buttons, F goes full screen.',
  'sim.keys3d': 'Arrow keys turn the camera, plus and minus zoom.',
  'sim.viewLabel': 'Simulated {device}. {keys}',
  'sim.hello': 'Simulated {device}.',
  'sim.helloInRoom': 'Simulated {device} in the {room}.',
  'sim.ready': 'Simulator ready. Press Run!',
  'sim.closed': 'Simulator closed.',
  'sim.running': 'Your program is running in the simulator!',
  'sim.pausedAt': 'Paused at line {line}.',
  'sim.paused': 'Paused.',
  'sim.stoppedWithError': 'Your program stopped with an error.',
  'sim.stopped': 'Stopped.',
  'sim.stoppedReady': 'Stopped. Ready when you are!',
  'sim.finished': 'Program finished.',
  'browser.noSerialHintSim': 'You can still build blocks, try them in the simulator and download the Python. Chrome or Edge on a computer will connect.',

  // The simulator's panel
  'simPanel.intro': 'Try your program on a simulated CodeBot, CodeX or CodeAIR. No cable needed!',
  'simPanel.start': '🎮 Start the simulator',
  'simPanel.bar': 'Simulator',
  'simPanel.camera': 'Camera',
  'simPanel.camChase': 'Follow',
  'simPanel.camOrbit': 'Orbit',
  'simPanel.camTop': 'Top',
  'simPanel.roomTitle': 'The room it is in',
  'simPanel.room': 'Room',
  'simPanel.courseTitle': 'A line course of black tape on the floor',
  'simPanel.course': 'Line course',
  'simPanel.noCourse': 'No course',
  'simPanel.tiltXTitle': 'Tilt left and right',
  'simPanel.tiltX': 'Tilt left and right, degrees',
  'simPanel.tiltYTitle': 'Tilt toward and away',
  'simPanel.tiltY': 'Tilt toward and away, degrees',
  'simPanel.lightTitle': 'Light on the sensor (lux)',
  'simPanel.light': 'Light on the sensor, lux',
  'simPanel.pause': 'Pause',
  'simPanel.resume': 'Resume',
  'simPanel.step': 'Step: run a moment, then pause',
  'simPanel.stepLineTitle': 'Step one line: run your program to its next line, and pause there',
  'simPanel.stepLine': 'Step one line',
  'simPanel.speed': 'Simulation speed',
  'simPanel.speedValue': '{speed}×',
  'simPanel.buttons': "The board's buttons (hold Space or Enter)",
  'simPanel.buttonTitle': 'Button {n} on the board',
  'simPanel.button': 'Button {n}',
  'simPanel.buttonFace': 'BTN {n}',
  'simPanel.moreBoardsTitle': 'More simulated boards, in a new tab: their radios hear this one',
  'simPanel.moreBoards': '📡 More boards',
  'simPanel.reset': 'Put it back at the start',

  // Rooms and line courses
  'room.gym': 'Gymnasium',
  'room.classroom': 'Classroom',
  'room.cafeteria': 'Cafeteria',
  'room.auditorium': 'Auditorium',
  'course.oval': 'Oval',
  'course.eight': 'Figure eight',
  'course.gap': 'Oval with a gap',
  'course.tee': 'T',

  // CodeX's face
  'codex.screen': "CodeX's screen",
  'codex.pad': 'Direction pad',
  'codex.up': 'Up',
  'codex.left': 'Left',
  'codex.right': 'Right',
  'codex.down': 'Down',
  'codex.buttonA': 'Button A',
  'codex.buttonB': 'Button B',
  'codex.fullTitle': 'Full screen (Esc to leave)',
  'codex.full': '⛶ Full screen',
  'codex.keys': 'Keys: arrows, A, B, F',

  // The simulated board in words, for a screen reader
  'compass.east': 'east',
  'compass.northEast': 'north-east',
  'compass.north': 'north',
  'compass.northWest': 'north-west',
  'compass.west': 'west',
  'compass.southWest': 'south-west',
  'compass.south': 'south',
  'compass.southEast': 'south-east',
  'describe.codex': 'Simulated {device}, held in the hand.',
  'describe.codexLights': '{lit} of 4 NeoPixels lit, {on} of 6 red LEDs on.',
  'describe.codexScreen': 'What it prints shows in the terminal; its screen is a picture.',
  'describe.inRoom': ' in the {room}',
  'describe.at': "about {x} m {ew} and {y} m {ns} of the room's middle",
  'describe.flying': 'flying {height} m up',
  'describe.resting': 'resting',
  'describe.air': 'Simulated {device}{where}, {state}, {at}, facing {facing}.',
  'describe.motorsOn': 'Motors on',
  'describe.motorsOff': 'Motors off',
  'describe.motors': '{motors}{doing}.',
  'describe.airMoving': ', moving',
  'describe.airTurning': ', {doing}',
  'describe.airPixels': '{lit} of 8 NeoPixels lit.',
  'describe.onFloor': ', on a floor {height} m up',
  'describe.pushing': ', pushing against something',
  'describe.bot': 'Simulated {device}{where}{level}, {at}, facing {facing}, {doing}{pushing}.',
  'describe.botLights': '{on} of 8 user lights on.',
  'describe.tone': 'Its speaker plays {hz} hertz.',
  'doing.still': 'standing still',
  'doing.moving': 'driving forward',
  'doing.backing': 'backing up',
  'doing.turnLeft': 'turning left',
  'doing.turnRight': 'turning right',
  'say.bumped': 'Bumped into something.',
  'say.fell': 'Fell off the edge.',
  'say.driving': 'Driving.',
  'say.backing': 'Backing up.',
  'say.turnLeft': 'Turning left.',
  'say.turnRight': 'Turning right.',
  'say.stopped': 'Stopped.',
  'say.tookOff': 'Took off.',
  'say.landed': 'Landed.',

  // The boards page
  'boards.title': '{app} boards',
  'boards.heading': 'Boards',
  'boards.intro': 'Each board runs its own program. CodeX and CodeAIR boards reach each other by radio (on the same channel) and by infrared, on this page and in other tabs of this browser.',
  'boards.add': '➕ Add a board',
  'boards.remove': 'Remove this board',
  'boards.which': 'Which board',
  'boards.exampleLabel': 'Start from an example',
  'boards.examples': 'Examples…',
  'boards.run': '▶ Run',
  'boards.stop': '■ Stop',
  'boards.pressRun': 'Press Run to start this board.',
  'boards.program': "This board's program (Python)",
  'boards.name': 'Board {n}',
  'boards.running': 'Running…',
  'example.remote': 'Radio remote (A or B)',
  'example.listener': 'Radio listener',
  'example.codeairRemote': 'Remote for a CodeAIR',
  'example.xfly': 'Factory program (pairs with a CodeX remote)',
  'example.lights': 'Lights',
}
