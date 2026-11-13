// The knocks a device takes (a wall, the floor), kept for their sound only:
// the last few, numbered, which the snapshot carries, so the page plays each
// new one once however the frames fall. Nothing a program can sense.
//
// kind: 'clatter', a CodeAIR's plastic frame landing hard; 'thump', a body
// meeting a wall or a box, or a CodeBot dropping off a ledge. speed: m/s into
// the surface.
export class Hits {
  constructor() {
    this.n = 0
    this.list = []
  }

  add(kind, speed) {
    this.list.push({ n: ++this.n, kind, speed: Math.round(speed * 100) / 100 })
    if (this.list.length > 4) this.list.shift()
  }

  snapshot() {
    return this.list.map((h) => ({ ...h }))
  }
}
