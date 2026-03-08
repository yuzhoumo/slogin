import { showToast } from "./toast.js";

/**
 * Hides the edit UI and restores the read-only note text.
 * @param {HTMLTableCellElement} td - The `.note` table cell
 */
function finishEdit(td) {
  td.querySelector(".note-edit").style.display = "none";
  td.querySelector(".note-text").style.display = "";
}

/**
 * Closes all open note-edit fields by discarding changes.
 */
function closeAllEdits() {
  for (const editSpan of document.querySelectorAll(".note-edit")) {
    if (editSpan.style.display !== "none") {
      finishEdit(editSpan.closest("td.note"));
    }
  }
}

/**
 * Opens the inline note editor for a given note cell.
 * @param {HTMLElement} el - Element inside the `.note` `<td>`
 */
export function startEdit(el) {
  closeAllEdits();

  const td = el.closest("td.note");
  td.querySelector(".note-text").style.display = "none";

  const editSpan = td.querySelector(".note-edit");
  editSpan.style.display = "";

  const input = /** @type {HTMLInputElement} */ (td.querySelector(".note-input"));
  input.value = td.getAttribute("data-note");
  input.focus();
  input.select();
}

/**
 * Saves the current note value to the API and closes the editor.
 * @param {HTMLElement} el - Element inside the `.note` `<td>`
 */
export async function saveNote(el) {
  const td = el.closest("td.note");
  const aliasId = td.getAttribute("data-alias-id");
  const input = /** @type {HTMLInputElement} */ (td.querySelector(".note-input"));
  const newNote = input.value;

  try {
    const resp = await fetch(`/api/alias/${aliasId}/note`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: newNote }),
    });
    if (!resp.ok) throw new Error("Save failed");

    td.setAttribute("data-note", newNote);
    td.querySelector(".note-text").textContent = newNote;
    finishEdit(td);
  } catch {
    showToast("Failed to save note: server error", "error");
  }
}

/**
 * Cancels the inline note editor without saving.
 * @param {HTMLElement} el - Element inside the `.note` `<td>`
 */
export function cancelEdit(el) {
  finishEdit(el.closest("td.note"));
}

/**
 * Registers the global mousedown listener to close note editors on outside clicks.
 */
export function initNoteListeners() {
  document.addEventListener("mousedown", (e) => {
    if (
      !e.target.closest(".note-edit") &&
      !e.target.classList.contains("note-text")
    ) {
      closeAllEdits();
    }
  });
}
