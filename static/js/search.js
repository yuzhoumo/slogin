import uFuzzy from "./ufuzzy.js";

const uf = new uFuzzy({ intraIns: 1 });

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

  // build haystack combining email + note for each row
  const haystack = allRows.map((row) => {
    const email = row.querySelector("td.email")?.textContent.trim() ?? "";
    const note =
      row.querySelector("td.note")?.getAttribute("data-note") ??
      row.querySelector("td.note")?.textContent.trim() ??
      "";
    return email + " " + note;
  });

  const [idxs] = uf.search(haystack, query);
  const matchedIdxs = new Set(idxs ?? []);

  for (let i = 0; i < allRows.length; i++) {
    allRows[i].style.display = matchedIdxs.has(i) ? "" : "none";
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
}
