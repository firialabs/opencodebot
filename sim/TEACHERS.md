# The simulator: a guide for teachers

The simulator runs a student's program on a simulated CodeBot, CodeX or CodeAIR,
in the browser, with no device and no cable. The program is the same one the
device would run, and the board's own Python runs under it, so what works here
works on the device (within the limits at the end of this page).

## Starting it

1. Choose the board in the picker at the top left (CodeBot, CodeX or CodeAIR).
2. Press **🎮 Simulate**. The board appears on the right, above the terminal
   (Talk to device). Drag the bar between them to resize them, or press ▾ to
   close the terminal down to its title.
3. Press **▶ Run**. The terminal shows what the program prints; between programs
   it is a live Python prompt.

## Running, pausing and stepping

At rest only **▶ Run** shows at the top. While the program runs, **■ Stop**
takes its place, with **⏸ Pause** beside it. Paused, Pause says **▶ Resume**
and **⤵ Step** appears: Step runs the program to its next line and stops
there, marking that line in the Python view (🐍 Python, bottom left) and on its
block, which helps a student see what each block does. Pause and Step stay
until the program stops; then it is Run alone again. A real board cannot be
paused, so with one plugged in, running shows Stop only.

Nothing is installed and nothing is uploaded: it all runs in the browser. After
the first visit the simulator works offline, in the gymnasium; another room
works offline once it has been opened. On a slow school Chromebook the picture
gets a little softer to keep moving smoothly; the program's timing does not
change.

## The controls

Under the picture, from left to right:

- **🎥 Follow, 🔄 Orbit, 🗺️ Top**: the camera. Follow rides behind the board;
  Orbit lets you drag round it (or scroll to zoom); Top looks straight down, the
  best view for line following.
- **🏫 Room** (CodeBot and CodeAIR): where the board is.
- **〰️ Line course** (CodeBot): black tape on a white mat, laid on the floor.
- **Speed**: half speed to watch closely, up to four times to get on with it.
- **BTN 0, BTN 1**: the board's buttons. Hold them as on the board.
- **↺**: put the board back at its start.

## Rooms and courses

| Room | Where the board starts | Good for |
|---|---|---|
| Gymnasium | the centre court | driving, the court lines as lines to find |
| Classroom | at the front, facing the board | weaving between desks and chair legs with the proximity sensors |
| Cafeteria | in front of the serving counter | open floor; tables and stools to avoid |
| Auditorium | on the stage, a metre from its edge, facing the seats | edge detection: the line sensors read the drop as black, and a CodeBot that drives off falls to the floor below |

A CodeAIR in the auditorium takes off from the stage, and its heights are
measured from the stage.

The line courses are an **oval**, a **figure eight**, an **oval with a gap**
(12 cm with no tape, to teach what to do when the line is lost) and a **T**
(the robot has to choose a way). Each room lays them on clear floor (in the
auditorium, on the stage), and choosing one puts the CodeBot on the line, ready
to follow it.

## Two boards at once: radio and infrared

CodeX and CodeAIR talk by radio and infrared. To try a program between two
boards, press **📡 More boards** in the simulator bar. A new tab opens with
several boards side by side, each with its own program, picture and terminal,
and examples to start from: a CodeX remote and listeners, and CodeAIR's own
factory program with a CodeX remote that pairs with it by infrared.

The boards on that page hear each other, and the board in the app's tab too, as
long as they are in the same browser on the same computer. Boards on different
computers do not hear each other (a class's devices on different desks would;
the simulator does not reach across the network).

## Full screen for the class

- **CodeX**: press **⛶ Full screen** under its face, or **F** with the face
  selected. The screen fills the display; the arrow keys are its direction pad,
  A (or Z) and B (or X) its buttons. Esc leaves full screen.
- **CodeBot and CodeAIR**: use the browser's own full screen (F11, or the
  full-screen key on a Chromebook), with the Top camera for line following.

## Without a mouse, and with a screen reader

Every control can be reached with Tab and used with the keyboard; the focused
one has a blue ring. The bar between the board and the terminal moves with the
up and down arrows. Hold Space or Enter on BTN 0 or BTN 1 to hold the button.
With the 3D picture selected, the left and right arrows go round the board, up
and down look from higher or lower, and + and - zoom. With CodeX's face
selected, the arrows, A and B are its buttons.

A screen reader names the picture and describes it: which room, where the board
is and which way it faces, whether it is moving, its lights and speaker. It
says when something changes that matters: the robot starts or stops, bumps into
something, falls off the stage, or the drone takes off or lands.

## How close to the real thing

The simulator is a model, built from the devices' own Python and their
published dimensions. Speeds, sensor readings and timings are estimates until
they are measured on real boards, so a program tuned to the last centimetre in
the simulator may need a small adjustment on a real robot, as it would on a
different floor. Some things are simpler than life: a CodeBot that drives off
the stage lands on its wheels instead of tumbling, and infrared reaches every
board, however far apart or however aimed.
