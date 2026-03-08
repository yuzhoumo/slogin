/**
 * Displays a temporary toast notification.
 * @param {string} text - Message to display
 * @param {"info" | "error" | "success"} [type="info"] - Visual style
 * @param {number} [timeout=3500] - Duration in ms before fade-out
 */
export function showToast(text, type = "info", timeout = 3500) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = text;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add("toast-out");
    el.addEventListener("animationend", () => el.remove());
  }, timeout);
}
