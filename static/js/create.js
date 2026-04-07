import { showToast } from "./toast.js";
import { localizeTimestamps } from "./timestamp.js";

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

/** Timestamp (ms) when alias options were last fetched. */
let aliasOptionsLoadedAt = 0;

/** Signed suffixes expire server-side after 600s; refresh well before that. */
const SUFFIX_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Returns true if the cached alias options are stale and need refreshing.
 */
function areSuffixesExpired() {
  return !aliasOptions || Date.now() - aliasOptionsLoadedAt > SUFFIX_MAX_AGE_MS;
}

/**
 * Fetches alias creation options (suffixes, mailbox) from the API.
 */
export async function loadAliasOptions() {
  try {
    const resp = await fetch("/api/alias/options");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    aliasOptions = await resp.json();
    aliasOptionsLoadedAt = Date.now();

    const select = /** @type {HTMLSelectElement} */ (
      document.getElementById("create-domain")
    );
    select.innerHTML = "";

    /** @type {Set<string>} */
    const seen = new Set();

    const standardGroup = document.createElement("optgroup");
    standardGroup.label = "SimpleLogin Domains";
    const customGroup = document.createElement("optgroup");
    customGroup.label = "Custom Domains";

    for (let i = 0; i < (aliasOptions.suffixes ?? []).length; i++) {
      const s = aliasOptions.suffixes[i];
      const domain = s.suffix.split("@")[1];
      if (seen.has(domain)) continue;
      seen.add(domain);

      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = domain;
      (s.is_custom ? customGroup : standardGroup).appendChild(opt);
    }

    if (standardGroup.children.length) select.appendChild(standardGroup);
    if (customGroup.children.length) select.appendChild(customGroup);

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
 * Toggles the prefix input based on the random checkbox state.
 */
function syncPrefixState() {
  const random = /** @type {HTMLInputElement} */ (
    document.getElementById("create-random")
  ).checked;
  const prefixInput = /** @type {HTMLInputElement} */ (
    document.getElementById("create-prefix")
  );
  prefixInput.disabled = random;
  if (random) prefixInput.value = "";
}

/**
 * Creates a new alias via the API using the current form inputs.
 */
export async function createAlias() {
  if (areSuffixesExpired()) await loadAliasOptions();
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

  if (!random && !prefix) {
    showToast("Cannot create alias: enter a prefix or enable random", "error");
    return;
  }

  const suffixIdx = parseInt(domain, 10);
  const suffix = aliasOptions.suffixes[suffixIdx];
  if (!suffix) {
    showToast("Cannot create alias: no domain suffix available", "error");
    return;
  }

  /** @type {Record<string, unknown>} */
  let body;

  if (random && !suffix.is_custom) {
    // Random + non-custom domain: use SimpleLogin's default random generator
    body = { random_uuid: true };
  } else if (random) {
    // Random + custom domain: generate 8-char random prefix
    body = {
      prefix: randAlphanumeric(8),
      signed_suffix: suffix.signed_suffix,
      mailbox_ids: [aliasOptions.default_mailbox_id],
    };
  } else {
    // Not random: use the provided prefix
    body = {
      prefix,
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

    if (data.row_html) {
      const temp = document.createElement("tbody");
      temp.innerHTML = data.row_html;
      const newRow = /** @type {HTMLTableRowElement} */ (temp.firstElementChild);

      // Enable interactive controls on the new row
      for (const el of newRow.querySelectorAll(".toggle.disabled"))
        el.classList.remove("disabled");
      for (const el of newRow.querySelectorAll("td.note-disabled"))
        el.classList.remove("note-disabled");
      for (const el of newRow.querySelectorAll(".pin-btn.pin-disabled"))
        el.classList.remove("pin-disabled");
      for (const el of newRow.querySelectorAll(".delete-btn.pin-disabled"))
        el.classList.remove("pin-disabled");

      const aliasBody = document.getElementById("alias-body");
      aliasBody.prepend(newRow);
      localizeTimestamps(aliasBody);

      const countEl = document.querySelector(".count");
      const match = countEl.textContent.match(/\d+/);
      if (match) {
        countEl.textContent = `(${parseInt(match[0]) + 1} aliases)`;
      }
    }
  } catch (err) {
    showToast(`Failed to create alias: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
  }
}

/**
 * Registers event listeners for alias creation controls.
 */
export function initCreateListeners() {
  document.getElementById("create-prefix").addEventListener("keydown", (e) => {
    if (e.key === "Enter") createAlias();
  });
  document.getElementById("create-random").addEventListener("change", syncPrefixState);
}
