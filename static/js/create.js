import { showToast } from "./toast.js";
import { startStream } from "./stream.js";

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
export async function loadAliasOptions() {
  try {
    const resp = await fetch("/api/alias/options");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    aliasOptions = await resp.json();

    const select = /** @type {HTMLSelectElement} */ (
      document.getElementById("create-domain")
    );
    select.innerHTML = '<option value="">simplelogin (default)</option>';

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

  /** @type {Record<string, unknown>} */
  let body;

  if (random && !domain) {
    // Random + auto domain: use SimpleLogin's default random generator
    body = { random_uuid: true };
  } else if (random && domain) {
    // Random + custom domain: generate 8-char random prefix
    const suffix = findSuffix(domain);
    if (!suffix) {
      showToast("Cannot create alias: no suffix found for selected domain", "error");
      return;
    }
    body = {
      prefix: randAlphanumeric(8),
      signed_suffix: suffix.signed_suffix,
      mailbox_ids: [aliasOptions.default_mailbox_id],
    };
  } else {
    // Not random: use the provided prefix
    const suffix = domain ? findSuffix(domain) : findDefaultSuffix();
    if (!suffix) {
      showToast("Cannot create alias: no domain suffix available", "error");
      return;
    }
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
    startStream();
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
