// THE TRAINING LEDGER — app state, wiring, live polling.

import { escapeHtml as esc, isoDate, formatUpdated } from "./util.js?v=20260730b";
import { icon } from "./icons.js?v=20260730b";
import { loadState, loadWorkouts, fetchVersion, postDaily, fetchOptional, link } from "./api.js?v=20260730b";
import {
  renderToday, renderProgress, renderLibrary, renderLog, renderDrawerContent,
  renderSignals, SIGNAL_PICKERS,
  renderDayPreview, renderDayPreviewLoading,
  generateTemplateText, draftKey, saveDailyDraft
} from "./views.js?v=20260730b";

const POLL_MS = 30000;

const els = {
  app: document.getElementById("app"),
  status: document.getElementById("status"),
  annUser: document.getElementById("ann-user"),
  annSync: document.getElementById("ann-sync"),
  annSyncLabel: document.getElementById("ann-sync-label"),
  theme: document.getElementById("theme-toggle"),
  tabs: document.getElementById("tabs"),
  drawer: document.getElementById("drawer"),
  drawerTitle: document.getElementById("drawer-title"),
  drawerContent: document.getElementById("drawer-content"),
  drawerClose: document.getElementById("drawer-close")
};

// Athlete selection: ?user=<id> wins (and is remembered), then the last
// remembered athlete, then the first non-demo athlete the server reports.
async function detectUser() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("user");
  if (requested) {
    try { localStorage.setItem("fitness-user", requested); } catch {}
    return requested;
  }
  let remembered = null;
  try { remembered = localStorage.getItem("fitness-user"); } catch {}
  try {
    const { users } = await fetch("/api/users", { cache: "no-store" }).then((r) => r.json());
    const ids = users.map((u) => u.id);
    if (remembered && ids.includes(remembered)) return remembered;
    return ids.find((id) => id !== "demo") || ids[0] || "demo";
  } catch {
    return remembered || "demo";
  }
}

const state = {
  user: null,
  version: null,
  current: null,
  goals: null,
  plan: null,
  workouts: [],
  dailies: [],
  soreness: null,
  week_outline: null,
  training_summary: null,
  metrics: null,
  health: null,
  bank: [],
  exerciseById: new Map(),
  bodyMap: null,
  muscleGlossary: null,
  openSignal: null
};

/* ------------------------------------------------------------------ load */

async function fetchShared() {
  const [bank, bodyMap, glossary] = await Promise.all([
    fetch("data/exercises/exercises.json", { cache: "no-store" }).then((r) => r.json()),
    fetch("data/muscles/body-map.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
    fetch("data/muscles/muscle-glossary.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null)
  ]);
  state.bank = bank.exercises || [];
  state.exerciseById = new Map(state.bank.map((e) => [e.id, e]));
  state.bodyMap = bodyMap;
  state.muscleGlossary = glossary?.muscles || null;
}

async function load() {
  const bundle = await loadState(state.user);
  Object.assign(state, {
    version: bundle.version,
    current: bundle.current,
    goals: bundle.goals,
    plan: bundle.plan,
    dailies: bundle.dailies || [],
    soreness: bundle.soreness,
    week_outline: bundle.week_outline,
    training_summary: bundle.training_summary,
    metrics: bundle.metrics,
    health: bundle.health || null
  });
  state.workouts = await loadWorkouts(bundle.current);
  dayCache.clear();
}

const dayCache = new Map();

async function fetchDayData(date) {
  if (dayCache.has(date)) return dayCache.get(date);
  const workout = state.workouts.find((w) => w.date === date) || null;
  const outline = (state.week_outline?.days || []).find((d) => d.date === date) || null;
  let plan = null;
  if (date === isoDate()) {
    plan = state.plan;
  } else if (!workout && outline?.type && outline.type !== "rest") {
    const t = outline.type;
    plan = await fetchOptional(`data/${state.user}/plans/${date}-${t}.json`)
        || await fetchOptional(`data/${state.user}/plans/${date}-${t.replace(/_/g, "-")}.json`);
    if (!plan && t === "easy") {
      plan = await fetchOptional(`data/${state.user}/plans/${date}-active_recovery.json`)
          || await fetchOptional(`data/${state.user}/plans/${date}-active-recovery.json`);
    }
  }
  const result = { plan, workout, outline };
  dayCache.set(date, result);
  return result;
}

/* ---------------------------------------------------------------- render */

function render() {
  const name = state.current?.display_name || (state.user ? state.user[0].toUpperCase() + state.user.slice(1) : "Athlete");
  document.title = `${name} · The Training Ledger`;
  els.annUser.textContent = name;
  els.app.innerHTML = `
    ${renderToday(state)}
    ${renderProgress(state)}
    ${renderLibrary(state)}
    ${renderLog(state)}
  `;
  wire();
  // ?view= overrides the remembered tab (deep links + headless screenshots)
  const requested = new URLSearchParams(window.location.search).get("view")
    || localStorage.getItem("fitness-view");
  if (requested && document.getElementById(`view-${requested}`)) showView(requested);
  els.status.textContent = `Entry ${formatUpdated(state.current.updated_at)} · ${state.current.next_plan ? "next page set" : "no plan"}`;
  setSync(link.live ? "live" : "stale", link.live ? "Live" : "Static");
}

function setSync(mode, label) {
  els.annSync.className = `ann-sync ${mode}`;
  els.annSyncLabel.textContent = label;
}

function showView(name) {
  document.querySelectorAll(".view").forEach((view) => { view.hidden = view.id !== `view-${name}`; });
  els.tabs.querySelectorAll("[data-view]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.view === name));
  });
  try { localStorage.setItem("fitness-view", name); } catch {}
}

/* ------------------------------------------------------------------ wire */

function wire() {
  document.querySelectorAll("[data-view-jump]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewJump));
  });
  // Over-budget coach notes render clamped; the layout survives a chatty agent.
  document.querySelectorAll(".note-more").forEach((button) => {
    button.addEventListener("click", () => {
      const note = button.closest(".margin-note")?.querySelector(".note-clamp");
      if (!note) return;
      const expanded = note.classList.toggle("expanded");
      button.textContent = expanded ? "Less" : "More";
    });
  });
  document.querySelectorAll("[data-exercise-id], [data-library-row]").forEach((row) => {
    const open = () => openDrawer({ exercise_id: row.dataset.exerciseId, name: row.dataset.exerciseName, guidance: row.dataset.guidance });
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        if (row.tagName !== "BUTTON") { event.preventDefault(); open(); }
      }
    });
  });
  wireSignals();
  wireLibrary();
  wireLogger();
  wireWeekRail();
}

/* ------------------------------------------------------------ week rail */

function wireWeekRail() {
  let selectedDate = null;
  const slot = document.getElementById("day-preview-slot");
  if (!slot) return;

  function wirePreviewExercises() {
    slot.querySelectorAll("[data-exercise-id]").forEach((row) => {
      row.addEventListener("click", () =>
        openDrawer({ exercise_id: row.dataset.exerciseId, name: row.dataset.exerciseName, guidance: row.dataset.guidance }));
    });
  }

  function collapsePreview() {
    selectedDate = null;
    document.querySelectorAll(".week-cell.is-selected").forEach((c) => c.classList.remove("is-selected"));
    const panel = slot.querySelector(".day-preview");
    if (panel) {
      panel.classList.remove("open");
      panel.addEventListener("transitionend", () => { slot.innerHTML = ""; }, { once: true });
    }
  }

  document.querySelectorAll(".week-cell[data-date]").forEach((cell) => {
    cell.addEventListener("click", async () => {
      const date = cell.dataset.date;

      if (date === selectedDate) {
        collapsePreview();
        return;
      }

      document.querySelectorAll(".week-cell.is-selected").forEach((c) => c.classList.remove("is-selected"));
      cell.classList.add("is-selected");
      selectedDate = date;

      slot.innerHTML = renderDayPreviewLoading();

      const dayData = await fetchDayData(date);
      if (selectedDate !== date) return;

      slot.innerHTML = renderDayPreview(state, date, dayData);
      requestAnimationFrame(() => {
        const panel = slot.querySelector(".day-preview");
        if (panel) {
          panel.classList.add("open");
          panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
      wirePreviewExercises();
    });
  });
}

/* -------------------------------------------------------------- signals */

function flashSaved(ok) {
  const el = document.getElementById("signal-saved");
  if (!el) return;
  const t = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  el.textContent = ok ? `Recorded ${t}` : "Saved in browser — link down";
  el.classList.add("visible");
}

function submitSignal(field, value) {
  saveDailyDraft(state.user, field, value);
  postDaily(state.user, field, value)
    .then(() => flashSaved(true))
    .catch(() => flashSaved(false));
}

function rerenderSignals() {
  const slot = document.getElementById("signals-slot");
  if (slot) { slot.innerHTML = renderSignals(state); wireSignals(); }
}

function wireSignals() {
  document.querySelectorAll("[data-signal-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const label = btn.dataset.signalOpen;
      state.openSignal = state.openSignal === label ? null : label;
      rerenderSignals();
    });
  });
  document.querySelectorAll(".signal-opt[data-signal-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      let value = btn.dataset.signalValue;
      if (/^\d+(\.\d+)?$/.test(value)) value = Number(value);
      submitSignal(btn.dataset.signalField, value);
      rerenderSignals();
      flashSaved(link.live);
    });
  });
  document.querySelectorAll(".stepper-btn[data-stepper-field]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.stepperField;
      const picker = SIGNAL_PICKERS.Sleep;
      const editor = btn.closest(".signal-editor");
      const saveBtn = editor.querySelector(".stepper-save");
      const display = editor.querySelector(`[data-stepper-display="${field}"]`);
      let cur = parseFloat(saveBtn.dataset.signalValue);
      cur += parseFloat(btn.dataset.stepperDir) * picker.step;
      cur = Math.max(picker.min, Math.min(picker.max, cur));
      cur = Math.round(cur * 2) / 2;
      saveBtn.dataset.signalValue = cur;
      display.textContent = picker.format(cur);
    });
  });
  document.querySelectorAll(".stepper-save").forEach((btn) => {
    btn.addEventListener("click", () => {
      const v = parseFloat(btn.dataset.signalValue);
      submitSignal(btn.dataset.signalField, v);
      rerenderSignals();
      flashSaved(link.live);
    });
  });
}

/* --------------------------------------------------------------- library */

function wireLibrary() {
  const search = document.getElementById("library-search");
  const category = document.getElementById("library-category");
  const rows = [...document.querySelectorAll("[data-library-row]")];
  const apply = () => {
    const query = (search?.value || "").toLowerCase().trim();
    const cat = category?.value || "all";
    rows.forEach((row) => {
      row.hidden = Boolean(query && !row.dataset.search.includes(query)) || (cat !== "all" && row.dataset.category !== cat);
    });
  };
  search?.addEventListener("input", apply);
  category?.addEventListener("change", apply);
}

/* ---------------------------------------------------------------- logger */

function wireLogger() {
  const status = document.getElementById("logger-status");
  const editor = document.getElementById("logger-editor");
  editor?.addEventListener("input", () => {
    try { localStorage.setItem(draftKey(state), editor.value); } catch {}
  });
  // The dashboard is served over plain HTTP (Tailscale-only), so
  // navigator.clipboard does not exist (secure contexts only). Fall back to
  // selecting the textarea + execCommand("copy"), which iOS Safari allows
  // inside a tap gesture on any origin.
  function legacyCopy() {
    if (!editor) return false;
    const scrollY = window.scrollY;
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(0, editor.value.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    if (ok) {
      editor.setSelectionRange(0, 0);
      editor.blur();                    // drop the keyboard right back down
      window.scrollTo(0, scrollY);
    }
    // On failure the text stays selected, so iOS offers its own Copy callout.
    return ok;
  }
  document.getElementById("copy-report")?.addEventListener("click", async () => {
    let ok = false;
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(editor?.value || ""); ok = true; } catch { ok = false; }
    }
    if (!ok) ok = legacyCopy();
    if (status) {
      status.textContent = ok
        ? "Copied — paste it to your trainer."
        : "Copy failed — press and hold in the notes to select all.";
    }
  });
  document.getElementById("restore-template")?.addEventListener("click", () => {
    if (!confirm("Reset to the plan template? This overwrites your draft.")) return;
    const template = generateTemplateText(state);
    if (editor) {
      editor.value = template;
      localStorage.setItem(draftKey(state), template);
      if (status) status.textContent = "Reset to plan template.";
    }
  });
  document.getElementById("clear-draft")?.addEventListener("click", () => {
    if (!confirm("Clear the field notes completely?")) return;
    if (editor) {
      editor.value = "";
      localStorage.removeItem(draftKey(state));
      if (status) status.textContent = "Draft cleared.";
    }
  });
}

/* ---------------------------------------------------------------- drawer */

function openDrawer(exercise) {
  const { title, html } = renderDrawerContent(state, exercise);
  els.drawerTitle.textContent = title;
  els.drawerContent.innerHTML = html;
  els.drawerContent.querySelectorAll("[data-drawer-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      els.drawerContent.querySelectorAll("[data-drawer-tab]").forEach((b) => b.setAttribute("aria-selected", String(b === button)));
      els.drawerContent.querySelectorAll("[data-drawer-panel]").forEach((panel) => {
        panel.hidden = panel.id !== `drawer-${button.dataset.drawerTab}`;
      });
    });
  });
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.drawerClose.focus();
}

function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
}

/* --------------------------------------------------------------- polling */

let pollTimer = null;

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (document.hidden) return;
    try {
      const version = await fetchVersion(state.user);
      setSync("live", "Live");
      if (state.version && version !== state.version) {
        await load();
        state.version = version;
        render();
      } else {
        state.version = version;
      }
    } catch {
      setSync(link.live ? "stale" : "offline", link.live ? "Stale" : "Static");
    }
  }, POLL_MS);
}

/* ----------------------------------------------------------------- theme */

function setupTheme() {
  // Paper is the signature plate; carbon is the night-gym negative.
  const stored = localStorage.getItem("fitness-theme");
  if (stored === "carbon" || stored === "dark") document.documentElement.dataset.theme = "carbon";
  const sync = () => {
    const carbon = document.documentElement.dataset.theme === "carbon";
    els.theme.innerHTML = icon(carbon ? "sun" : "moon", 14);
  };
  els.theme.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "carbon" ? "paper" : "carbon";
    if (next === "carbon") document.documentElement.dataset.theme = "carbon";
    else delete document.documentElement.dataset.theme;
    localStorage.setItem("fitness-theme", next);
    sync();
  });
  sync();
}

/* ------------------------------------------------------------------ boot */

els.tabs.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});
els.drawerClose.innerHTML = icon("x", 15);
els.drawerClose.addEventListener("click", closeDrawer);
els.drawer.addEventListener("click", (event) => { if (event.target === els.drawer) closeDrawer(); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") closeDrawer(); });

/* -------------------------------------------------- drawer swipe-to-dismiss */
{
  const panel = document.getElementById("drawer-panel");
  let startY = 0, startX = 0, currentDist = 0, dragging = false;

  function isMobileSheet() {
    return window.matchMedia("(max-width: 720px)").matches;
  }

  const handle = panel.querySelector(".drawer-handle");
  const head = panel.querySelector(".drawer-head");

  function onGripStart(e) {
    if (!els.drawer.classList.contains("open")) return;
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    currentDist = 0;
    dragging = false;
  }

  [handle, head].forEach((el) => {
    if (el) el.addEventListener("touchstart", onGripStart, { passive: true });
  });

  const content = panel.querySelector(".drawer-content");
  if (content) {
    content.addEventListener("touchstart", (e) => {
      if (!els.drawer.classList.contains("open")) return;
      if (content.scrollTop > 0) { startY = 0; return; }
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      currentDist = 0;
      dragging = false;
    }, { passive: true });
  }

  panel.addEventListener("touchmove", (e) => {
    if (!startY) return;
    const dy = e.touches[0].clientY - startY;
    const dx = e.touches[0].clientX - startX;
    const mobile = isMobileSheet();
    const dist = mobile ? dy : dx;

    if (!dragging) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      const isSwipeDismiss = mobile
        ? (Math.abs(dy) > Math.abs(dx) && dy > 0)
        : (Math.abs(dx) > Math.abs(dy) && dx > 0);
      if (!isSwipeDismiss) { startY = 0; return; }
      dragging = true;
      panel.classList.add("dragging");
      panel.classList.remove("snapping");
    }

    if (dragging) e.preventDefault();

    currentDist = Math.max(0, dist);
    panel.style.transform = mobile ? `translateY(${currentDist}px)` : `translateX(${currentDist}px)`;
    els.drawer.style.setProperty("--drag-opacity", Math.max(0, 1 - currentDist / 300));
  }, { passive: false });

  panel.addEventListener("touchend", () => {
    if (!dragging) { startY = 0; return; }
    panel.classList.remove("dragging");

    if (currentDist > 100) {
      closeDrawer();
      panel.style.transform = "";
      els.drawer.style.removeProperty("--drag-opacity");
    } else {
      panel.classList.add("snapping");
      panel.style.transform = "";
      els.drawer.style.removeProperty("--drag-opacity");
      panel.addEventListener("transitionend", () => panel.classList.remove("snapping"), { once: true });
    }
    startY = 0;
    currentDist = 0;
    dragging = false;
  });
}

// ?debug=overflow — log every element wider than the viewport (readable from
// headless Chrome stderr via --enable-logging) so layout bugs are findable.
function debugOverflow() {
  const vw = document.documentElement.clientWidth;
  console.log(`[overflow] viewport=${vw} scrollWidth=${document.documentElement.scrollWidth}`);
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > vw + 1 || r.right > vw + 1) {
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className && typeof el.className === "string" ? `.${el.className.split(" ").join(".")}` : "";
      console.log(`[overflow] ${el.tagName}${id}${cls} width=${Math.round(r.width)} right=${Math.round(r.right)}`);
    }
  }
}

setupTheme();
detectUser()
  .then((user) => { state.user = user; return Promise.all([fetchShared(), load()]); })
  .then(() => {
    render();
    startPolling();
    if (new URLSearchParams(window.location.search).get("debug") === "overflow") {
      setTimeout(debugOverflow, 300);
    }
  })
  .catch((error) => {
    els.app.innerHTML = `<div class="error">The ledger would not open — ${esc(error.message)}</div>`;
    els.status.textContent = "Fault";
    setSync("offline", "No link");
    console.error(error);
  });
