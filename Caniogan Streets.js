/* ---------- Caniogan Street Directory ---------- */
/*
  Source data for the Barangay Caniogan street list, grouped alphabetically
  exactly as provided. Street names are preserved verbatim (including
  unconventional spellings such as "A. Lincon Bend") — nothing here is
  auto-corrected or renamed.

  NOTE ON DUPLICATES: the source list intentionally contained a few
  duplicate rows (Kalinangan Street, M. Suarez Avenue, Washington Street).
  Those duplicates are kept in RAW_STREET_GROUPS below so the original data
  is not silently discarded. Because this list only feeds a selectable
  dropdown (there's no backing database here), CANIOGAN_STREETS — the array
  actually used to render the picker — is a deduplicated view of the raw
  data so residents don't see the same option twice. If a real database is
  introduced later, drive CANIOGAN_STREETS from that instead.
*/

const RAW_STREET_GROUPS = [
  { letter: "A", raw: [
    "A. Flores Street", "A. Johnson Drive", "A. Lincon Bend",
    "A. Mabini Street (secondary)", "A. Quiogue Street", "Andrea Street",
    "Atis Street", "Avocado Street"
  ]},
  { letter: "B", raw: [
    "Bigasan Street (footway)", "Blue Lane (path)", "Brown Lane (path)",
    "Buenaventura Drive"
  ]},
  { letter: "C", raw: [
    "C. Dela Paz Street", "C. Raymundo Avenue (secondary)",
    "Camia Lane (footway)", "Corporal Cruz Street", "Crimson Lane (path)"
  ]},
  { letter: "D", raw: [
    "D. Eisenhower", "Delos Reyes Compound (service)"
  ]},
  { letter: "E", raw: [
    "E. Rodriguez Jr. Avenue (primary)"
  ]},
  { letter: "F", raw: [
    "F. B. Javier Street", "F. Legaspi Street (secondary)",
    "F. Roosevelt Avenue"
  ]},
  { letter: "G", raw: [
    "G. Cleveland Street", "Glorietta Street", "Green Lane (path)"
  ]},
  { letter: "H", raw: [
    "H. Truman Drive"
  ]},
  { letter: "I", raw: [
    "Isidro Street"
  ]},
  { letter: "J", raw: [
    "J. C. Coolidge", "J. Carter", "J. Monroe Bend",
    "J. P. Concepcion Street", "Jacinta Street", "Jenny's Avenue (tertiary)",
    "Jose Ong Street", "JRA Compound (service)", "Juana Street"
  ]},
  { letter: "K", raw: [
    "Kalinangan Street (tertiary)", "Kalinangan Street (tertiary)"
  ]},
  { letter: "L", raw: [
    "Luis Street (tertiary)"
  ]},
  { letter: "M", raw: [
    "M. Eusebio Avenue (tertiary)", "M. Suarez Avenue (tertiary)",
    "M. Suarez Avenue (tertiary)", "Mahogany Lane (path)", "Maria Street",
    "Melendres (path)", "Melendres Compound (service)",
    "Mercedes Avenue (secondary)", "Miguel Melendres Sr. Street"
  ]},
  { letter: "N", raw: [
    "N. Espiritu Street", "Nazareth Street"
  ]},
  { letter: "O", raw: [
    "Orange Lane (path)"
  ]},
  { letter: "P", raw: [
    "Pag-asa Street (tertiary)", "Pasig Boulevard (secondary)",
    "Pasig Boulevard Extension (secondary)", "Purple Lane (path)"
  ]},
  { letter: "R", raw: [
    "R. B. Hayes", "Red Lane (path)"
  ]},
  { letter: "S", raw: [
    "Saint Anthony", "Saint Jude Compound (service)",
    "Sampaguita Lane (footway)", "Santo Niño Lane (path)",
    "Santo Rosario de Lima Street", "Saudi Compound (service)",
    "Sergeant P. Bernardo", "SHAP Driveway (service)", "Silver Lane (path)"
  ]},
  { letter: "T", raw: [
    "Tatlong Bayani Street"
  ]},
  { letter: "V", raw: [
    "Villa Susana"
  ]},
  { letter: "W", raw: [
    "Washington Street", "Washington Street", "White Lane"
  ]},
  { letter: "Y", raw: [
    "Yellow Lane (path)"
  ]}
];

/* Friendly labels for classifications, shown next to a street in the picker */
const STREET_CLASS_LABELS = {
  primary: "Major Road",
  secondary: "Secondary Road",
  tertiary: "Local Road",
  path: "Walking Path",
  footway: "Footpath",
  service: "Service Road / Compound"
};

function parseStreetEntry(raw) {
  const m = raw.match(/^(.*)\s\(([^)]+)\)$/);
  if (m) return { name: m[1], classification: m[2].trim().toLowerCase() };
  return { name: raw, classification: null };
}

/* Deduplicated, parsed street directory actually used by the UI */
const CANIOGAN_STREETS = RAW_STREET_GROUPS.map(group => {
  const seen = new Set();
  const streets = [];
  group.raw.forEach(rawEntry => {
    const entry = parseStreetEntry(rawEntry);
    const key = entry.name + "|" + (entry.classification || "");
    if (seen.has(key)) return;
    seen.add(key);
    streets.push(entry);
  });
  return { letter: group.letter, streets };
}).filter(group => group.streets.length > 0);

/* Flat lookup, e.g. to validate a submitted street name */
const CANIOGAN_STREET_INDEX = (() => {
  const map = new Map();
  CANIOGAN_STREETS.forEach(group => {
    group.streets.forEach(s => map.set(s.name, s.classification));
  });
  return map;
})();

function isValidCanioganStreet(name) {
  return CANIOGAN_STREET_INDEX.has(name);
}

function classificationLabel(classification) {
  if (!classification) return "";
  return STREET_CLASS_LABELS[classification] || classification;
}

/* ---------- Searchable street combobox widget ---------- */
/*
  Wires up a text input + hidden input + dropdown listbox into a searchable,
  grouped, keyboard-navigable street picker. Only lets the resident commit a
  value that exists in CANIOGAN_STREETS — free text that doesn't match a
  real entry is rejected on blur/submit.

  Usage: initStreetCombo({
    searchInputId: "regStreetSearch",
    hiddenInputId: "regStreet",
    listId: "regStreetList",
    errorElId: "regStreetError"
  });

  Optional: showAllOnOpen: true — when a street is already chosen (e.g. the
  Profile page), opening the picker lists every street with the chosen one
  highlighted, instead of filtering the list down to just that street.
*/
function initStreetCombo(opts) {
  const searchInput = document.getElementById(opts.searchInputId);
  const hiddenInput = document.getElementById(opts.hiddenInputId);
  const list = document.getElementById(opts.listId);
  const errorEl = opts.errorElId ? document.getElementById(opts.errorElId) : null;
  if (!searchInput || !hiddenInput || !list) return null;

  let activeIndex = -1;
  let visibleItems = [];

  function clearError() {
    searchInput.classList.remove("invalid");
    if (errorEl) errorEl.textContent = "";
  }

  function renderList(filterTerm) {
    const term = (filterTerm || "").trim().toLowerCase();
    list.innerHTML = "";
    visibleItems = [];
    activeIndex = -1;

    CANIOGAN_STREETS.forEach(group => {
      const matches = group.streets.filter(s => !term || s.name.toLowerCase().includes(term));
      if (matches.length === 0) return;

      const groupEl = document.createElement("div");
      groupEl.className = "street-group";
      groupEl.setAttribute("role", "group");
      groupEl.setAttribute("aria-label", "Streets starting with " + group.letter);

      const heading = document.createElement("div");
      heading.className = "street-group-label";
      heading.textContent = group.letter;
      groupEl.appendChild(heading);

      matches.forEach(s => {
        const item = document.createElement("div");
        item.className = "street-option";
        item.setAttribute("role", "option");
        item.dataset.name = s.name;

        const nameEl = document.createElement("span");
        nameEl.className = "street-option-name";
        nameEl.textContent = s.name;
        item.appendChild(nameEl);

        if (s.classification) {
          const tag = document.createElement("span");
          tag.className = "street-option-tag";
          tag.textContent = classificationLabel(s.classification);
          item.appendChild(tag);
        }

        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          selectStreet(s.name);
        });

        groupEl.appendChild(item);
        visibleItems.push(item);
      });

      list.appendChild(groupEl);
    });

    if (visibleItems.length === 0) {
      const empty = document.createElement("div");
      empty.className = "street-empty";
      empty.textContent = "No matching street. Choose from the Caniogan list.";
      list.appendChild(empty);
    }
  }

  function openList() {
    list.hidden = false;
    searchInput.setAttribute("aria-expanded", "true");
  }

  // With opts.showAllOnOpen, a street that is already chosen doesn't filter
  // the list: opening shows every street and highlights the chosen one.
  function hasCommittedStreet() {
    return !!(hiddenInput.value && searchInput.value === hiddenInput.value);
  }

  function openFullList() {
    const showAll = opts.showAllOnOpen && hasCommittedStreet();
    renderList(showAll ? "" : searchInput.value);
    openList();

    if (showAll) {
      const current = visibleItems.findIndex(i => i.dataset.name === hiddenInput.value);
      if (current !== -1) setActive(current);
    }
  }

  function closeList() {
    list.hidden = true;
    searchInput.setAttribute("aria-expanded", "false");
    visibleItems.forEach(i => i.classList.remove("active"));
    activeIndex = -1;
  }

  function selectStreet(name) {
    searchInput.value = name;
    hiddenInput.value = name;
    hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
    clearError();
    closeList();
  }

  function setActive(index) {
    visibleItems.forEach(i => i.classList.remove("active"));
    if (index >= 0 && index < visibleItems.length) {
      activeIndex = index;
      visibleItems[index].classList.add("active");
      visibleItems[index].scrollIntoView({ block: "nearest" });
    } else {
      activeIndex = -1;
    }
  }

  function validateOnLeave() {
    const typed = searchInput.value.trim();
    if (!typed) {
      hiddenInput.value = "";
      return;
    }
    if (isValidCanioganStreet(typed) && typed === hiddenInput.value) return;

    // Typed text doesn't match a committed selection from the list.
    hiddenInput.value = "";
    searchInput.classList.add("invalid");
    if (errorEl) errorEl.textContent = "Please select a street from the Caniogan list.";
  }

  searchInput.addEventListener("focus", () => {
    openFullList();
    if (opts.showAllOnOpen && hasCommittedStreet()) searchInput.select();
  });

  if (opts.showAllOnOpen) {
    // Clicking the already-focused field reopens the list, and selects the
    // current street so typing replaces it instead of appending to it.
    searchInput.addEventListener("click", () => {
      if (list.hidden) openFullList();
      if (hasCommittedStreet()) searchInput.select();
    });
  }

  searchInput.addEventListener("input", () => {
    if (hiddenInput.value && searchInput.value !== hiddenInput.value) {
      hiddenInput.value = "";
    }
    clearError();
    renderList(searchInput.value);
    openList();
  });

  searchInput.addEventListener("keydown", (e) => {
    if (list.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      openFullList();
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(Math.min(activeIndex + 1, visibleItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(Math.max(activeIndex - 1, 0));
    } else if (e.key === "Enter") {
      if (!list.hidden && activeIndex >= 0 && visibleItems[activeIndex]) {
        e.preventDefault();
        selectStreet(visibleItems[activeIndex].dataset.name);
      }
    } else if (e.key === "Escape") {
      closeList();
    } else if (e.key === "Tab") {
      validateOnLeave();
      closeList();
    }
  });

  searchInput.addEventListener("blur", () => {
    // Let a mousedown selection register before we validate/close.
    setTimeout(() => {
      validateOnLeave();
      closeList();
    }, 120);
  });

  document.addEventListener("click", (e) => {
    if (!list.contains(e.target) && e.target !== searchInput) {
      closeList();
    }
  });

  // Support restoring an existing value (e.g. pre-filled edit form).
  function setValue(name) {
    if (isValidCanioganStreet(name)) {
      searchInput.value = name;
      hiddenInput.value = name;
      clearError();
    }
  }

  if (hiddenInput.value) setValue(hiddenInput.value);

  return { setValue, validateOnLeave, getClassification: () => CANIOGAN_STREET_INDEX.get(hiddenInput.value) || null };
}