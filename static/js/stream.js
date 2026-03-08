import { showToast } from "./toast.js";
import { localizeTimestamps } from "./timestamp.js";
import { resetSearch } from "./search.js";
import { loadAliasOptions } from "./create.js";

/**
 * Opens an SSE connection to `/aliases/stream` and populates the alias tables.
 */
export function startStream() {
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

    resetSearch();
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
