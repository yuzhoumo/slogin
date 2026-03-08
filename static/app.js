/* ===== Timezone Detection ===== */

var localTZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
var tzAbbr = new Date()
  .toLocaleTimeString("en-US", { timeZoneName: "short" })
  .split(" ")
  .pop();

document.querySelectorAll("th[data-col='3']").forEach(function (th) {
  th.childNodes[0].textContent = "Last Activity (" + tzAbbr + ")";
});

document.querySelectorAll("th[data-col='4']").forEach(function (th) {
  th.childNodes[0].textContent = "Created (" + tzAbbr + ")";
});

/* ===== Timestamp Localization ===== */

function localizeTimestamps(container) {
  container.querySelectorAll("td.ts[data-ts]").forEach(function (td) {
    var ts = td.getAttribute("data-ts");
    if (!ts || td.getAttribute("data-localized")) return;

    var d = new Date(parseInt(ts) * 1000);
    var y = d.getFullYear();
    var mo = String(d.getMonth() + 1).padStart(2, "0");
    var da = String(d.getDate()).padStart(2, "0");
    var h = String(d.getHours()).padStart(2, "0");
    var mi = String(d.getMinutes()).padStart(2, "0");

    td.textContent = y + "-" + mo + "-" + da + " " + h + ":" + mi;
    td.setAttribute("data-localized", "1");
  });
}

/* ===== Toast Notifications ===== */

function showToast(text, type, timeout) {
  type = type || "info";
  timeout = timeout || 3500;

  var container = document.getElementById("toast-container");
  var el = document.createElement("div");
  el.className = "toast toast-" + type;
  el.textContent = text;
  container.appendChild(el);

  setTimeout(function () {
    el.classList.add("toast-out");
    el.addEventListener("animationend", function () {
      el.remove();
    });
  }, timeout);
}

/* ===== SSE Streaming ===== */

function startStream() {
  var body = document.getElementById("alias-body");
  var pinnedBody = document.getElementById("pinned-body");
  var pinnedSection = document.getElementById("pinned-section");

  showToast("Refreshing aliases…", "info", 2000);

  // Only show loader if table is empty
  if (!body.children.length || body.querySelector("#loader")) {
    body.innerHTML =
      '<tr id="loader"><td colspan="6"><div class="loading">' +
      'Loading aliases<span class="dots"><span>.</span><span>.</span><span>.</span></span>' +
      "</div></td></tr>";
    document.querySelector(".count").textContent = "(… aliases)";
  }

  pinnedBody.innerHTML = "";
  pinnedSection.classList.add("hidden");

  var source = new EventSource("/aliases/stream");
  var first = true;
  var gotData = false;
  var prevBody = body.innerHTML;

  source.addEventListener("pinned", function (e) {
    gotData = true;
    pinnedBody.insertAdjacentHTML("beforeend", e.data);
    localizeTimestamps(pinnedBody);
    pinnedSection.classList.remove("hidden");
  });

  source.addEventListener("page", function (e) {
    gotData = true;
    if (first) {
      body.innerHTML = "";
      first = false;
    }
    body.insertAdjacentHTML("beforeend", e.data);
    localizeTimestamps(body);
  });

  source.addEventListener("ratelimit", function (e) {
    showToast(
      "Rate limited: waiting " + parseFloat(e.data).toFixed(1) + "s",
      "info",
      4000
    );
  });

  source.addEventListener("done", function (e) {
    document.querySelector(".count").textContent = "(" + e.data + " aliases)";
    source.close();

    // Enable all toggle switches now that loading is complete
    document.querySelectorAll(".toggle.disabled").forEach(function (el) {
      el.classList.remove("disabled");
    });

    // Enable inline editing on all note cells
    document.querySelectorAll("td.note-disabled").forEach(function (el) {
      el.classList.remove("note-disabled");
    });

    // Enable pin buttons
    document.querySelectorAll(".pin-btn.pin-disabled").forEach(function (el) {
      el.classList.remove("pin-disabled");
    });

    // Enable delete buttons
    document
      .querySelectorAll(".delete-btn.pin-disabled")
      .forEach(function (el) {
        el.classList.remove("pin-disabled");
      });

    // Reset fuzzy search state
    document.getElementById("search-input").value = "";
    fuseInstance = null;

    // Fetch alias creation options
    loadAliasOptions();
  });

  source.onerror = function () {
    source.close();
    if (!gotData) {
      body.innerHTML = prevBody;
      showToast("Failed to load aliases: server unreachable", "error");
    }
  };
}

/* ===== Clipboard ===== */

function copyEmail(el) {
  navigator.clipboard.writeText(el.textContent.trim());
  el.classList.add("copied");
  setTimeout(function () {
    el.classList.remove("copied");
  }, 400);
}

/* ===== Alias Toggle ===== */

function toggleAlias(el, aliasId) {
  if (el.classList.contains("disabled")) return;
  el.classList.add("disabled");

  var checkbox = el.querySelector("input");
  var label = el.querySelector(".toggle-label");
  var wasChecked = checkbox.checked;

  fetch("/api/toggle/" + aliasId, { method: "POST" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      if (data.error) throw new Error(data.error);
      checkbox.checked = data.enabled;
      label.textContent = data.enabled ? "on" : "off";
    })
    .catch(function () {
      checkbox.checked = wasChecked;
      label.textContent = wasChecked ? "on" : "off";
      showToast("Failed to toggle alias: server error", "error");
    })
    .finally(function () {
      el.classList.remove("disabled");
    });
}

/* ===== Alias Deletion ===== */

function deleteAlias(btn, aliasId) {
  var row = btn.closest("tr");
  var email = row.querySelector(".email-text");

  if (!confirm("Delete " + (email ? email.textContent.trim() : "this alias") + "?"))
    return;

  btn.classList.add("pin-disabled");

  fetch("/api/alias/" + aliasId, { method: "DELETE" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);

      row.style.transition = "opacity 0.3s";
      row.style.opacity = "0";

      setTimeout(function () {
        row.remove();

        // Hide pinned section if empty
        var pinnedBody = document.getElementById("pinned-body");
        if (!pinnedBody.children.length) {
          document.getElementById("pinned-section").classList.add("hidden");
        }

        // Update count
        var total = document.querySelectorAll(
          "#pinned-body tr, #alias-body tr:not(#loader)"
        ).length;
        document.querySelector(".count").textContent =
          "(" + total + " aliases)";
      }, 300);
    })
    .catch(function () {
      btn.classList.remove("pin-disabled");
      showToast("Failed to delete alias: server error", "error");
    });
}

/* ===== Pin Toggle ===== */

var PIN_SVG =
  '<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 17v5"/>' +
  '<path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12' +
  'a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 ' +
  '2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';

var UNPIN_SVG =
  '<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12 17v5"/>' +
  '<path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/>' +
  '<path d="m2 2 20 20"/>' +
  '<path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>' +
  "</svg>";

function togglePin(btn, aliasId, pinState) {
  btn.classList.add("pin-disabled");

  fetch("/api/alias/" + aliasId + "/pin", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pinned: pinState }),
  })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);

      var row = btn.closest("tr");
      var pinnedBody = document.getElementById("pinned-body");
      var aliasBody = document.getElementById("alias-body");
      var pinnedSection = document.getElementById("pinned-section");

      if (pinState) {
        row.setAttribute("data-pinned", "true");
        insertSorted(pinnedBody, row, "pinned-table");
        pinnedSection.classList.remove("hidden");
      } else {
        row.setAttribute("data-pinned", "false");
        insertSorted(aliasBody, row, "main-table");
        if (!pinnedBody.children.length)
          pinnedSection.classList.add("hidden");
      }

      btn.setAttribute(
        "onclick",
        "togglePin(this, " + aliasId + ", " + !pinState + ")"
      );
      btn.title = pinState ? "Unpin" : "Pin";
      btn.innerHTML = pinState ? UNPIN_SVG : PIN_SVG;
    })
    .catch(function () {
      showToast("Failed to update pin: server error", "error");
    })
    .finally(function () {
      btn.classList.remove("pin-disabled");
    });
}

/* ===== Inline Note Editing ===== */

function closeAllEdits() {
  document.querySelectorAll(".note-edit").forEach(function (editSpan) {
    if (editSpan.style.display !== "none") {
      finishEdit(editSpan.closest("td.note"));
    }
  });
}

function startEdit(el) {
  closeAllEdits();

  var td = el.closest("td.note");
  td.querySelector(".note-text").style.display = "none";

  var editSpan = td.querySelector(".note-edit");
  editSpan.style.display = "";

  var input = td.querySelector(".note-input");
  input.value = td.getAttribute("data-note");
  input.focus();
  input.select();
}

function saveNote(el) {
  var td = el.closest("td.note");
  var aliasId = td.getAttribute("data-alias-id");
  var input = td.querySelector(".note-input");
  var newNote = input.value;

  fetch("/api/alias/" + aliasId + "/note", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note: newNote }),
  })
    .then(function (resp) {
      if (!resp.ok) throw new Error("Save failed");
      td.setAttribute("data-note", newNote);
      td.querySelector(".note-text").textContent = newNote;
      finishEdit(td);
    })
    .catch(function () {
      showToast("Failed to save note: server error", "error");
    });
}

function cancelEdit(el) {
  var td = el.closest("td.note");
  finishEdit(td);
}

function finishEdit(td) {
  td.querySelector(".note-edit").style.display = "none";
  td.querySelector(".note-text").style.display = "";
}

// Click outside any open edit box cancels it
document.addEventListener("mousedown", function (e) {
  if (
    !e.target.closest(".note-edit") &&
    !e.target.classList.contains("note-text")
  ) {
    closeAllEdits();
  }
});

/* ===== Fuzzy Search ===== */

var fuseInstance = null;

function buildFuseIndex() {
  var allRows = Array.from(
    document.querySelectorAll("#pinned-body tr, #alias-body tr")
  );

  var items = allRows.map(function (row) {
    var emailTd = row.querySelector("td.email");
    var noteTd = row.querySelector("td.note");
    return {
      email: emailTd ? emailTd.textContent.trim() : "",
      note: noteTd
        ? noteTd.getAttribute("data-note") || noteTd.textContent.trim()
        : "",
      row: row,
    };
  });

  fuseInstance = new Fuse(items, {
    keys: ["email", "note"],
    threshold: 0.4,
    ignoreLocation: true,
  });

  return items;
}

function fuzzyFilter(query) {
  var allRows = Array.from(
    document.querySelectorAll("#pinned-body tr, #alias-body tr")
  );

  if (!query || !query.trim()) {
    allRows.forEach(function (row) {
      row.style.display = "";
    });
    var pinnedBody = document.getElementById("pinned-body");
    var pinnedSection = document.getElementById("pinned-section");
    if (pinnedBody.children.length > 0) {
      pinnedSection.classList.remove("hidden");
    }
    return;
  }

  var items = buildFuseIndex();
  var results = fuseInstance.search(query);
  var matchedRows = new Set(
    results.map(function (r) {
      return r.item.row;
    })
  );

  allRows.forEach(function (row) {
    row.style.display = matchedRows.has(row) ? "" : "none";
  });

  var pinnedBody = document.getElementById("pinned-body");
  var pinnedSection = document.getElementById("pinned-section");
  var hasVisiblePinned = Array.from(pinnedBody.children).some(function (r) {
    return r.style.display !== "none";
  });

  if (hasVisiblePinned) {
    pinnedSection.classList.remove("hidden");
  } else {
    pinnedSection.classList.add("hidden");
  }
}

/* ===== Table Sorting ===== */

var sortStates = {
  "pinned-table": { col: null, asc: true },
  "main-table": { col: null, asc: true },
};

function sortComparator(colIndex, asc) {
  return function (a, b) {
    var aText = (a.children[colIndex] ? a.children[colIndex].textContent : "")
      .trim()
      .toLowerCase();
    var bText = (b.children[colIndex] ? b.children[colIndex].textContent : "")
      .trim()
      .toLowerCase();

    // Date columns: push empty values to one end
    if (colIndex === 3 || colIndex === 4) {
      var aVal = aText === "—" || aText === "" ? "" : aText;
      var bVal = bText === "—" || bText === "" ? "" : bText;

      if (aVal === "" && bVal === "") return 0;
      if (aVal === "") return asc ? -1 : 1;
      if (bVal === "") return asc ? 1 : -1;

      return asc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return asc ? aText.localeCompare(bText) : bText.localeCompare(aText);
  };
}

function sortBody(tbody, state) {
  if (state.col === null) return;

  var rows = Array.from(tbody.querySelectorAll("tr:not(#loader)"));
  if (!rows.length) return;

  rows.sort(sortComparator(state.col, state.asc));
  rows.forEach(function (row) {
    tbody.appendChild(row);
  });
}

function insertSorted(tbody, row, tableId) {
  var state = sortStates[tableId];

  if (!state || state.col === null) {
    tbody.appendChild(row);
    return;
  }

  var cmp = sortComparator(state.col, state.asc);
  var existing = Array.from(tbody.querySelectorAll("tr:not(#loader)"));
  var inserted = false;

  for (var i = 0; i < existing.length; i++) {
    if (cmp(row, existing[i]) < 0) {
      tbody.insertBefore(row, existing[i]);
      inserted = true;
      break;
    }
  }

  if (!inserted) tbody.appendChild(row);
}

function sortTable(tableId, colIndex) {
  var state = sortStates[tableId];

  if (state.col === colIndex) {
    state.asc = !state.asc;
  } else {
    state.col = colIndex;
    state.asc = true;
  }

  var table = document.getElementById(tableId);
  sortBody(table.querySelector("tbody"), state);

  // Update arrow indicators for this table only
  table.querySelectorAll("thead th").forEach(function (th) {
    var existing = th.querySelector(".arrow");
    if (existing) existing.remove();

    if (parseInt(th.getAttribute("data-col")) === colIndex) {
      var arrow = document.createElement("span");
      arrow.className = "arrow";
      arrow.textContent = state.asc ? " ▲" : " ▼";
      th.appendChild(arrow);
    }
  });
}

/* ===== Alias Creation ===== */

var aliasOptions = null;

function loadAliasOptions() {
  fetch("/api/alias/options")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      aliasOptions = data;

      var select = document.getElementById("create-domain");
      select.innerHTML = '<option value="">simplelogin (auto)</option>';

      var suffixes = data.suffixes || [];
      var customDomains = {};

      suffixes.forEach(function (s) {
        if (s.is_custom) {
          // Extract domain from suffix like ".something@domain.com"
          var domain = s.suffix.split("@")[1];
          if (!customDomains[domain]) {
            customDomains[domain] = s;
            var opt = document.createElement("option");
            opt.value = domain;
            opt.textContent = domain;
            select.appendChild(opt);
          }
        }
      });

      document.getElementById("create-btn").disabled = false;
    })
    .catch(function () {
      showToast("Failed to load alias creation options", "error");
    });
}

function randAlphanumeric(n) {
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  var result = "";
  for (var i = 0; i < n; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function findSuffix(domain) {
  var suffixes = (aliasOptions && aliasOptions.suffixes) || [];
  for (var i = 0; i < suffixes.length; i++) {
    if (suffixes[i].is_custom && suffixes[i].suffix.split("@")[1] === domain) {
      return suffixes[i];
    }
  }
  return null;
}

function findDefaultSuffix() {
  var suffixes = (aliasOptions && aliasOptions.suffixes) || [];
  var slcom = null;
  var slmail = null;

  for (var i = 0; i < suffixes.length; i++) {
    if (suffixes[i].is_custom) continue;
    if (suffixes[i].suffix.indexOf("@simplelogin.com") !== -1)
      slcom = suffixes[i];
    if (suffixes[i].suffix.indexOf("@slmail.me") !== -1)
      slmail = suffixes[i];
  }

  return slcom || slmail || findShortestNonCustomSuffix();
}

function findShortestNonCustomSuffix() {
  var suffixes = (aliasOptions && aliasOptions.suffixes) || [];
  var best = null;

  for (var i = 0; i < suffixes.length; i++) {
    if (
      !suffixes[i].is_custom &&
      (!best || suffixes[i].suffix.length < best.suffix.length)
    ) {
      best = suffixes[i];
    }
  }

  return best;
}

function createAlias() {
  if (!aliasOptions) return;

  var prefix = document.getElementById("create-prefix").value.trim();
  var domain = document.getElementById("create-domain").value;
  var random = document.getElementById("create-random").checked;
  var btn = document.getElementById("create-btn");
  var body;

  // Nothing to create
  if (!prefix && !random) {
    showToast("Cannot create alias: enter a prefix or enable random", "error");
    return;
  }

  // Random UUID with no prefix and no custom domain
  if (random && !prefix && !domain) {
    body = { random_uuid: true };
  } else {
    var suffix, finalPrefix;

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
        finalPrefix = prefix + "." + randAlphanumeric(8);
      } else if (random && !prefix) {
        finalPrefix = randAlphanumeric(8);
      } else {
        finalPrefix = prefix;
      }
    } else {
      // No custom domain — use default suffixes
      if (random) {
        suffix = findShortestNonCustomSuffix();
      } else {
        suffix = findDefaultSuffix();
      }
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

  fetch("/api/alias/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
    .then(function (r) {
      return r.json().then(function (data) {
        return { status: r.status, data: data };
      });
    })
    .then(function (result) {
      if (result.status >= 400) {
        throw new Error(result.data.error || "Creation failed");
      }
      showToast("Alias created: " + result.data.email, "success");
      document.getElementById("create-prefix").value = "";
      startStream();
    })
    .catch(function (err) {
      showToast("Failed to create alias: " + err.message, "error");
    })
    .finally(function () {
      btn.disabled = false;
    });
}

// Allow Enter key in prefix input to create
document
  .getElementById("create-prefix")
  .addEventListener("keydown", function (e) {
    if (e.key === "Enter") createAlias();
  });

/* ===== Init ===== */

startStream();
