# Accessibility statement

*December 3, 2026*

Firia Labs wants every student to be able to code with {app}, including students who use a
keyboard instead of a mouse, a screen reader, high contrast or reduced motion.

## What we aim for

{app} aims to meet the Web Content Accessibility Guidelines (WCAG) 2.1 at level AA.

## How we check

Every change to {app} is tested automatically before it reaches the site, including:

- **An automated WCAG 2.1 A and AA check** (axe-core) on the screens students and teachers use: the
  main screen, connecting a board and running a program, the Python editor and its palette, the file
  browser, the menus, the Learn panel, the mission tutorial and its quizzes, Help, About, and the
  simulator, running and paused. This page and the privacy policy are checked too.
- **Keyboard paths**: menus open and close with the keyboard and hand focus back where it was; a
  block can be added from the palette with the keyboard alone; Run, Stop, Pause and Step pass the
  keyboard between them; the dividers and the terminal resize with the arrow keys.
- **Contrast**: text on every block color meets 4.5:1.
- **Reduced motion**: when the computer asks for less motion, the animations are off.
- **Every word the app shows comes from one table**, so it can be translated and read aloud
  consistently (English and Spanish today).

## What works well

- The **Python view** shows the same program as the blocks, and it is a full text editor that works
  entirely from the keyboard and with screen readers. A student can switch between blocks and Python
  at any time without losing anything.
- The **simulator is described in words** for screen readers: a description of the board, kept
  current, and short announcements when something changes (it started or stopped moving, bumped into
  something, took off, landed).
- The status line and notices are announced as they appear.

## Known limits

- **Moving blocks from the keyboard** works (Help lists the keys), but it takes more steps than
  with a mouse or a touch screen. The Python view is the quickest way to write and change a
  program from the keyboard.
- **The simulator's 3D picture** is visual; its description in words covers what the board is
  doing, not every detail of the room.
- The Spanish translation was drafted by machine and has not yet been reviewed by a native speaker.
- Connecting a board needs Chrome or Edge on a computer or Chromebook (Web Serial). The simulator
  runs in current Chrome, Edge, Safari and Firefox.

## Tell us

If something in {app} is hard or impossible to use for you or a student, please tell us:
[support@firialabs.com](mailto:support@firialabs.com), or report it on
[GitHub]({issues}). We read every report, and we will answer within a few working days.
