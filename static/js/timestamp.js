/** @type {string} */
const tzAbbr = new Date()
  .toLocaleTimeString("en-US", { timeZoneName: "short" })
  .split(" ")
  .pop();

/**
 * Updates column headers with the local timezone abbreviation.
 */
export function initTimezoneHeaders() {
  for (const th of document.querySelectorAll("th[data-col='3']")) {
    th.childNodes[0].textContent = `Last Activity (${tzAbbr})`;
  }
  for (const th of document.querySelectorAll("th[data-col='4']")) {
    th.childNodes[0].textContent = `Created (${tzAbbr})`;
  }
}

/**
 * Converts UTC timestamps in `data-ts` attributes to local time strings.
 * @param {Element} container - Parent element containing `td.ts[data-ts]` cells
 */
export function localizeTimestamps(container) {
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
