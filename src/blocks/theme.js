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

/** The style names Blockly's built-in blocks use, and the category each belongs to. */
export const BUILT_IN = {
  logic_blocks: 'logic',
  loop_blocks: 'loops',
  math_blocks: 'math',
  text_blocks: 'text',
  list_blocks: 'lists',
  colour_blocks: 'lights',
  variable_blocks: 'variables',
  variable_dynamic_blocks: 'variables',
  procedure_blocks: 'functions',
}

/**
 * A block plugged in as a default (a shadow, such as the colour inside a
 * lights block) is drawn in its style's second colour. Blockly would derive a
 * darker shade, under 4.5:1 with the dark block text; a light tint of the
 * same colour keeps it readable and still distinct from the block it sits in.
 */
const tint = (hex, amount = 0.3) =>
  '#' +
  [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16))
    .map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0'))
    .join('')

const style = (colour, extra = {}) => ({ colourPrimary: colour, colourSecondary: tint(colour), ...extra })

export const cuteTheme = Blockly.Theme.defineTheme('opencodebot', {
  base: Blockly.Themes.Zelos,
  name: 'opencodebot',
  fontStyle: { family: "'Fredoka Variable', 'Fredoka', ui-rounded, sans-serif", weight: '500', size: 11 },
  componentStyles: {
    workspaceBackgroundColour: '#fffdf7',
    toolboxBackgroundColour: '#f8f5ec',
    toolboxForegroundColour: '#4c4d4f',
    flyoutBackgroundColour: '#d3d5d8', // --palette-bg; app.css sets the opacity
    flyoutForegroundColour: '#4c4d4f',
    flyoutOpacity: 0.85,
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
      Object.entries(HUE).map(([name, colour]) => [`${name}_blocks`, style(colour)]),
    ),
    // Blockly's own blocks (loops, lists, variables, functions) ask for these
    // style names; without them they would keep the base theme's colours.
    ...Object.fromEntries(Object.entries(BUILT_IN).map(([name, cat]) => [name, style(HUE[cat])])),
    // Rounded "cap" tops, so the blocks that begin a program look like a start.
    start_hat: style(HUE.basics, { hat: 'cap' }),
    loop_hat: style(HUE.basics, { hat: 'cap' }),
  },
})
