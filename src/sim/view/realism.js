// Realism: how much the page spends drawing the simulator, from an old
// Chromebook to a gaming PC. It changes only what is drawn (and the settings
// panel's sound): the world steps the same 1 ms tick with the same sensors,
// physics and seeded noise at every level, so a program behaves the same on
// every machine (sim/DESIGN.md, section 4).
//
//   ratio      device pixels per CSS pixel, at most (never above the screen's)
//   antialias  smoothed edges (set when the view is made: it follows a change
//              at the simulator's next start)
//   shadows    the soft shadows under the robots
//   effects    the glow around lit NeoPixels
//   anisotropy texture sharpness on the floor at a glancing angle
//   fps        frames a second at most; 0 for as many as the screen shows
export const LEVELS = ['low', 'medium', 'high', 'ultra']

export const PRESETS = {
  low: { ratio: 0.6, antialias: false, shadows: false, effects: false, anisotropy: 1, fps: 30 },
  medium: { ratio: 1, antialias: false, shadows: true, effects: true, anisotropy: 2, fps: 60 },
  high: { ratio: 1.5, antialias: true, shadows: true, effects: true, anisotropy: 4, fps: 60 },
  ultra: { ratio: 2, antialias: true, shadows: true, effects: true, anisotropy: 8, fps: 0 },
}

// Auto: starts where it settled last time (Medium the first time), and moves
// a level at a time from the frame rate it measures while it draws:
//   down  below 24 frames a second for 2 seconds running
//   up    at 95% of the level's frame cap (of 60 where it has none) for
//         8 seconds running
// and never back up to a level it has come down from, so it settles rather
// than flapping. Fed one measurement a second (frames over a second of
// drawing); returns the level to draw at.
export class AutoRealism {
  constructor(start = 'medium') {
    this.level = LEVELS.includes(start) ? start : 'medium'
    this.slow = 0
    this.fast = 0
    this.ceiling = LEVELS.length - 1     // the highest level it may go up to
  }

  measure(fps) {
    const i = LEVELS.indexOf(this.level)
    const cap = PRESETS[this.level].fps || 60
    if (fps < 24) { this.slow++; this.fast = 0 } else { this.slow = 0 }
    if (fps >= cap * 0.95) this.fast++
    else this.fast = 0
    if (this.slow >= 2 && i > 0) {
      this.ceiling = i - 1
      this._go(LEVELS[i - 1])
    } else if (this.fast >= 8 && i < this.ceiling) {
      this._go(LEVELS[i + 1])
    }
    return this.level
  }

  _go(level) {
    this.level = level
    this.slow = this.fast = 0
  }
}
