import * as Blockly from 'blockly/core'

/** Category colours, kept friendly and clearly distinct from each other. */
export const HUE = {
  basics: '#efb93b',
  move: '#f07c63',
  lights: '#ea6fa8',
  screen: '#4fb6e0',
  sound: '#9b7bd4',
  sensors: '#52b84c',
  radio: '#4fbfa8',
  loops: '#3fb6a8',
  logic: '#6f9bd1',
  math: '#7a86cf',
  text: '#8cbf3f',
  lists: '#c9a227',
  variables: '#d06e3f',
  functions: '#8894a8',
}

export const cuteTheme = Blockly.Theme.defineTheme('opencodebot', {
  base: Blockly.Themes.Zelos,
  name: 'opencodebot',
  fontStyle: { family: "'Fredoka Variable', 'Fredoka', ui-rounded, sans-serif", weight: '500', size: 11 },
  componentStyles: {
    workspaceBackgroundColour: '#fffdf7',
    toolboxBackgroundColour: '#f8f5ec',
    toolboxForegroundColour: '#4c4d4f',
    flyoutBackgroundColour: '#ffffff',
    flyoutForegroundColour: '#4c4d4f',
    flyoutOpacity: 0.97,
    scrollbarColour: '#dcd8cd',
    scrollbarOpacity: 0.7,
    insertionMarkerColour: '#4eb748',
    insertionMarkerOpacity: 0.4,
    markerColour: '#4eb748',
    cursorColour: '#f4d038',
    selectedGlowColour: '#f4d038',
    selectedGlowOpacity: 0.9,
  },
  categoryStyles: Object.fromEntries(
    Object.entries(HUE).map(([name, colour]) => [`${name}_category`, { colour }]),
  ),
  blockStyles: {
    ...Object.fromEntries(
      Object.entries(HUE).map(([name, colour]) => [`${name}_blocks`, { colourPrimary: colour }]),
    ),
    // Rounded "cap" tops, so the blocks that begin a program look like a start.
    start_hat: { colourPrimary: HUE.basics, hat: 'cap' },
    loop_hat: { colourPrimary: HUE.loops, hat: 'cap' },
  },
})
