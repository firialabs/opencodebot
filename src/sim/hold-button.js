// A board's push button on screen: held down while the pointer presses it,
// or while Space or Enter is held with it focused, as a real button is held.
export function holdButton(el, onChange) {
  const set = (down) => {
    if (down === el.classList.contains('is-down')) return
    el.classList.toggle('is-down', down)
    el.setAttribute('aria-pressed', String(down))
    onChange(down)
  }
  el.setAttribute('aria-pressed', 'false')
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.focus(); set(true) })
  el.addEventListener('pointerup', () => set(false))
  el.addEventListener('pointerleave', () => set(false))
  el.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()                    // no click, no scroll
    if (!e.repeat) set(true)
  })
  el.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') set(false) })
  el.addEventListener('blur', () => set(false))
  return set
}
