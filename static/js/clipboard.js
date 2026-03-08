/**
 * Copies an element's text to the clipboard with a brief "copied" animation.
 * @param {HTMLElement} el - Element whose `textContent` will be copied
 */
export function copyEmail(el) {
  navigator.clipboard.writeText(el.textContent.trim());
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), 400);
}
