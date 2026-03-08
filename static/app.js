/* ===== Timezone Detection ===== */

/** @type {string} */
const localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** @type {string} */
const tzAbbr = new Date()
  .toLocaleTimeString("en-US", { timeZoneName: "short" })
  .split(" ")
  .pop();

for (const th of document.querySelectorAll("th[data-col='3']")) {
  th.childNodes[0].textContent = `Last Activity (${tzAbbr})`;
}

for (const th of document.querySelectorAll("th[data-col='4']")) {
  th.childNodes[0].textContent = `Created (${tzAbbr})`;
}

/* ===== Timestamp Localization ===== */

/**
 * Converts UTC timestamps in `data-ts` attributes to local time strings.
 * @param {Element} container - Parent element containing `td.ts[data-ts]` cells
 */
function localizeTimestamps(container) {
  for (const td of container.querySelectorAll("td.ts[data-ts]")) {
    const ts = td.getAttribute("data-ts");
    if (!ts || td.getAttribute("data-localized")) continue;

    const d = new Date(parseInt(ts, 10) * 1000);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");

    td.textContent = `${y}-${mo}-${da} ${h}:${mi}`;
    td.setAttribute("data-localized", "1");
  }
}

/* ===== Toast Notifications ===== */

/**
 * Displays a temporary toast notification.
 * @param {string} text - Message to display
 * @param {"info" | "error" | "success"} [type="info"] - Visual style
 * @param {number} [timeout=3500] - Duration in ms before fade-out
 */
function showToast(text, type = "info", timeout = 3500) {
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

/* ===== SSE Streaming ===== */

/**
 * Opens an SSE connection to `/aliases/stream` and populates the alias tables.
 */
function startStream() {
  const body = document.getElementById("alias-body");
  const pinnedBody = document.getElementById("pinned-body");
  const pinnedSection = document.getElementById("pinned-section");

  showToast("Refreshing aliases…", "info", 2000);

  if (!body.children.length || body.querySelector("#loader")) {
    body.innerHTML =
      '<tr id="loader"><td colspan="6"><div class="loading">' +
      'Loading aliases<span class="dots"><span>.</span><span>.</span><span>.</span></span>' +
      "</div></td></tr>";
    document.querySelector(".count").textContent = "(… aliases)";
  }

  pinnedBody.innerHTML = "";
  pinnedSection.classList.add("hidden");

  const source = new EventSource("/aliases/stream");
  let isFirstPage = true;
  let gotData = false;
  const prevBody = body.innerHTML;

  source.addEventListener("pinned", (e) => {
    gotData = true;
    pinnedBody.insertAdjacentHTML("beforeend", e.data);
    localizeTimestamps(pinnedBody);
    pinnedSection.classList.remove("hidden");
  });

  source.addEventListener("page", (e) => {
    gotData = true;
    if (isFirstPage) {
      body.innerHTML = "";
      isFirstPage = false;
    }
    body.insertAdjacentHTML("beforeend", e.data);
    localizeTimestamps(body);
  });

  source.addEventListener("ratelimit", (e) => {
    showToast(
      `Rate limited: waiting ${parseFloat(e.data).toFixed(1)}s`,
      "info",
      4000
    );
  });

  source.addEventListener("done", (e) => {
    document.querySelector(".count").textContent = `(${e.data} aliases)`;
    source.close();

    // Enable interactive controls now that loading is complete
    for (const el of document.querySelectorAll(".toggle.disabled")) {
      el.classList.remove("disabled");
    }
    for (const el of document.querySelectorAll("td.note-disabled")) {
      el.classList.remove("note-disabled");
    }
    for (const el of document.querySelectorAll(".pin-btn.pin-disabled")) {
      el.classList.remove("pin-disabled");
    }
    for (const el of document.querySelectorAll(".delete-btn.pin-disabled")) {
      el.classList.remove("pin-disabled");
    }

    document.getElementById("search-input").value = "";
    fuseInstance = null;

    loadAliasOptions();
  });

  source.onerror = () => {
    source.close();
    if (!gotData) {
      body.innerHTML = prevBody;
      showToast("Failed to load aliases: server unreachable", "error");
    }
  };
}

/* ===== Clipboard ===== */

/**
 * Copies an element's text to the clipboard with a brief "copied" animation.
 * @param {HTMLElement} el - Element whose `textContent` will be copied
 */
function copyEmail(el) {
  navigator.clipboard.writeText(el.textContent.trim());
  el.classList.add("copied");
  setTimeout(() => el.classList.remove("copied"), 400);
}

/* ===== Alias Toggle ===== */

/**
 * Toggles an alias on/off via the API.
 * @param {HTMLElement} el - The `.toggle` label element
 * @param {number} aliasId - SimpleLogin alias ID
 */
async function toggleAlias(el, aliasId) {
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

/* ===== Alias Deletion ===== */

/**
 * Deletes an alias after user confirmation.
 * @param {HTMLButtonElement} btn - The delete button
 * @param {number} aliasId - SimpleLogin alias ID
 */
async function deleteAlias(btn, aliasId) {
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

/* ===== Pin Toggle ===== */

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
 * Pins or unpins an alias and moves the row between tables.
 * @param {HTMLButtonElement} btn - The pin/unpin button
 * @param {number} aliasId - SimpleLogin alias ID
 * @param {boolean} pinState - `true` to pin, `false` to unpin
 */
async function togglePin(btn, aliasId, pinState) {
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

/* ===== Inline Note Editing ===== */

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
function startEdit(el) {
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
async function saveNote(el) {
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
function cancelEdit(el) {
  finishEdit(el.closest("td.note"));
}

/**
 * Hides the edit UI and restores the read-only note text.
 * @param {HTMLTableCellElement} td - The `.note` table cell
 */
function finishEdit(td) {
  td.querySelector(".note-edit").style.display = "none";
  td.querySelector(".note-text").style.display = "";
}

document.addEventListener("mousedown", (e) => {
  if (
    !e.target.closest(".note-edit") &&
    !e.target.classList.contains("note-text")
  ) {
    closeAllEdits();
  }
});

/* ===== Fuzzy Search ===== */

/**
 * @typedef {Object} FuseItem
 * @property {string} email
 * @property {string} note
 * @property {HTMLTableRowElement} row
 */

/** @type {Fuse | null} */
let fuseInstance = null;

/**
 * Builds (or rebuilds) the Fuse.js search index from current table rows.
 * @returns {FuseItem[]}
 */
function buildFuseIndex() {
  const allRows = [...document.querySelectorAll("#pinned-body tr, #alias-body tr")];

  /** @type {FuseItem[]} */
  const items = allRows.map((row) => ({
    email: row.querySelector("td.email")?.textContent.trim() ?? "",
    note:
      row.querySelector("td.note")?.getAttribute("data-note") ??
      row.querySelector("td.note")?.textContent.trim() ??
      "",
    row: /** @type {HTMLTableRowElement} */ (row),
  }));

  fuseInstance = new Fuse(items, {
    keys: ["email", "note"],
    threshold: 0.4,
    ignoreLocation: true,
  });

  return items;
}

/**
 * Filters visible alias rows using fuzzy matching.
 * @param {string} query - Search query (empty string shows all)
 */
function fuzzyFilter(query) {
  const allRows = [...document.querySelectorAll("#pinned-body tr, #alias-body tr")];
  const pinnedBody = document.getElementById("pinned-body");
  const pinnedSection = document.getElementById("pinned-section");

  if (!query?.trim()) {
    for (const row of allRows) row.style.display = "";
    if (pinnedBody.children.length > 0) {
      pinnedSection.classList.remove("hidden");
    }
    return;
  }

  buildFuseIndex();
  const results = fuseInstance.search(query);
  const matchedRows = new Set(results.map((r) => r.item.row));

  for (const row of allRows) {
    row.style.display = matchedRows.has(row) ? "" : "none";
  }

  const hasVisiblePinned = [...pinnedBody.children].some(
    (r) => r.style.display !== "none"
  );
  pinnedSection.classList.toggle("hidden", !hasVisiblePinned);
}

/* ===== Table Sorting ===== */

/**
 * @typedef {Object} SortState
 * @property {number | null} col - Currently sorted column index
 * @property {boolean} asc - Sort direction
 */

/** @type {Record<string, SortState>} */
const sortStates = {
  "pinned-table": { col: null, asc: true },
  "main-table": { col: null, asc: true },
};

/**
 * Returns a comparator for sorting table rows by column.
 * @param {number} colIndex - Column index to sort by
 * @param {boolean} asc - `true` for ascending, `false` for descending
 * @returns {(a: HTMLTableRowElement, b: HTMLTableRowElement) => number}
 */
function sortComparator(colIndex, asc) {
  return (a, b) => {
    const aText = (a.children[colIndex]?.textContent ?? "").trim().toLowerCase();
    const bText = (b.children[colIndex]?.textContent ?? "").trim().toLowerCase();

    // Date columns: push empty/placeholder values to one end
    if (colIndex === 3 || colIndex === 4) {
      const aVal = aText === "—" || aText === "" ? "" : aText;
      const bVal = bText === "—" || bText === "" ? "" : bText;

      if (aVal === "" && bVal === "") return 0;
      if (aVal === "") return asc ? -1 : 1;
      if (bVal === "") return asc ? 1 : -1;

      return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
  };
}

/**
 * Re-sorts all rows in a `<tbody>` according to the given sort state.
 * @param {HTMLTableSectionElement} tbody
 * @param {SortState} state
 */
function sortBody(tbody, state) {
  if (state.col === null) return;

  const rows = [...tbody.querySelectorAll("tr:not(#loader)")];
  if (!rows.length) return;

  rows.sort(sortComparator(state.col, state.asc));
  for (const row of rows) tbody.appendChild(row);
}

/**
 * Inserts a row into a `<tbody>` in its correct sorted position.
 * @param {HTMLTableSectionElement} tbody - Target table body
 * @param {HTMLTableRowElement} row - Row to insert
 * @param {string} tableId - Table identifier (key into `sortStates`)
 */
function insertSorted(tbody, row, tableId) {
  const state = sortStates[tableId];

  if (!state || state.col === null) {
    tbody.appendChild(row);
    return;
  }

  const cmp = sortComparator(state.col, state.asc);
  const existing = [...tbody.querySelectorAll("tr:not(#loader)")];
  const ref = existing.find((r) => cmp(row, r) < 0);

  if (ref) {
    tbody.insertBefore(row, ref);
  } else {
    tbody.appendChild(row);
  }
}

/**
 * Sorts a table by the given column, toggling direction on repeated clicks.
 * @param {string} tableId - DOM id of the `<table>`
 * @param {number} colIndex - Column index to sort by
 */
function sortTable(tableId, colIndex) {
  const state = sortStates[tableId];

  if (state.col === colIndex) {
    state.asc = !state.asc;
  } else {
    state.col = colIndex;
    state.asc = true;
  }

  const table = document.getElementById(tableId);
  sortBody(table.querySelector("tbody"), state);

  for (const th of table.querySelectorAll("thead th")) {
    th.querySelector(".arrow")?.remove();

    if (parseInt(th.getAttribute("data-col"), 10) === colIndex) {
      const arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = state.asc ? " ▲" : " ▼";
      th.appendChild(arrow);
    }
  }
}

/* ===== Alias Creation ===== */

/**
 * @typedef {Object} AliasSuffix
 * @property {string} suffix - e.g. ".abc123@domain.com"
 * @property {string} signed_suffix
 * @property {boolean} is_custom
 */

/**
 * @typedef {Object} AliasOptions
 * @property {AliasSuffix[]} suffixes
 * @property {number} default_mailbox_id
 */

/** @type {AliasOptions | null} */
let aliasOptions = null;

/**
 * Fetches alias creation options (suffixes, mailbox) from the API.
 */
async function loadAliasOptions() {
  try {
    const resp = await fetch("/api/alias/options");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    aliasOptions = await resp.json();

    const select = /** @type {HTMLSelectElement} */ (
      document.getElementById("create-domain")
    );
    select.innerHTML = '<option value="">simplelogin (auto)</option>';

    /** @type {Record<string, AliasSuffix>} */
    const customDomains = {};

    for (const s of aliasOptions.suffixes ?? []) {
      if (s.is_custom) {
        const domain = s.suffix.split("@")[1];
        if (!customDomains[domain]) {
          customDomains[domain] = s;
          const opt = document.createElement("option");
          opt.value = domain;
          opt.textContent = domain;
          select.appendChild(opt);
        }
      }
    }

    /** @type {HTMLButtonElement} */ (
      document.getElementById("create-btn")
    ).disabled = false;
  } catch {
    showToast("Failed to load alias creation options", "error");
  }
}

/**
 * Generates a random alphanumeric string.
 * @param {number} length - Desired string length
 * @returns {string}
 */
function randAlphanumeric(length) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join("");
}

/**
 * Finds a custom suffix matching the given domain.
 * @param {string} domain - Domain to match (e.g. "example.com")
 * @returns {AliasSuffix | undefined}
 */
function findSuffix(domain) {
  return (aliasOptions?.suffixes ?? []).find(
    (s) => s.is_custom && s.suffix.split("@")[1] === domain
  );
}

/**
 * Finds the best default (non-custom) suffix, preferring simplelogin.com.
 * @returns {AliasSuffix | undefined}
 */
function findDefaultSuffix() {
  const suffixes = aliasOptions?.suffixes ?? [];

  const slcom = suffixes.find(
    (s) => !s.is_custom && s.suffix.includes("@simplelogin.com")
  );
  const slmail = suffixes.find(
    (s) => !s.is_custom && s.suffix.includes("@slmail.me")
  );

  return slcom ?? slmail ?? findShortestNonCustomSuffix();
}

/**
 * Finds the shortest non-custom suffix available.
 * @returns {AliasSuffix | undefined}
 */
function findShortestNonCustomSuffix() {
  const suffixes = (aliasOptions?.suffixes ?? []).filter((s) => !s.is_custom);
  if (!suffixes.length) return undefined;

  return suffixes.reduce((shortest, s) =>
    s.suffix.length < shortest.suffix.length ? s : shortest
  );
}

/**
 * Creates a new alias via the API using the current form inputs.
 */
async function createAlias() {
  if (!aliasOptions) return;

  const prefix = /** @type {HTMLInputElement} */ (
    document.getElementById("create-prefix")
  ).value.trim();
  const domain = /** @type {HTMLSelectElement} */ (
    document.getElementById("create-domain")
  ).value;
  const random = /** @type {HTMLInputElement} */ (
    document.getElementById("create-random")
  ).checked;
  const btn = /** @type {HTMLButtonElement} */ (
    document.getElementById("create-btn")
  );

  if (!prefix && !random) {
    showToast("Cannot create alias: enter a prefix or enable random", "error");
    return;
  }

  /** @type {Record<string, unknown>} */
  let body;

  if (random && !prefix && !domain) {
    body = { random_uuid: true };
  } else {
    /** @type {AliasSuffix | undefined} */
    let suffix;
    /** @type {string} */
    let finalPrefix;

    if (domain) {
      suffix = findSuffix(domain);
      if (!suffix) {
        showToast(
          "Cannot create alias: no suffix found for selected domain",
          "error"
        );
        return;
      }

      if (random && prefix) {
        finalPrefix = `${prefix}.${randAlphanumeric(8)}`;
      } else if (random) {
        finalPrefix = randAlphanumeric(8);
      } else {
        finalPrefix = prefix;
      }
    } else {
      suffix = random ? findShortestNonCustomSuffix() : findDefaultSuffix();
      if (!suffix) {
        showToast("Cannot create alias: no domain suffix available", "error");
        return;
      }
      finalPrefix = prefix;
    }

    body = {
      prefix: finalPrefix,
      signed_suffix: suffix.signed_suffix,
      mailbox_ids: [aliasOptions.default_mailbox_id],
    };
  }

  btn.disabled = true;
  showToast("Creating alias…", "info", 2500);

  try {
    const resp = await fetch("/api/alias/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (resp.status >= 400) {
      throw new Error(data.error ?? "Creation failed");
    }

    showToast(`Alias created: ${data.email}`, "success");
    /** @type {HTMLInputElement} */ (
      document.getElementById("create-prefix")
    ).value = "";
    startStream();
  } catch (err) {
    showToast(`Failed to create alias: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("create-prefix").addEventListener("keydown", (e) => {
  if (e.key === "Enter") createAlias();
});

/* ===== Init ===== */

startStream();
