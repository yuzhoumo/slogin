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
export function insertSorted(tbody, row, tableId) {
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
export function sortTable(tableId, colIndex) {
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
