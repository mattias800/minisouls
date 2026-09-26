/** Tiny DOM helper: create an element with a class, optional text and parent. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  parent?: HTMLElement,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

/** Writes text only when it changed, avoiding needless layout work every frame. */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setVisible(node: HTMLElement, visible: boolean): void {
  node.classList.toggle('hidden', !visible);
}
