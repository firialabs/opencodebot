// A colour LCD as the device has it: width x height pixels of RGB565, with
// the drawing operations its graphics library performs. Colours come in as
// (r, g, b) 0..255 and are stored as the panel stores them, so a program
// reading a pixel back sees what the device would.
export class Screen {
  constructor(width = 240, height = 240) {
    this.width = width
    this.height = height
    this.px = new Uint16Array(width * height)
    this.version = 0            // bumped on every change; the view redraws when it moves
  }

  static rgb565(r, g, b) {
    return ((r & 0xf8) << 8) | ((g & 0xfc) << 3) | (b >> 3)
  }

  static rgb888(c) {
    const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f
    return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
  }

  // Pixels drawn by an operation, for charging the device time it takes.
  _touch(n) {
    this.version++
    return n
  }

  fill(c) {
    this.px.fill(c)
    return this._touch(this.px.length)
  }

  setPixel(x, y, c) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    this.px[y * this.width + x] = c
    return this._touch(1)
  }

  getPixel(x, y) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0
    return this.px[y * this.width + x]
  }

  fillRect(x, y, w, h, c) {
    let x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0)
    const x1 = Math.min(this.width, (x | 0) + (w | 0)), y1 = Math.min(this.height, (y | 0) + (h | 0))
    if (x1 <= x0 || y1 <= y0) return 0
    for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.width + x0, yy * this.width + x1)
    return this._touch((x1 - x0) * (y1 - y0))
  }

  drawRect(x, y, w, h, c) {
    if (w <= 0 || h <= 0) return 0
    return this.fillRect(x, y, w, 1, c) + this.fillRect(x, y + h - 1, w, 1, c) +
      this.fillRect(x, y + 1, 1, h - 2, c) + this.fillRect(x + w - 1, y + 1, 1, h - 2, c)
  }

  drawLine(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    let err = dx + dy, n = 0
    for (;;) {
      n += this.setPixel(x0, y0, c)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * err
      if (e2 >= dy) { err += dy; x0 += sx }
      if (e2 <= dx) { err += dx; y0 += sy }
    }
    return n
  }

  drawCircle(cx, cy, r, c) {
    cx |= 0; cy |= 0; r |= 0
    let x = r, y = 0, err = 1 - r, n = 0
    while (x >= y) {
      for (const [px, py] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) {
        n += this.setPixel(cx + px, cy + py, c)
      }
      y++
      if (err < 0) err += 2 * y + 1
      else { x--; err += 2 * (y - x) + 1 }
    }
    return n
  }

  fillCircle(cx, cy, r, c) {
    cx |= 0; cy |= 0; r |= 0
    let n = 0
    for (let dy = -r; dy <= r; dy++) {
      const half = Math.floor(Math.sqrt(r * r - dy * dy) + 0.5)
      n += this.fillRect(cx - half, cy + dy, 2 * half + 1, 1, c)
    }
    return n
  }

  // Move everything up by `rows`, filling the bottom with c (a console scroll).
  scrollUp(rows, c) {
    rows = Math.min(this.height, rows | 0)
    this.px.copyWithin(0, rows * this.width)
    this.px.fill(c, (this.height - rows) * this.width)
    return this._touch(this.px.length)
  }

  // Draw text in a bitmap font: font.glyph(ch) gives rows of bits, MSB left,
  // font.w x font.h cells. Returns pixels drawn.
  drawText(font, text, x, y, c, scale = 1, bg = null) {
    let n = 0
    let cx = x | 0
    for (const ch of String(text)) {
      const rows = font.glyph(ch)
      for (let r = 0; r < font.h; r++) {
        const bits = rows[r] ?? 0
        for (let col = 0; col < font.w; col++) {
          const on = (bits >> (font.w - 1 - col)) & 1
          if (on) n += this.fillRect(cx + col * scale, y + r * scale, scale, scale, c)
          else if (bg !== null) n += this.fillRect(cx + col * scale, y + r * scale, scale, scale, bg)
        }
      }
      cx += font.w * scale
    }
    return n
  }

  // The picture as RGBA bytes, for a canvas.
  toRGBA(out = new Uint8ClampedArray(this.width * this.height * 4)) {
    for (let i = 0; i < this.px.length; i++) {
      const c = this.px[i]
      const r = (c >> 11) & 0x1f, g = (c >> 5) & 0x3f, b = c & 0x1f
      out[i * 4] = (r << 3) | (r >> 2)
      out[i * 4 + 1] = (g << 2) | (g >> 4)
      out[i * 4 + 2] = (b << 3) | (b >> 2)
      out[i * 4 + 3] = 255
    }
    return out
  }
}
