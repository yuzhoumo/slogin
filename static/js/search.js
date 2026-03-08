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
export function fuzzyFilter(query) {
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

/**
 * Resets the fuzzy search state and clears the search input.
 */
export function resetSearch() {
  document.getElementById("search-input").value = "";
  fuseInstance = null;
}
