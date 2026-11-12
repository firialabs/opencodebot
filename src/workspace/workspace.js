/**
 * The Blockly workspace: injection, per-device toolbox swapping, and keeping
 * the student's work safe in localStorage between visits.
 */
import * as Blockly from 'blockly/core'
import { toolboxFor, cuteTheme } from '../blocks/index.js'

const STORAGE_KEY = 'opencodebot.project.v1'
export const DEFAULT_PROJECT_NAME = 'My project'

/** Tidy a project name: one line, no runs of spaces, never empty. */
export function cleanProjectName(name) {
  const tidy = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  return tidy || DEFAULT_PROJECT_NAME
}

/** A file name made from a project name, safe on every operating system. */
export function fileNameFor(name, extension) {
  const base = cleanProjectName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'project'}.${extension}`
}

export class BlockWorkspace extends EventTarget {
  constructor(container, targetId = null) {
    super()
    this.targetId = targetId
    this.name = DEFAULT_PROJECT_NAME
    /** 'blocks', or 'text' once the student starts typing Python. */
    this.mode = 'blocks'
    /** The typed program, used only in text mode. */
    this.pythonText = ''
    this.workspace = Blockly.inject(container, {
      toolbox: toolboxFor(targetId),
      theme: cuteTheme,
      renderer: 'zelos',
      trashcan: true,
      sounds: false,
      // Bundled locally so the editor still works with no internet.
      media: './blockly-media/',
      grid: { spacing: 28, length: 3, colour: '#ece9e1', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.85, minScale: 0.4, maxScale: 2, scaleSpeed: 1.1 },
      move: { scrollbars: true, drag: true, wheel: true },
    })

    this.workspace.addChangeListener((event) => {
      if (event.isUiEvent) return
      this.dispatchEvent(new CustomEvent('change'))
    })
  }

  resize() {
    Blockly.svgResize(this.workspace)
  }

  /** No blocks on the canvas. */
  get hasNoBlocks() {
    return this.workspace.getTopBlocks(false).length === 0
  }

  /**
   * Nothing to lose: no blocks and no typed Python. Everything that would
   * replace or clear the project checks this, so typed code counts as work.
   */
  get isEmpty() {
    return this.hasNoBlocks && !(this.mode === 'text' && this.pythonText.trim())
  }

  /** Swap the toolbox when the teacher (or a plugged-in board) picks a device. */
  setTarget(targetId) {
    if (targetId === this.targetId) return
    this.targetId = targetId
    this.workspace.updateToolbox(toolboxFor(targetId))
    this.dispatchEvent(new CustomEvent('change'))
  }

  clear() {
    this.workspace.clear()
    this.setMode('blocks')
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** Switch between blocks and typed Python. `text` seeds text mode. */
  setMode(mode, text = this.pythonText) {
    const next = mode === 'text' ? 'text' : 'blocks'
    const nextText = next === 'text' ? text : ''
    if (next === this.mode && nextText === this.pythonText) return
    this.mode = next
    this.pythonText = nextText
    this.dispatchEvent(new CustomEvent('mode'))
    this.dispatchEvent(new CustomEvent('change'))
  }

  setPythonText(text) {
    if (this.mode !== 'text' || text === this.pythonText) return
    this.pythonText = text
    this.dispatchEvent(new CustomEvent('change'))
  }

  rename(name) {
    const next = cleanProjectName(name)
    if (next === this.name) return
    this.name = next
    this.dispatchEvent(new CustomEvent('rename'))
    this.dispatchEvent(new CustomEvent('change'))
  }

  /** A project is the blocks plus the board they were written for. */
  toProject() {
    return {
      format: 'opencodebot',
      version: 1,
      name: this.name,
      device: this.targetId,
      blocks: Blockly.serialization.workspaces.save(this.workspace),
      ...(this.mode === 'text' ? { mode: 'text', python: this.pythonText } : {}),
    }
  }

  loadProject(project) {
    if (!project?.blocks) throw new Error('That file does not look like an OpenCodeBot project.')
    if (project.device) this.setTarget(project.device)
    // Starter programs carry no name; keep whatever the student called it.
    if (project.name) this.name = cleanProjectName(project.name)
    this.dispatchEvent(new CustomEvent('rename'))
    Blockly.serialization.workspaces.load(project.blocks, this.workspace)
    this.setMode(project.mode, typeof project.python === 'string' ? project.python : '')
    this.dispatchEvent(new CustomEvent('change'))
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toProject()))
    } catch {
      // Private browsing, or a full quota — not worth interrupting a lesson.
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      this.loadProject(JSON.parse(raw))
      return true
    } catch {
      return false
    }
  }

  /** Flash a block red, e.g. when a program throws. */
  highlight(blockId) {
    this.workspace.highlightBlock(blockId || null)
  }
}

export const STARTER_PROJECTS = {
  codex: {
    device: 'codex',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codex_show',
                  inputs: { THING: { shadow: { type: 'text', fields: { TEXT: 'Hi there!' } } } },
                  next: {
                    block: {
                      type: 'codex_pixels_fill',
                      fields: { BRIGHT: 40 },
                      inputs: { COLOR: { shadow: { type: 'ocb_color', fields: { COLOR: 'PINK' } } } },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
  codebot: {
    device: 'codebot',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codebot_drive_for',
                  fields: { DIR: 'forward' },
                  inputs: {
                    POWER: { shadow: { type: 'math_number', fields: { NUM: 50 } } },
                    SECS: { shadow: { type: 'math_number', fields: { NUM: 1 } } },
                  },
                  next: { block: { type: 'codebot_leds_all', fields: { ON: '0xFF' } } },
                },
              },
            },
          },
        ],
      },
    },
  },
  codeair: {
    device: 'codeair',
    blocks: {
      blocks: {
        languageVersion: 0,
        blocks: [
          {
            type: 'ocb_on_start',
            x: 60,
            y: 60,
            inputs: {
              DO: {
                block: {
                  type: 'codeair_safe_flight',
                  inputs: {
                    DO: {
                      block: {
                        type: 'codeair_take_off',
                        fields: { HEIGHT: 0.4 },
                        next: {
                          block: {
                            type: 'codeair_hover',
                            inputs: { SECS: { shadow: { type: 'math_number', fields: { NUM: 2 } } } },
                            next: { block: { type: 'codeair_land' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        ],
      },
    },
  },
}
