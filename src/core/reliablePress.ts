/**
 * 保住编辑器选区，同时让按钮第一次就能点中。
 *
 * 工具栏和目录在 mousedown 上 preventDefault，是为了不让焦点离开正文。
 * WebKit 遇到被取消的 mousedown 就不再发 click，于是按钮要点两次。
 * 动作改在按下时直接做一次，随后真正的 click 会被吞掉，避免执行两遍。
 */

function controlOf(event: Event): Element | null {
  const target = event.target
  if (target instanceof Element) return target
  if (target instanceof Node) return target.parentElement
  return null
}

function buttonOf(event: Event): HTMLButtonElement | null {
  const node = controlOf(event)
  const button = node?.closest('button')
  if (!(button instanceof HTMLButtonElement) || button.disabled) return null
  return button
}

function press(button: HTMLButtonElement): void {
  let acted = false
  const onClick = (event: Event): void => {
    if (acted) {
      event.stopImmediatePropagation()
      event.preventDefault()
      return
    }
    acted = true
  }
  button.addEventListener('click', onClick, true)
  // 就在这次按下里触发。拖到 pointerup 再补，文件对话框会失去用户手势。
  button.click()
  window.setTimeout(() => button.removeEventListener('click', onClick, true), 80)
}

/** 挂在会挡住焦点的容器上。输入框仍可聚焦，按钮在按下时就执行一次。 */
export function retainPointer(event: MouseEvent): void {
  if (event.button !== 0) return
  const node = controlOf(event)
  if (node?.closest('input, textarea, select, option')) return
  event.preventDefault()
  const button = buttonOf(event)
  if (button) press(button)
}
