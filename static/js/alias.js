import { showToast } from "./toast.js";
import { insertSorted } from "./sort.js";

/** @type {string} */
const PIN_SVG =
  '<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 17v5"/>' +
  '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12' +
  'a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 ' +
  '2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

/** @type {string} */
const UNPIN_SVG =
  '<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 17v5"/>' +
  '<path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/>' +
  '<path d="m2 2 20 20"/>' +
  '<path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>' +
  "</svg>";

/**
 * Toggles an alias on/off via the API.
 * @param {HTMLElement} el - The `.toggle` label element
 * @param {number} aliasId - SimpleLogin alias ID
 */
export async function toggleAlias(el, aliasId) {
  if (el.classList.contains("disabled")) return;
  el.classList.add("disabled");

  const checkbox = /** @type {HTMLInputElement} */ (el.querySelector("input"));
  const label = el.querySelector(".toggle-label");
  const wasChecked = checkbox.checked;

  try {
    const resp = await fetch(`/api/toggle/${aliasId}`, { method: "POST" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    checkbox.checked = data.enabled;
    label.textContent = data.enabled ? "on" : "off";
  } catch {
    checkbox.checked = wasChecked;
    label.textContent = wasChecked ? "on" : "off";
    showToast("Failed to toggle alias: server error", "error");
  } finally {
    el.classList.remove("disabled");
  }
}

/**
 * Deletes an alias after user confirmation.
 * @param {HTMLButtonElement} btn - The delete button
 * @param {number} aliasId - SimpleLogin alias ID
 */
export async function deleteAlias(btn, aliasId) {
  const row = btn.closest("tr");
  const email = row?.querySelector(".email-text");

  if (!confirm(`Delete ${email?.textContent.trim() ?? "this alias"}?`)) return;

  btn.classList.add("pin-disabled");

  try {
    const resp = await fetch(`/api/alias/${aliasId}`, { method: "DELETE" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    row.style.transition = "opacity 0.3s";
    row.style.opacity = "0";

    setTimeout(() => {
      row.remove();

      const pinnedBody = document.getElementById("pinned-body");
      if (!pinnedBody.children.length) {
        document.getElementById("pinned-section").classList.add("hidden");
      }

      const total = document.querySelectorAll(
        "#pinned-body tr, #alias-body tr:not(#loader)"
      ).length;
      document.querySelector(".count").textContent = `(${total} aliases)`;
    }, 300);
  } catch {
    btn.classList.remove("pin-disabled");
    showToast("Failed to delete alias: server error", "error");
  }
}

/**
 * Pins or unpins an alias and moves the row between tables.
 * @param {HTMLButtonElement} btn - The pin/unpin button
 * @param {number} aliasId - SimpleLogin alias ID
 * @param {boolean} pinState - `true` to pin, `false` to unpin
 */
export async function togglePin(btn, aliasId, pinState) {
  btn.classList.add("pin-disabled");

  try {
    const resp = await fetch(`/api/alias/${aliasId}/pin`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: pinState }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const row = btn.closest("tr");
    const pinnedBody = document.getElementById("pinned-body");
    const aliasBody = document.getElementById("alias-body");
    const pinnedSection = document.getElementById("pinned-section");

    if (pinState) {
      row.setAttribute("data-pinned", "true");
      insertSorted(pinnedBody, row, "pinned-table");
      pinnedSection.classList.remove("hidden");
    } else {
      row.setAttribute("data-pinned", "false");
      insertSorted(aliasBody, row, "main-table");
      if (!pinnedBody.children.length) {
        pinnedSection.classList.add("hidden");
      }
    }

    btn.setAttribute("onclick", `togglePin(this, ${aliasId}, ${!pinState})`);
    btn.title = pinState ? "Unpin" : "Pin";
    btn.innerHTML = pinState ? UNPIN_SVG : PIN_SVG;
  } catch {
    showToast("Failed to update pin: server error", "error");
  } finally {
    btn.classList.remove("pin-disabled");
  }
}
