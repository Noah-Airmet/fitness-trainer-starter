// THE TRAINING LEDGER — view renderers. Pure HTML-string producers over
// state; wiring stays in main.js. Typeset pages: ledger rules, marginalia,
// stamps. Meaning never rides on color alone — stamps carry borders and
// words, marks carry glyphs, the red pencil is emphasis, not information.

import { escapeHtml as esc, humanize, titleCase, isoDate, dayOffset, formatDate, shortNumber } from "./util.js?v=20260730b";
import {
  bodyPartForMuscle, exerciseDetails, pillarsForExercise, uniquePillars,
  totalVolume, rollingVolume, weeklySeries,
  goalProgress, expectedProgress,
  weeklyMuscleGroupSets, e1rmTrendRows, readinessAgeDays, watchSeries,
  normalizeSleep, normalizeEnergy, normalizeProtein, normalizeCreatine
} from "./model.js?v=20260730b";

/* ------------------------------------------------------------- utilities */

const ROMAN = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ"];

function datelineText(dateText) {
  const d = new Date(`${dateText}T12:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  }).format(d).replace(",", " ·");
}

export function pillarTag(pillar, index = null) {
  const no = index !== null && ROMAN[index] ? `${ROMAN[index]} · ` : "";
  return `<span class="tag ${pillar.priority === 1 ? "accent" : ""}">${no}${esc(pillar.label)}</span>`;
}

function pillarTags(pillars) {
  return uniquePillars(pillars).map((p) => pillarTag(p, (p.priority || 1) - 1)).join("");
}

function sectionHead(no, title, meta = "") {
  return `
    <div class="section-head">
      <h2><span class="sec-no">§${no}</span>${esc(title)}</h2>
      ${meta ? `<span class="sec-meta">${meta}</span>` : ""}
    </div>`;
}

function stamp(word, { pencil = false, ghost = false, flat = false } = {}) {
  return `<span class="stamp ${pencil ? "pencil" : ""} ${ghost ? "ghost" : ""} ${flat ? "flat" : ""}">${esc(word)}</span>`;
}

// Ink sparkline with a pencil dot on the latest point.
function sparkline(points, w = 88, h = 22) {
  if (!points || points.length < 2) return "";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * (w - 8) + 4,
    h - 4 - ((p - min) / span) * (h - 8)
  ]);
  const poly = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${poly}"/><circle class="pt" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.8"/></svg>`;
}

/* ================================================================== TODAY */

const TYPE_SHORT = {
  push: "Push", pull: "Pull", legs: "Legs", rest: "Rest", easy: "Easy",
  cardio: "Cardio", push_legs: "Push + Legs",
  active_recovery: "Recovery", legs_or_active_recovery: "Legs / Rec"
};

function typeLabel(type) {
  return TYPE_SHORT[type] || titleCase(type || "TBD");
}

function planTarget(exercise) {
  const target = exercise?.target || {};
  const sets = target.sets ? `${target.sets} × ` : "";
  let work = target.reps ? `${target.reps}`
    : (target.reps_min || target.reps_max) ? `${target.reps_min || "?"}–${target.reps_max || "?"}`
    : target.duration_seconds ? `${target.duration_seconds}s` : "—";
  const weight = target.weight_lb ?? target.weight_lb_each ?? target.plate_load_lb ?? target.weight ?? target.load_lb ?? target.load;
  let load = "";
  if (weight !== undefined && weight !== null) {
    const each = target.weight_lb_each !== undefined ? " ea" : target.plate_load_lb !== undefined ? " plate" : "";
    load = ` — ${weight} lb${each}`;
  }
  return `${sets}${work}${load}`;
}

function actualSummary(exercise) {
  const sets = exercise?.actual || exercise?.sets || [];
  if (!sets.length) return "skipped";
  const best = Math.max(0, ...sets.map((s) => s.weight_lb ?? s.weight_lb_each ?? s.plate_load_lb ?? 0));
  const reps = sets.map((s) => s.reps || (s.duration_seconds ? `${s.duration_seconds}s` : "–")).join("/");
  return `${sets.length} × ${reps}${best ? ` @ ${best} lb` : ""}`;
}

// Last-session line for a lift, from the rolling summary — so the plan row
// answers "what did I do last time" without opening the footnote.
function prevReadout(state, exerciseId) {
  const entry = (state.training_summary?.exercises || {})[exerciseId];
  const last = entry?.history?.[entry.history.length - 1];
  if (!last || !last.best_weight_lb) return "";
  return `prev ${last.best_weight_lb} lb · ${formatDate(last.date)}`;
}

function exerciseEntry(state, exercise, index, { completed }) {
  const pillars = pillarsForExercise(state, exercise);
  const readout = completed ? actualSummary(exercise) : planTarget(exercise);
  // Completed entries show the trainer's per-exercise notes — the highest-value
  // subjective data in the system; planned entries show the plan's cue.
  const note = exercise.notes || "";
  const prev = completed ? "" : prevReadout(state, exercise.exercise_id);
  const felt = completed && exercise.effort ? `felt ${exercise.effort}` : "";
  return `
    <article class="entry clickable" tabindex="0" role="button"
      data-exercise-id="${esc(exercise.exercise_id || "")}"
      data-exercise-name="${esc(exercise.name || "")}"
      data-guidance="${esc(exercise.load_guidance || exercise.notes || "")}">
      <span class="no">${String(index + 1).padStart(2, "0")}</span>
      <div>
        <h4>${esc(titleCase(exercise.name || exercise.exercise_id || "Exercise"))}</h4>
        ${pillars.length ? `<span class="tags">${pillars.map((p) => pillarTag(p)).join("")}</span>` : ""}
      </div>
      <div class="figures">${esc(readout)}<small>${esc(felt || prev || (completed ? "done" : ""))}</small></div>
      ${note ? `<p class="entry-note">${esc(note)}</p>` : ""}
    </article>`;
}

function renderWarmup(plan) {
  const items = plan?.warmup || [];
  if (!items.length) return "";
  const total = items.reduce((s, w) => s + (w.duration_minutes || 0), 0);
  return `
    <div class="warmup">
      <span class="wu-k">Warm-up${total ? ` · ${total} min` : ""}</span>
      ${items.map((w) => `<span class="wu-item" title="${esc(w.notes || "")}">${esc(humanize(w.activity))}${w.duration_minutes ? ` <small>${w.duration_minutes}′</small>` : ""}</span>`).join("")}
    </div>`;
}

export function renderWeekRail(state) {
  const outline = state.week_outline;
  if (!outline?.days) return "";
  const today = isoDate();
  const done = new Set(state.workouts.map((w) => w.date));
  return `
    <div class="week-strip" role="list" aria-label="Week of ${esc(formatDate(outline.week_of))}">
      ${outline.days.map((day) => {
        const classes = ["week-cell"];
        const isDone = done.has(day.date);
        const missed = day.date < today && !isDone && day.type !== "rest";
        if (day.date === today) classes.push("is-today");
        if (day.type === "rest") classes.push("is-rest");
        if (missed) classes.push("is-missed");
        const mark = isDone ? "■ done"
          : day.type === "rest" ? "— rest"
          : missed ? "× missed"
          : (day.intensity === "easy" ? "easy" : "hard");
        // Weekday derived from the date — agent-written day.day has shipped
        // session labels ("Easy") where a weekday belonged.
        const weekday = day.date
          ? new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))
          : (day.day || "");
        return `
          <button type="button" class="${classes.join(" ")}" data-date="${day.date}" title="${esc(day.notes || "")}">
            <span class="wd">${esc(weekday.slice(0, 3))}</span>
            <span class="wt">${esc(typeLabel(day.type))}</span>
            <span class="wm">${esc(mark)}</span>
          </button>`;
      }).join("")}
    </div>`;
}

export function renderToday(state) {
  const today = isoDate();
  const completed = state.workouts.find((w) => w.date === today) || null;
  const plan = state.plan || {};
  const planIsToday = plan.date === today;
  const outlineDay = (state.week_outline?.days || []).find((d) => d.date === today)
    || (new Date().getDay() === 0 ? { type: "rest", notes: "Permanent rest day." } : null);
  const isRest = !completed && outlineDay?.type === "rest";

  const source = completed || (planIsToday ? plan : null);
  const exercises = source?.exercises || [];
  const pillars = source ? uniquePillars(exercises.flatMap((ex) => pillarsForExercise(state, ex))) : [];
  const title = isRest ? "Rest" : source ? typeLabel(source.session_type) : "No Plan";
  const note = completed
    ? (completed.session_notes || completed.subjective?.notes || "")
    : (plan.safety_note || outlineDay?.notes || "");
  // The plan's mission for the day — distinct from the safety marginalia.
  const chase = !completed && planIsToday ? (plan.progression_target || "") : "";

  const status = completed ? stamp("Logged", { pencil: true })
    : isRest ? stamp("Rest day", { flat: true })
    : source ? stamp(outlineDay?.intensity === "easy" ? "Easy day" : "Planned", { flat: true })
    : "";

  const body = isRest
    ? `<p class="empty" style="font-size:16px; padding: 26px 0;">Recovery is when the building happens. The ledger resumes tomorrow.</p>`
    : source
      ? `<div class="section">
           ${sectionHead(1, completed ? "The session, as lifted" : "Today's work",
             completed ? `${shortNumber(totalVolume(completed))} lb·reps` : `${exercises.length} lifts`)}
           ${completed ? "" : renderWarmup(plan)}
           <div class="ledger">${exercises.map((ex, i) => exerciseEntry(state, ex, i, { completed: !!completed })).join("")}</div>
           ${!completed && source ? `<div class="fieldnotes-tools"><button class="act" type="button" data-view-jump="log">Open field notes ›</button></div>` : ""}
         </div>`
      : `<p class="empty" style="font-size:16px; padding: 26px 0;">No plan on file — ask your trainer for one.</p>`;

  return `
    <section class="view" id="view-today">
      <p class="dateline">${esc(datelineText(today))}</p>
      <div class="session-title">
        <h1>${esc(title)}</h1>
        ${status}
      </div>
      ${note ? `
        <div class="margin-note">
          <span class="who">Coach's note</span>
          <p class="${note.length > 220 ? "note-clamp" : ""}">${esc(note)}${!completed && plan.updated_by ? ` <span class="signature">— ${esc(plan.updated_by)}</span>` : ""}</p>
          ${note.length > 220 ? `<button class="note-more" type="button">More</button>` : ""}
        </div>` : ""}
      ${chase ? `
        <p class="chase"><span class="chase-k">Today's chase</span>${esc(chase)}</p>` : ""}
      ${pillars.length ? `<div class="pillar-line">${pillarTags(pillars)}</div>` : ""}
      ${renderWeekRail(state)}
      <div id="day-preview-slot"></div>
      ${body}
      <div class="section">
        ${sectionHead(2, "Signals", "tap to log")}
        <div id="signals-slot">${renderSignals(state)}</div>
        ${renderWatchLine(state)}
      </div>
    </section>`;
}

/* ------------------------------------------------------------- signals */

export const SIGNAL_PICKERS = {
  Sleep: {
    field: "sleep_hours", type: "stepper", min: 4, max: 10, step: 0.5,
    format: (v) => (v >= 10 ? "10+" : `${v}h`)
  },
  Energy: {
    field: "energy",
    options: [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))
  },
  Protein: {
    field: "protein",
    options: [{ value: "low", label: "Low" }, { value: "medium", label: "Close" }, { value: "high", label: "Hit" }]
  },
  Creatine: {
    field: "creatine",
    options: [{ value: "taken", label: "Taken" }, { value: "missed", label: "Missed" }]
  }
};

export function loadDailyDraft(user) {
  try { return JSON.parse(localStorage.getItem(`daily-draft-${user}-${isoDate()}`)) || {}; }
  catch { return {}; }
}

export function saveDailyDraft(user, field, value) {
  const draft = loadDailyDraft(user);
  draft[field] = value;
  localStorage.setItem(`daily-draft-${user}-${isoDate()}`, JSON.stringify(draft));
}

function signalValue(state, label) {
  const daily = (state.dailies || []).find((d) => d.date === isoDate()) || {};
  const draft = loadDailyDraft(state.user);
  if (label === "Sleep") return draft.sleep_hours ?? normalizeSleep(daily);
  if (label === "Energy") return draft.energy ?? normalizeEnergy(daily);
  if (label === "Protein") return draft.protein ?? normalizeProtein(daily);
  if (label === "Creatine") {
    if (draft.creatine) return draft.creatine === "taken";
    return normalizeCreatine(daily);
  }
  return null;
}

function signalDisplay(label, value) {
  if (value === null || value === undefined) return "—";
  if (label === "Sleep") return `${value}<span class="unit"> h</span>`;
  if (label === "Energy") return `${value}<span class="unit"> / 5</span>`;
  if (label === "Protein") return value === "high" ? "hit" : value === "medium" ? "close" : "low";
  if (label === "Creatine") return value === true ? "taken" : "missed";
  return esc(String(value));
}

function signalEditor(state, label) {
  const picker = SIGNAL_PICKERS[label];
  const value = signalValue(state, label);
  if (picker.type === "stepper") {
    const cur = value ?? 7;
    return `
      <div class="signal-editor">
        <span class="k">${esc(label)}</span>
        <button type="button" class="opt stepper stepper-btn" data-stepper-field="${picker.field}" data-stepper-dir="-1" aria-label="Less">−</button>
        <span class="k" style="min-width:38px; text-align:center;" data-stepper-display="${picker.field}">${esc(picker.format(cur))}</span>
        <button type="button" class="opt stepper stepper-btn" data-stepper-field="${picker.field}" data-stepper-dir="1" aria-label="More">+</button>
        <button type="button" class="opt stepper-save" data-signal-field="${picker.field}" data-signal-value="${cur}">Record</button>
        <span class="signal-saved" id="signal-saved"></span>
      </div>`;
  }
  const selected = label === "Creatine" ? (value === true ? "taken" : value === false ? "missed" : null) : value;
  return `
    <div class="signal-editor">
      <span class="k">${esc(label)}</span>
      ${picker.options.map((o) => `
        <button type="button" class="opt signal-opt ${String(selected) === String(o.value) ? "selected" : ""}"
          data-signal-field="${picker.field}" data-signal-value="${esc(String(o.value))}">${esc(o.label)}</button>`).join("")}
      <span class="signal-saved" id="signal-saved"></span>
    </div>`;
}

export function renderSignals(state) {
  const buttons = Object.keys(SIGNAL_PICKERS).map((label) => {
    const value = signalValue(state, label);
    const has = value !== null && value !== undefined;
    return `
      <button type="button" class="signal ${has ? "" : "is-blank"}" data-signal-open="${label}" aria-expanded="${state.openSignal === label}">
        <span class="k">${esc(label)}</span>
        <span class="v">${signalDisplay(label, value)}</span>
      </button>`;
  }).join("");
  const age = readinessAgeDays(state);
  const ageNote = age === null
    ? `<p class="signal-age">No signals on record yet — tap above to start.</p>`
    : age === 0
      ? `<p class="signal-age ok">Logged today.</p>`
      : `<p class="signal-age">Last logged ${age} day${age === 1 ? "" : "s"} ago.</p>`;
  return `
    <div class="signals">${buttons}</div>
    ${state.openSignal ? signalEditor(state, state.openSignal) : ""}
    ${ageNote}`;
}

function renderWatchLine(state) {
  const days = watchSeries(state, 7);
  if (!days.length) return "";
  const latest = days[days.length - 1];
  const rhr = days.map((d) => d.resting_heart_rate_bpm).filter((v) => v);
  const hrv = days.map((d) => d.hrv_sdnn_ms).filter((v) => v);
  return `
    <div class="watchline">
      <span><span class="wl-k">Watch</span>${esc(formatDate(latest.date))}</span>
      ${latest.resting_heart_rate_bpm ? `<span><span class="wl-k">RHR</span>${latest.resting_heart_rate_bpm} bpm ${sparkline(rhr, 64, 18)}</span>` : ""}
      ${latest.hrv_sdnn_ms ? `<span><span class="wl-k">HRV</span>${Math.round(latest.hrv_sdnn_ms)} ms ${sparkline(hrv, 64, 18)}</span>` : ""}
      ${latest.steps ? `<span><span class="wl-k">Steps</span>${shortNumber(latest.steps)}</span>` : ""}
    </div>`;
}

/* ----------------------------------------------------------- day preview */

export function renderDayPreviewLoading() {
  return `<div class="day-preview open"><p class="day-preview-loading">Turning the page…</p></div>`;
}

export function renderDayPreview(state, date, dayData) {
  const { plan, workout, outline } = dayData;
  const today = isoDate();
  const dayName = outline?.day || new Intl.DateTimeFormat("en-US", { weekday: "long" }).format(new Date(`${date}T12:00:00`));
  const type = workout?.session_type || plan?.session_type || outline?.type || "";

  const head = (title, mark) => `
    <div class="day-preview-head">
      <div>
        <p class="microlabel">${esc(dayName)} · ${esc(formatDate(date))}</p>
        <h3>${esc(title)}</h3>
      </div>
      ${mark}
    </div>`;

  if (outline?.type === "rest" || type === "rest") {
    return `
      <div class="day-preview">
        ${head("Rest", stamp("Rest", { flat: true }))}
        <p class="day-preview-notes">${esc(outline?.notes || "Recovery is when the building happens.")}</p>
      </div>`;
  }

  if (workout) {
    return `
      <div class="day-preview">
        ${head(typeLabel(workout.session_type), stamp("Logged", { pencil: true }))}
        <div class="ledger">
          ${(workout.exercises || []).map((ex, i) => exerciseEntry(state, ex, i, { completed: true })).join("")}
        </div>
        ${workout.session_notes ? `<p class="day-preview-notes">${esc(workout.session_notes)}</p>` : ""}
      </div>`;
  }

  if (plan) {
    return `
      <div class="day-preview">
        ${head(typeLabel(plan.session_type), stamp("Planned", { flat: true }))}
        ${plan.safety_note ? `<p class="day-preview-notes" style="margin:8px 0 6px;">${esc(plan.safety_note)}</p>` : ""}
        <div class="ledger">
          ${(plan.exercises || []).map((ex, i) => exerciseEntry(state, ex, i, { completed: false })).join("")}
        </div>
      </div>`;
  }

  if (outline) {
    const past = date < today;
    return `
      <div class="day-preview">
        ${head(typeLabel(outline.type), past ? stamp("Missed", { ghost: true }) : stamp("Ahead", { ghost: true }))}
        ${outline.notes ? `<p class="day-preview-notes">${esc(outline.notes)}</p>` : ""}
      </div>`;
  }

  return `
    <div class="day-preview">
      ${head("Blank page", "")}
      <p class="day-preview-notes">Nothing planned or logged for this day.</p>
    </div>`;
}

/* ============================================================ THE RECORD */

export function renderProgress(state) {
  const goals = state.goals || {};
  const north = goals.north_star;
  const pillars = goals.pillars || [];
  const strength = goals.strength_goals || [];
  if (!north && !pillars.length && !strength.length) {
    return `
      <section class="view" id="view-progress" hidden>
        <p class="dateline">The record</p>
        <div class="session-title"><h1>Unwritten</h1></div>
        <p class="empty" style="font-size:16px;">Run the onboarding conversation with your trainer first. This page stays honest — no invented numbers.</p>
      </section>`;
  }

  const today = isoDate();
  const monday = dayOffset(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
  const thisWeek = state.workouts.filter((w) => w.date >= monday && w.date <= today).length;
  const volume = weeklyMuscleGroupSets(state);
  const weekSets = volume ? Math.round(volume.rows.reduce((s, r) => s + r.sets, 0)) : null;

  return `
    <section class="view" id="view-progress" hidden>
      <p class="dateline">${esc(datelineText(today))}</p>
      <div class="session-title">
        <h1>The Record</h1>
        ${stamp(`Entry ${state.training_summary?.total_workouts || state.workouts.length}`, { flat: true })}
      </div>

      <div class="numerals">
        <div class="numeral"><b>${state.training_summary?.total_workouts ?? state.workouts.length}</b><span>sessions logged</span></div>
        <div class="numeral"><b>${thisWeek}</b><span>this week</span></div>
        ${weekSets !== null ? `<div class="numeral"><b>${weekSets}</b><span>sets this week</span></div>` : ""}
        <div class="numeral"><b>${shortNumber(rollingVolume(state, state.plan?.date || today, 7))}</b><span>7-day lb·reps</span></div>
      </div>

      <div class="section">
        ${sectionHead(1, "Strength", "estimated one-rep max")}
        <div class="ledger">${renderStrengthLedger(state, strength, pillars)}</div>
      </div>

      ${renderVolumeSection(state)}
      ${renderConsistencySection(state)}
      ${renderRecoverySection(state)}
      ${renderGoalsSection(state, goals)}
    </section>`;
}

function renderStrengthLedger(state, strengthGoals, pillars) {
  const summary = state.training_summary?.exercises || {};
  const allTrends = e1rmTrendRows(state, 1000);
  const byId = new Map(allTrends.map((r) => [r.id, r]));
  const goalIds = new Set(strengthGoals.map((g) => g.exercise_id).filter(Boolean));
  const trendRows = allTrends.filter((r) => !goalIds.has(r.id)).slice(0, 8);
  const rows = [];

  // Goal-linked lifts first, with pace rules.
  for (const goal of strengthGoals) {
    const trend = byId.get(goal.exercise_id) || null;
    const entry = summary[goal.exercise_id] || {};
    const pillar = pillars.find((p) => p.id === goal.pillar_id);
    // Drive the meter from the live summary best when it has passed the
    // hand-written baseline in goals.json — the ledger doesn't go stale.
    const liveBest = Math.max(entry.best_weight_lb || 0, goal.current_baseline?.weight_lb || 0);
    const effective = liveBest > (goal.current_baseline?.weight_lb || 0)
      ? { ...goal, current_baseline: { ...goal.current_baseline, weight_lb: liveBest } }
      : goal;
    const percent = goalProgress(effective);
    const expected = expectedProgress(goal);
    const stamps = [
      trend?.repPr ? stamp("Rep PR", { pencil: true }) : "",
      trend?.plateau ? stamp("Stall", { ghost: true }) : ""
    ].filter(Boolean).join(" ");
    const target = goal.target || {};
    rows.push(`
      <article class="strength-row">
        <div class="lift">
          <h4>${esc(goal.label)}</h4>
          <div class="sub">
            ${pillar ? `<span>${esc(pillar.label)}</span>` : "<span>Foundation</span>"}
            ${entry.last_trained ? `<span>last ${esc(formatDate(entry.last_trained))}</span>` : ""}
            ${entry.last_effort ? `<span>felt ${esc(entry.last_effort)}</span>` : ""}
          </div>
        </div>
        <span class="sparkcell">${trend ? sparkline(trend.points) : ""}</span>
        <div class="figures">${trend ? `${Math.round(trend.latest)} <small>e1RM lb</small>` : "<small>no data</small>"}</div>
        <div class="delta">${trend && trend.deltaPct ? `<b>${trend.deltaPct > 0 ? "+" : ""}${trend.deltaPct}%</b> / 4 sess` : ""} ${stamps}</div>
        ${percent !== null ? `
          <div class="pace">
            <span class="track"></span>
            <span class="fill" style="width:${percent}%"></span>
            ${expected ? `<span class="tick" style="left:${expected.percent}%"></span>` : ""}
          </div>
          <p class="pace-target">${percent}% of the way → ${esc(String(target.weight_lb ?? target.plate_load_lb ?? "?"))} lb${target.plate_load_lb !== undefined ? " plate" : ""} × ${esc(String(target.reps || "?"))} by ${esc(formatDate(goal.target_date || ""))}</p>
        ` : ""}
      </article>`);
  }

  // Then the rest of the moving lifts, compact.
  for (const trend of trendRows) {
    const details = state.exerciseById.get(trend.id);
    const stamps = [
      trend.repPr ? stamp("Rep PR", { pencil: true }) : "",
      trend.plateau ? stamp("Stall", { ghost: true }) : ""
    ].filter(Boolean).join(" ");
    rows.push(`
      <article class="strength-row">
        <div class="lift">
          <h4>${esc(details?.name || titleCase(trend.id))}</h4>
          <div class="sub"><span>${trend.timesTrained} sessions</span><span>last ${esc(formatDate(trend.lastTrained))}</span></div>
        </div>
        <span class="sparkcell">${sparkline(trend.points)}</span>
        <div class="figures">${Math.round(trend.latest)} <small>e1RM lb</small></div>
        <div class="delta">${trend.deltaPct ? `<b>${trend.deltaPct > 0 ? "+" : ""}${trend.deltaPct}%</b> / 4 sess` : ""} ${stamps}</div>
      </article>`);
  }

  return rows.join("") || '<p class="empty">Strength history appears after a few sessions.</p>';
}

function renderVolumeSection(state) {
  const volume = weeklyMuscleGroupSets(state);
  if (!volume) return "";
  const rows = volume.rows.filter((r) => r.sets > 0 || r.prev > 0);
  const scaleMax = Math.max(24, ...rows.map((r) => Math.max(r.sets, r.prev)));
  const x = (v) => Math.min(100, (v / scaleMax) * 100);
  const calib = state.training_summary?.effort_calibration;
  return `
    <div class="section">
      ${sectionHead(2, "Volume", `week of ${esc(formatDate(volume.week))} · sets per muscle group`)}
      <div class="ledger">
        ${rows.map((r) => `
          <div class="band-row">
            <span class="bn">${esc(humanize(r.slug))}</span>
            <div class="band-track">
              <span class="base"></span>
              <span class="zone" style="left:${x(10)}%; width:${x(20) - x(10)}%"></span>
              ${r.prev ? `<span class="prev" style="left:${x(r.prev)}%" title="last week: ${r.prev}"></span>` : ""}
              <span class="now" style="left:${x(r.sets)}%" title="this week: ${r.sets}"></span>
            </div>
            <span class="bv">${r.sets}<small> / ${r.prev || "—"}</small></span>
          </div>`).join("")}
      </div>
      <div class="band-legend">
        <span><i class="sw-now"></i>this week</span>
        <span><i class="sw-prev"></i>last week</span>
        <span><i class="sw-zone"></i>10–20 set growth zone</span>
      </div>
      ${calib?.rated_exercises ? `<p class="small" style="margin-top:10px; font-style:italic;">Effort calibration: ${calib.rated_exercises} rated lifts in 14 days — ${Math.round((calib.easy_share || 0) * 100)}% felt easy.</p>` : ""}
    </div>`;
}

function renderConsistencySection(state) {
  const active = new Set(state.workouts.map((w) => w.date));
  const today = new Date();
  const todayKey = isoDate(today);
  const year = today.getFullYear();
  const month = today.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push("<span></span>");
  for (let day = 1; day <= last.getDate(); day++) {
    const date = new Date(year, month, day);
    const key = isoDate(date);
    const satActive = active.has(isoDate(new Date(year, month, day - 1)));
    const monActive = active.has(isoDate(new Date(year, month, day + 1)));
    const bridge = date.getDay() === 0 && satActive && (monActive || key === todayKey);
    const classes = ["mini-day"];
    if (active.has(key)) classes.push("active");
    if (bridge) classes.push("bridge");
    if (key === todayKey) classes.push("today");
    cells.push(`<span class="${classes.join(" ")}" aria-label="${esc(formatDate(key))}"></span>`);
  }
  const days = weeklySeries(state);
  const max = Math.max(...days.map((d) => d.volume), 1);
  return `
    <div class="section">
      ${sectionHead(3, "Consistency", new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(today))}
      <div class="consistency">
        <div>
          <div class="mini-calendar">${cells.join("")}</div>
          <div class="cal-legend">
            <span><i class="f"></i>trained</span>
            <span><i class="b"></i>rest bridge</span>
          </div>
        </div>
        <div>
          <p class="microlabel">This week's load — ${shortNumber(days.reduce((s, d) => s + d.volume, 0))} lb·reps</p>
          <div class="ink-bars">
            ${days.map((d) => `
              <div class="ink-bar ${d.today ? "today" : ""} ${d.volume ? "" : "zero"}">
                <i style="height:${d.volume ? Math.max(6, Math.round((d.volume / max) * 100)) : 1}%"></i>
                <span>${esc(d.label)}</span>
              </div>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

function last7Days(state) {
  const byDate = new Map((state.dailies || []).map((d) => [d.date, d]));
  return Array.from({ length: 7 }, (_, i) => {
    const date = dayOffset(isoDate(), i - 6);
    const daily = byDate.get(date) || null;
    return {
      date,
      label: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T12:00:00`)).slice(0, 2),
      daily
    };
  });
}

function markFor(kind, value) {
  // Filled square = hit, bordered × = missed, dashes = not reported.
  if (kind === "protein") {
    if (value === "high") return `<span class="mark hit" title="hit">■</span>`;
    if (value === "medium") return `<span class="mark" title="close">~</span>`;
    if (value === "low") return `<span class="mark miss" title="low">×</span>`;
  }
  if (kind === "creatine") {
    if (value === true) return `<span class="mark hit" title="taken">■</span>`;
    if (value === false) return `<span class="mark miss" title="missed">×</span>`;
  }
  return `<span class="mark blank" title="not reported"></span>`;
}

function renderRecoverySection(state) {
  const week = last7Days(state);
  const age = readinessAgeDays(state);
  const watch = watchSeries(state, 7);
  const latest = watch[watch.length - 1] || null;
  const sleepVals = week.map((d) => (d.daily ? normalizeSleep(d.daily) : null));
  const sleepKnown = sleepVals.filter((v) => v !== null);
  const rhr = watch.map((d) => d.resting_heart_rate_bpm).filter(Boolean);
  const hrv = watch.map((d) => d.hrv_sdnn_ms).filter(Boolean);
  return `
    <div class="section">
      ${sectionHead(4, "Recovery", age === null ? "no signals logged" : age === 0 ? "signals current" : `signals ${age}d old`)}
      <div class="recovery-grid">
        <div>
          <div class="rec-line"><span class="k">Sleep, 7d</span><span>${sleepKnown.length ? `${(sleepKnown.reduce((s, v) => s + v, 0) / sleepKnown.length).toFixed(1)} h avg · ${sleepKnown.length}/7 nights` : "— not reported"}</span></div>
          <div class="rec-line"><span class="k">Protein</span><span class="mark-row">${week.map((d) => markFor("protein", d.daily ? normalizeProtein(d.daily) : null)).join("")}</span></div>
          <div class="rec-line"><span class="k">Creatine</span><span class="mark-row">${week.map((d) => markFor("creatine", d.daily ? normalizeCreatine(d.daily) : null)).join("")}</span></div>
          <div class="rec-line"><span class="k">Days</span><span class="mark-row" style="font-family:var(--mono); font-size:9px; letter-spacing:0.1em; color:var(--ink-faint);">${week.map((d) => `<span style="width:15px;text-align:center;">${esc(d.label)}</span>`).join("")}</span></div>
        </div>
        <div>
          ${latest ? `
            <div class="rec-line"><span class="k">Resting HR</span><span>${latest.resting_heart_rate_bpm ? `${latest.resting_heart_rate_bpm} bpm ` : "— "}${sparkline(rhr, 72, 18)}</span></div>
            <div class="rec-line"><span class="k">HRV</span><span>${latest.hrv_sdnn_ms ? `${Math.round(latest.hrv_sdnn_ms)} ms ` : "— "}${sparkline(hrv, 72, 18)}</span></div>
            <div class="rec-line"><span class="k">Steps</span><span>${latest.steps ? shortNumber(latest.steps) : "—"} · ${esc(formatDate(latest.date))}</span></div>
          ` : `<p class="empty">No watch data imported yet.</p>`}
        </div>
      </div>
    </div>`;
}

function renderGoalsSection(state, goals) {
  const north = goals.north_star;
  const habits = goals.habit_goals || [];
  const fuel = goals.nutrition_targets || {};
  const fuelItems = [
    ["Protein", fuel.protein_g_per_day ? `${fuel.protein_g_per_day} g/day${fuel.protein_hit_threshold_g ? ` (${fuel.protein_hit_threshold_g}+ = hit)` : ""}` : null],
    ["Creatine", fuel.creatine_g_per_day ? `${fuel.creatine_g_per_day} g/day` : null],
    ["Scale trend", fuel.weight_trend_lb_per_week !== undefined ? `${fuel.weight_trend_lb_per_week} lb/week` : null],
    ["Soda", fuel.soda || null]
  ].filter(([, v]) => v);
  const weight = state.metrics?.body_measurements?.body_weight_lb || north?.body_targets?.current?.weight_lb;
  return `
    <div class="section">
      ${sectionHead(5, "The long game", weight ? `${esc(String(weight))} lb${north?.body_targets?.current?.body_fat_pct ? ` · ${north.body_targets.current.body_fat_pct}% bf` : ""}` : "")}
      ${north?.identity ? `
        <div class="pullquote">
          <p>"${esc(north.identity)}"</p>
          <span class="attr">North star</span>
        </div>` : ""}
      <div class="ledger" style="margin-top:18px;">
        ${(north?.horizons || []).map((h) => `
          <div class="horizon-line">
            <span class="hd">${esc(h.target_date || "")}</span>
            <p><b>${esc(h.label)}.</b> ${esc(h.headline)}</p>
          </div>`).join("")}
      </div>
      <div class="two-col" style="margin-top:26px;">
        <div>
          <p class="microlabel">Habits — keep it boring</p>
          <div class="ledger">
            ${habits.slice(0, 6).map((h) => `
              <div class="habit-line">
                <span class="box">□</span>
                <span><b>${esc(h.label)}.</b> <em>${esc(h.cue ? `${h.cue} → ${h.action}` : h.target || "")}</em></span>
              </div>`).join("") || '<p class="empty">No habits set.</p>'}
          </div>
        </div>
        <div>
          <p class="microlabel">Fuel — support the build</p>
          <div class="ledger">
            ${fuelItems.map(([k, v]) => `
              <div class="fuel-line"><span class="k">${esc(k)}</span><span class="v">${esc(humanize(v))}</span></div>`).join("")}
          </div>
        </div>
      </div>
    </div>`;
}

/* ================================================================= INDEX */

export function renderLibrary(state) {
  // Retired exercises stay in the bank for history but leave the Index.
  const listed = state.bank.filter((e) => !e.retired);
  const categories = [...new Set(listed.map((e) => e.category).filter(Boolean))].sort();
  const sorted = [...listed].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return `
    <section class="view" id="view-library" hidden>
      <p class="dateline">Index of exercises</p>
      <div class="session-title">
        <h1>The Index</h1>
        ${stamp(`${listed.length} lifts`, { flat: true })}
      </div>
      <div class="index-tools">
        <input id="library-search" type="search" placeholder="Search the index…">
        <select id="library-category" aria-label="Category filter">
          <option value="all">All categories</option>
          ${categories.map((c) => `<option value="${esc(c)}">${esc(titleCase(c))}</option>`).join("")}
        </select>
      </div>
      <div class="index-cols" id="library-list">
        ${sorted.map((exercise) => `
          <button type="button" class="index-line" data-library-row
            data-search="${esc(`${exercise.name} ${exercise.category} ${(exercise.primary_muscles || []).join(" ")}`.toLowerCase())}"
            data-category="${esc(exercise.category || "")}"
            data-exercise-id="${esc(exercise.id)}">
            <h3>${esc(exercise.name)}</h3>
            <span class="leader"></span>
            <span class="ref">${esc(exercise.category || "")}${exercise.expert_rating?.tier ? ` · ${esc(exercise.expert_rating.tier)}` : ""}</span>
          </button>`).join("")}
      </div>
    </section>`;
}

/* =========================================================== FIELD NOTES */

// Seed the field notes from today's plan: one line per planned set (edit the
// numbers as you lift), a "felt:" prompt per lift (feeds the effort field),
// and a one-line signals footer (feeds the dailies ask). Still plain
// markdown, still copy-first — the trainer does all the writing.
export function generateTemplateText(state) {
  const exercises = state.plan?.exercises || [];
  const blocks = exercises.map((exercise) => {
    const name = titleCase(exercise.name || exercise.exercise_id);
    const target = exercise.target || {};
    const reps = target.reps ? `${target.reps}`
      : (target.reps_min || target.reps_max) ? `${target.reps_min || "?"}-${target.reps_max || "?"}`
      : target.duration_seconds ? `${target.duration_seconds}s` : "?";
    const weight = target.weight_lb ?? target.weight_lb_each ?? target.plate_load_lb ?? target.weight ?? target.load;
    const weightStr = (weight !== undefined && weight !== null)
      ? ` @ ${weight} lb${target.weight_lb_each !== undefined ? " each" : ""}` : "";
    const sets = Number(target.sets) || 3;
    const setLines = Array.from({ length: sets }, (_, i) => `  ${i + 1}) ${reps}${weightStr}`).join("\n");
    return `${name}\n${setLines}\n  felt:`;
  });
  const header = `${state.plan?.session_type ? titleCase(state.plan.session_type) : "Session"} — ${state.plan?.date || isoDate()}`;
  return `${header}\n\n${blocks.join("\n\n")}\n\nsleep / energy / protein / creatine:\nnotes:`;
}

export function draftKey(state) {
  return `fitness-log-draft:${state.user}:${state.plan?.date}:${state.plan?.session_type}`;
}

export function renderLog(state) {
  const draft = localStorage.getItem(draftKey(state));
  const initialText = draft !== null ? draft : generateTemplateText(state);
  return `
    <section class="view" id="view-log" hidden>
      <p class="dateline">Field notes</p>
      <div class="session-title">
        <h1>Field Notes</h1>
        ${stamp("Copy-first", { flat: true })}
      </div>
      <p class="small" style="margin-top:10px;">Mark up the template while you train, then copy it to your trainer. Drafts stay in this browser — the coach writes the ledger.</p>
      <div class="fieldnotes-tools">
        <button class="act primary" type="button" id="copy-report">Copy report</button>
        <button class="act" type="button" id="restore-template">Reset</button>
        <button class="act" type="button" id="clear-draft">Clear</button>
        <span id="logger-status">Auto-saves as you write.</span>
      </div>
      <textarea id="logger-editor" placeholder="Write or paste workout details…" spellcheck="false" autocomplete="off" autocapitalize="off">${esc(initialText)}</textarea>
      <div class="section">
        ${sectionHead(1, "Past entries", `${state.workouts.length} sessions`)}
        <div class="ledger">
          ${state.workouts.slice().reverse().map((workout) => `
            <div class="history-line">
              <span class="hd"><b>${esc(formatDate(workout.date))}</b>${esc(typeLabel(workout.session_type))} · ${shortNumber(totalVolume(workout))} lb·reps</span>
              <p>${esc((workout.exercises || []).map((ex) => `${titleCase(ex.name)} ${actualSummary(ex)}`).join("  ·  "))}</p>
            </div>`).join("")}
        </div>
      </div>
    </section>`;
}

/* ============================================================= FOOTNOTES */

function renderBodySvg(state, side, fillFor) {
  const parts = state.bodyMap?.parts?.[side] || [];
  return parts.map((part) => {
    const { fill, label } = fillFor(part.slug);
    const paths = [...(part.path?.common || []), ...(part.path?.left || []), ...(part.path?.right || [])];
    return paths.map((p) => `<path d="${esc(p)}" fill="${fill}" stroke="var(--paper)" stroke-width="0.8">${label ? `<title>${esc(label)}</title>` : ""}</path>`).join("");
  }).join("");
}

function renderMiniMuscleMap(state, details) {
  if (!state.bodyMap) return "";
  const highlights = new Map();
  for (const m of details?.secondary_muscles || []) {
    const slug = bodyPartForMuscle(m);
    if (slug) highlights.set(slug, "secondary");
  }
  for (const m of details?.primary_muscles || []) {
    const slug = bodyPartForMuscle(m);
    if (slug) highlights.set(slug, "primary");
  }
  const fillFor = (slug) => {
    const kind = highlights.get(slug);
    const fill = kind === "primary" ? "var(--pencil)"
      : kind === "secondary" ? "var(--ink-faint)"
      : "var(--band)";
    return { fill, label: kind ? `${humanize(slug)} (${kind})` : "" };
  };
  return `
    <div class="muscle-map-figures">
      <div class="muscle-figure"><svg viewBox="${esc(state.bodyMap.view_boxes.front)}" role="img">${renderBodySvg(state, "front", fillFor)}</svg><p>Front</p></div>
      <div class="muscle-figure"><svg viewBox="${esc(state.bodyMap.view_boxes.back)}" role="img">${renderBodySvg(state, "back", fillFor)}</svg><p>Back</p></div>
    </div>
    <div class="muscle-legend">
      <span><span class="legend-dot primary"></span>Primary: ${esc((details.primary_muscles || []).map(humanize).join(", ") || "—")}</span>
      <span><span class="legend-dot secondary"></span>Secondary: ${esc((details.secondary_muscles || []).map(humanize).join(", ") || "—")}</span>
    </div>`;
}

function glossaryEntry(state, token) {
  const g = state?.muscleGlossary;
  return (g && token && g[token]) || null;
}

function renderMuscleGlossaryBody(state, details) {
  const g = state?.muscleGlossary;
  if (!g) return "";
  const primary = details.primary_muscles || [];
  const secondary = details.secondary_muscles || [];
  if (!primary.length && !secondary.length) return "";

  const groups = new Map();
  for (const tok of primary) {
    const entry = g[tok];
    const grp = (entry && entry.group && g[entry.group]) ? entry.group : tok;
    if (!groups.has(grp)) groups.set(grp, new Set());
    groups.get(grp).add(tok);
  }

  const cards = [...groups.entries()].map(([grp, primaryToks]) => {
    const entry = g[grp] || g[[...primaryToks][0]];
    const name = entry?.name || humanize(grp);
    const plain = entry?.plain ? `<p class="gloss-plain">${esc(entry.plain)}</p>` : "";
    let headsHtml = "";
    const heads = entry?.heads || [];
    if (heads.length) {
      headsHtml = `<ul class="gloss-heads">` + heads.map((h) => {
        const worked = h.token && primaryToks.has(h.token);
        return `<li class="${worked ? "gloss-head-on" : ""}">
          <span class="gloss-mark" aria-hidden="true">${worked ? "■" : "□"}</span>
          <span><strong>${esc(h.name)}${worked ? " · worked here" : ""}</strong>${h.plain ? ` — ${esc(h.plain)}` : ""}</span>
        </li>`;
      }).join("") + `</ul>`;
    }
    const why = entry?.why_it_matters ? `<p class="gloss-why">${esc(entry.why_it_matters)}</p>` : "";
    return `<div class="gloss-card">
      <p class="gloss-name">${esc(name)} <span class="gloss-tag">primary</span></p>
      ${plain}${headsHtml}${why}
    </div>`;
  }).join("");

  const secNames = secondary.map((tok) => glossaryEntry(state, tok)?.name || humanize(tok));
  const secHtml = secNames.length
    ? `<p class="gloss-secondary"><span class="gloss-sec-label">Also assists:</span> ${esc(secNames.join(", "))}</p>`
    : "";

  return `${cards}${secHtml}`;
}


function fnHead(no, title, meta = "") {
  return `
    <div class="fn-head">
      <span class="fn-no">${no}</span>
      <span class="fn-title">${esc(title)}</span>
      ${meta ? `<span class="fn-meta">${esc(meta)}</span>` : ""}
    </div>`;
}

// The record line + session table for one lift, from the rolling summary.
function renderLiftRecord(state, details) {
  const entry = (state.training_summary?.exercises || {})[details.id];
  const history = entry?.history || [];
  if (!history.length) return { strip: "", table: "" };
  const last = history[history.length - 1];
  const points = history.filter((h) => h.est_1rm > 0).map((h) => h.est_1rm);
  const strip = `
    <div class="record-strip">
      ${points.length > 1 ? sparkline(points, 76, 20) : ""}
      <span>${last.best_weight_lb ? `Last <b>${last.best_weight_lb} lb</b>` : last.duration_s ? `Last <b>${last.duration_s}s</b>` : ""} · ${esc(formatDate(last.date))}</span>
      ${entry.best_weight_lb ? `<span>Best <b>${entry.best_weight_lb} lb</b>${entry.best_e1rm ? ` · e1RM <b>${Math.round(entry.best_e1rm)}</b>` : ""}</span>` : ""}
      ${entry.plateau ? stamp("Stall", { ghost: true }) : ""}
      ${entry.last_effort ? `<span>felt ${esc(entry.last_effort)}</span>` : ""}
    </div>`;
  const rows = history.slice().reverse().map((h) => {
    const load = h.best_weight_lb ? `${h.best_weight_lb} lb` : h.duration_s ? `${h.duration_s}s` : "—";
    const marks = [
      h.date === entry.best_weight_date && h.best_weight_lb ? stamp("PR", { pencil: true }) : "",
      h.rep_pr ? stamp("Rep PR", { pencil: true }) : ""
    ].filter(Boolean).join(" ");
    return `
      <div class="lh-row">
        <span class="lh-date">${esc(formatDate(h.date))}</span>
        <span class="lh-load">${esc(load)}</span>
        <span class="lh-work">${h.sets || 0} sets · ${h.reps || 0} reps</span>
        <span class="lh-e1rm">${h.est_1rm ? `${Math.round(h.est_1rm)} e1RM` : ""}</span>
        <span class="lh-marks">${marks}</span>
      </div>`;
  }).join("");
  const table = `
    <div class="footnote">
      ${fnHead(4, "Your record", `${entry.times_trained} session${entry.times_trained === 1 ? "" : "s"}`)}
      <div class="lift-history">${rows}</div>
    </div>`;
  return { strip, table };
}

// The footnote is a dossier with a narrative arc — no tabs:
// record line → setup → why it's in the program → what it works →
// full history → alternates → reference photo.
export function renderDrawerContent(state, exercise) {
  const details = exerciseDetails(state, exercise);
  if (!details) {
    return { title: titleCase(exercise?.name || exercise?.exercise_id || "Exercise"), html: '<p class="empty">No catalog entry yet. Add it to data/exercises/exercises.json first.</p>' };
  }
  const related = pillarsForExercise(state, details);
  const substitutions = (details.substitutions || []).map((id) => state.exerciseById.get(id)?.name || titleCase(id));
  const rating = details.expert_rating;
  const { strip, table } = renderLiftRecord(state, details);
  const html = `
    ${exercise.guidance ? `<div class="session-note"><p class="microlabel">Coach's session note</p><p>"${esc(exercise.guidance)}"</p></div>` : ""}
    ${strip}

    <div class="footnote">
      ${fnHead(1, "Setup")}
      ${details.setup_cues?.length
        ? `<ol class="cue-list">${details.setup_cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>`
        : '<p class="small">No cues cataloged yet.</p>'}
      ${details.common_mistakes?.length ? `
        <p class="watch-for"><span class="wf-k">Watch for</span>${details.common_mistakes.map((c) => esc(c.replace(/\.$/, ""))).join(" · ")}.</p>` : ""}
    </div>

    <div class="footnote">
      ${fnHead(2, "In your program", rating ? `${rating.tier} tier · ${Number(rating.score || 0).toFixed(1)}/10` : "")}
      <p class="sci-plain-text">${esc(details.plain_summary || details.biomechanics || "No summary yet.")}</p>
      ${related.length ? `<p class="sci-builds">Builds your ${related.map((p) => esc(p.label)).join(", ")}.</p>` : ""}
      ${rating?.verdict ? `<p class="sci-builds">"${esc(rating.verdict)}"</p>` : ""}
      ${rating ? `
        <div class="factor-lines">
          <div class="score-line"><span class="k has-tooltip" tabindex="0">Stays put<span class="tooltip-box">How fixed the setup is. A more stable setup lets the target muscle do the work instead of balancing.</span></span><span class="v">${esc(titleCase(rating.stability || "unknown"))}</span></div>
          <div class="score-line"><span class="k has-tooltip" tabindex="0">Trains it stretched<span class="tooltip-box">How much tension the muscle gets while lengthened — one of the strongest drivers of growth.</span></span><span class="v">${esc(titleCase(rating.stretch || "unknown"))}</span></div>
          <div class="score-line"><span class="k has-tooltip" tabindex="0">Bang for buck<span class="tooltip-box">Growth you get versus how wiped out it leaves you. High = lots of stimulus, easy to recover from.</span></span><span class="v">${esc(titleCase(rating.sfr || "unknown"))}</span></div>
        </div>` : ""}
      <details class="sci-deeper">
        <summary>How it works + progression</summary>
        <div class="sci-deeper-body">
          ${details.biomechanics ? `<p class="small" style="padding:8px 0 0;">${esc(details.biomechanics)}</p>` : ""}
          <p class="small" style="padding:8px 0 0;"><b>Progress it:</b> ${esc(details.progression || "Progress conservatively.")}</p>
          ${details.regression ? `<p class="small" style="padding:6px 0 0;"><b>Scale it back:</b> ${esc(details.regression)}</p>` : ""}
        </div>
      </details>
    </div>

    <div class="footnote">
      ${fnHead(3, "What it works")}
      ${renderMiniMuscleMap(state, details)}
      ${renderMuscleGlossaryBody(state, details)}
    </div>

    ${table}

    <div class="footnote">
      ${fnHead(5, "Alternates", "same pattern, different tool")}
      <p class="small">${substitutions.map((s) => esc(s)).join(" · ") || "None listed."}</p>
    </div>

    ${details.media?.url ? `
      <div class="footnote">
        <img class="media" src="${esc(details.media.url)}" alt="${esc(details.name)} reference" loading="lazy">
        ${details.media.attribution || details.media.license ? `<p class="small">${esc([details.media.attribution, details.media.license].filter(Boolean).join(" · "))}</p>` : ""}
      </div>` : ""}`;
  return { title: details.name, html };
}
