/** @type {HTMLDivElement | null} */
let tip = null;

function getTip() {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "tooltip";
    document.body.appendChild(tip);
  }
  return tip;
}

/**
 * Initializes tooltip listeners using event delegation on the document.
 */
export function initTooltips() {
  document.addEventListener("pointerenter", (e) => {
    const target = /** @type {HTMLElement} */ (e.target).closest("[data-tooltip]");
    if (!target) return;
    const t = getTip();
    t.textContent = target.getAttribute("data-tooltip");
    const rect = target.getBoundingClientRect();
    t.style.left = `${rect.left + rect.width / 2}px`;
    t.style.top = `${rect.bottom + 4}px`;
    t.style.transform = "translateX(-50%)";
    t.classList.add("visible");
  }, true);

  document.addEventListener("pointerleave", (e) => {
    const target = /** @type {HTMLElement} */ (e.target).closest("[data-tooltip]");
    if (!target || !tip) return;
    tip.classList.remove("visible");
  }, true);
}
