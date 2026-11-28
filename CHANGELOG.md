# Changelog

What changed for teachers and students, newest first. Each release is tagged
`v<version>` (see [RELEASING.md](RELEASING.md)); versions follow
[Semantic Versioning](https://semver.org/). A pull request a person would notice
adds a line under **Unreleased**.

## Unreleased

- About links the source code on GitHub and a new Licenses and notices page
  (licenses/), which says what each part of the app is licensed under.
- The app's English is spelled the American way: color, gray.
- In the simulator, CodeAIR's reset button can always be clicked: a propeller
  that stopped with a blade over it no longer blocks the click.

## 0.1.0-beta.1 (2026-11-25)

The first Beta of BitsWorkbench, ahead of its official launch on
December 3, 2026. The repository is now github.com/BitsWorkbench/bitsworkbench
(the old address redirects). Everything it holds:

### Editor
- Blocks for CodeBot, CodeX and CodeAIR, each in its category's colour, with dark
  text for contrast, matching the boards' documented Python.
- Blocks and Python, one click apart. Python turns back into blocks, and any
  Python with no block of its own stays as it is, in a grey Python block, with a
  quiet mark beside its line.
- A real Python editor (CodeMirror): colours, auto-indent, undo, find and replace,
  with the blocks' palette beside it as Python to drag in or click.
- My blocks: save a grey Python block to your own palette category.
- For small screens, the » / « button at the palette's foot shrinks both palettes
  to their colours and emoji, and back.
- Files: programs are `.py` files that save themselves, kept in the browser or, in
  Chrome and Edge, in a folder on the computer. Make, rename and delete files and
  folders; Run also puts a program's other `.py` files on the board, so it can
  import them.
- A first program is `my_program.py`: `main.py` is only the board's name for the
  program Run sends. Files made before keep their names.
- Waits are in seconds; `change x by 1` writes `x += 1`.

### Boards and the simulator
- Plug in a board over USB: it is detected, and only its blocks are offered. A
  full terminal to the board.
- Simulate a CodeBot, CodeX or CodeAIR with no board, in a gymnasium, a
  classroom, a cafeteria or an auditorium: driving, line and proximity sensors,
  the CodeX screen, buttons, tilt and sound, CodeAIR flight and its rotor whine,
  radio between simulated boards. Run, Stop, Pause and Step, `input()`, and
  clicking a board's buttons.
- A simulated CodeX plays its built-in sound files (`audio.mp3("sounds/welcome")`
  and the rest of its sounds/ folder), and the program waits while one plays.
- A robot driving steadily moves steadily on screen, and the Chase camera glides
  after it rather than lurching.
- One board at a time: picking another never loses the program.
- The terminal ends at a `>>>` prompt once the simulator is ready and after each
  program, so it is plain where to type Python.
- The terminal's Up and Down arrows walk back and forth through what was typed,
  one clean line at a time, long lines too, on the simulator and on a board.
- Lit LEDs and NeoPixels in the simulator look like light, bright and glowing,
  rather than coloured boxes.
- The page comes back as it was left: the simulator, if it was on, and the size
  of the side panel.

### Learn
- A welcome on every visit (Welcome back, with Resume, after the first), with
  **Try a Demo!**: a few guided steps that drive CodeBot in the simulator, then
  the same again in Python. One click opens its first step; tried before, it asks
  whether to start over or carry on.
- Short examples for each board, easiest first, two of them as quick starts.
- Mission packs open in a tutorial pane: steps, goals that tick as they are met,
  quizzes, CodeTrek in the palette, and each step taught in blocks or in Python.
- Made for small screens: the mission slides out as a drawer over the simulator
  and terminal, from a narrow rail at the right edge that shows the mission's
  steps and which are done. Run puts the drawer away so the simulator is in view.
- Guided missions (Python with CodeX): a guide points at each thing to do, with no
  drawer. Choose once whether missions run in the simulator or on your board over
  USB, and the board comes up by itself. Learn becomes Exit tutorial; the rail
  shows the mission's objectives, done, open or locked, and a locked one can be
  unlocked, with a warning. The guide puts the simulator and panels back where its
  steps need them.
- The guided missions in Python too: the guide points at lines in the Python
  editor and cards in its palette, in Python's own words. Start a mission in the
  Python view to play it in Python, or finish the pack in blocks and try it again
  in Python.
- A goals HUD at the lower left of the simulator: the objective
  and its goals, ticked as they are met. The rail shows the mission pack's and the
  mission's pictures, then every objective's number, a check on the done ones
  and a lock on the locked, each named in its tooltip.
- Each mission works in its own file, in a folder named for it: nothing of yours
  is replaced unless you choose to save yours under another name or replace it.
- The first six missions of four Firia Labs courses, free: Python Level 1 with
  CodeBot, Coding with Robots, Python with CodeX, and Fly with Python.

### Foundations
- Accessibility: keyboard paths through the app, labelled controls, 4.5:1
  contrast, and an automated WCAG 2.1 AA check on every change.
- Languages: English and Spanish, and a test language that shows any string left
  untranslated. Spanish is machine-translated and says so: under its name in the
  language menu, in About, and with a link to help improve it while it is in use.
- Privacy: no accounts, no ads, no tracking; nothing about a student or their
  work leaves the browser, and a test holds it to that.
- Works offline once loaded; a page left open across an update moves onto the new
  build without losing work.
