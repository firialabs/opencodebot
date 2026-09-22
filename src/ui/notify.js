/** Toasts and the one modal dialog, kept deliberately small and warm. */

const EMOJI = { info: '💚', warn: '💛', error: '🧡' }
const LIFETIME = { info: 4000, warn: 7000, error: 9000 }

export function toast({ kind = 'info', title, detail } = {}) {
  const stack = document.getElementById('toast-stack')
  if (!stack) return

  const el = document.createElement('div')
  el.className = 'toast'
  el.dataset.kind = kind
  el.innerHTML = `
    <span class="toast-emoji" aria-hidden="true">${EMOJI[kind] || EMOJI.info}</span>
    <span class="toast-body">
      <strong class="toast-title"></strong>
      ${detail ? '<span class="toast-detail"></span>' : ''}
    </span>`
  el.querySelector('.toast-title').textContent = title
  if (detail) el.querySelector('.toast-detail').textContent = detail

  stack.appendChild(el)
  const remove = () => el.remove()
  el.addEventListener('click', remove)
  setTimeout(remove, LIFETIME[kind] || LIFETIME.info)
}

/**
 * @param {{title: string, bodyHtml: string, confirmText?: string,
 *          cancelText?: string}} options
 * @returns {Promise<boolean>} true when confirmed
 */
export function showModal({ title, bodyHtml, confirmText = 'Got it', cancelText }) {
  const dialog = document.getElementById('modal')
  dialog.innerHTML = `
    <form method="dialog" class="modal-inner">
      <h2></h2>
      <div class="modal-body"></div>
      <div class="modal-actions">
        ${cancelText ? `<button class="btn btn-ghost" value="cancel"></button>` : ''}
        <button class="btn" value="ok"></button>
      </div>
    </form>`
  dialog.querySelector('h2').textContent = title
  dialog.querySelector('.modal-body').innerHTML = bodyHtml
  dialog.querySelector('button[value="ok"]').textContent = confirmText
  if (cancelText) dialog.querySelector('button[value="cancel"]').textContent = cancelText

  dialog.showModal()
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true })
  })
}
