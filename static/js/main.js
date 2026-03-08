import { copyEmail } from "./clipboard.js";
import { toggleAlias, deleteAlias, togglePin } from "./alias.js";
import { startEdit, saveNote, cancelEdit, initNoteListeners } from "./note.js";
import { fuzzyFilter } from "./search.js";
import { sortTable } from "./sort.js";
import { createAlias, initCreateListeners } from "./create.js";
import { startStream } from "./stream.js";
import { initTimezoneHeaders } from "./timestamp.js";

// Expose functions to global scope for inline onclick handlers
Object.assign(window, {
  copyEmail,
  toggleAlias,
  deleteAlias,
  togglePin,
  startEdit,
  saveNote,
  cancelEdit,
  fuzzyFilter,
  sortTable,
  createAlias,
  startStream,
});

// Initialize
initTimezoneHeaders();
initNoteListeners();
initCreateListeners();
startStream();
