// FIT/OS — derived data: muscle slugs, ranks, soreness decay, volume math,
// goal progress. Pure functions over the loaded state; no DOM here.

import { isoDate, dayOffset, normalizeId } from "./util.js?v=20260730b";

export const MUSCLE_TO_BODY_PART = {
  pectoralis_major: "chest",
  pectoralis_major_clavicular: "chest",
  anterior_deltoid: "deltoids",
  lateral_deltoid: "deltoids",
  posterior_deltoid: "deltoids",
  deltoids: "deltoids",
  shoulder_stabilizers: "deltoids",
  triceps_brachii: "triceps",
  triceps_brachii_long_head: "triceps",
  biceps_brachii: "biceps",
  biceps_brachii_long_head: "biceps",
  biceps_brachii_short_head: "biceps",
  brachialis: "biceps",
  brachioradialis: "forearm",
  forearm_flexors: "forearm",
  latissimus_dorsi: "upper-back",
  latissimus_dorsi_lower: "upper-back",
  rhomboids: "upper-back",
  infraspinatus: "upper-back",
  teres_minor: "upper-back",
  rotator_cuff: "upper-back",
  trapezius: "trapezius",
  trapezius_middle_lower: "trapezius",
  erector_spinae: "lower-back",
  quadriceps: "quadriceps",
  hamstrings: "hamstring",
  gastrocnemius: "calves",
  soleus: "calves",
  gluteus_maximus: "gluteal",
  gluteus_medius: "gluteal",
  adductor_magnus: "adductors",
  adductors: "adductors",
  rectus_abdominis: "abs",
  transversus_abdominis: "abs",
  core_stabilizers: "abs",
  obliques: "obliques",
  thoracic_spine_rotators: "obliques"
};

export const bodyPartForMuscle = (muscle) => MUSCLE_TO_BODY_PART[muscle] || null;

export const DISPLAY_SLUGS = ["chest", "biceps", "triceps", "deltoids", "trapezius", "forearm", "abs", "obliques", "upper-back", "lower-back", "quadriceps", "hamstring", "calves", "gluteal", "adductors"];
export const NON_MUSCLE_SLUGS = new Set(["head", "hair", "hands", "feet", "knees", "ankles", "neck", "tibialis"]);

// Rank tiers carry a two-letter glyph so rank is readable without color.
export const RANK_TIERS = [
  { id: "untrained", label: "Untrained", glyph: "--", min: 0, color: "#2a2d30" },
  { id: "bronze", label: "Bronze", glyph: "BR", min: 1, color: "#8b6a4a" },
  { id: "silver", label: "Silver", glyph: "SV", min: 4, color: "#9eaab0" },
  { id: "gold", label: "Gold", glyph: "AU", min: 8, color: "#c9a84c" },
  { id: "platinum", label: "Platinum", glyph: "PT", min: 16, color: "#7ecad0" },
  { id: "diamond", label: "Diamond", glyph: "DI", min: 28, color: "#a78bdb" }
];

export function rankForSessions(sessions) {
  let rank = RANK_TIERS[0];
  for (const tier of RANK_TIERS) if (sessions >= tier.min) rank = tier;
  return rank;
}

export function exerciseDetails(state, exerciseOrId) {
  const id = typeof exerciseOrId === "string" ? exerciseOrId : exerciseOrId?.exercise_id;
  const direct = state.exerciseById.get(id);
  if (direct) return direct;
  const name = typeof exerciseOrId === "string" ? exerciseOrId : exerciseOrId?.name;
  return state.bank.find((item) => normalizeId(item.name) === normalizeId(name)) || null;
}

export function pillarsForExercise(state, exercise) {
  const details = exerciseDetails(state, exercise);
  const muscles = new Set([...(details?.primary_muscles || []), ...(details?.secondary_muscles || [])]);
  return (state.goals?.pillars || []).filter((pillar) => {
    if ((pillar.exercise_ids || []).includes(exercise.exercise_id || exercise.id)) return true;
    return (pillar.muscles || []).some((token) =>
      [...muscles].some((muscle) => muscle === token || muscle.startsWith(`${token}_`) || token.startsWith(`${muscle}_`)));
  });
}

export function uniquePillars(pillars) {
  const seen = new Set();
  return pillars.filter((pillar) => {
    if (!pillar || seen.has(pillar.id)) return false;
    seen.add(pillar.id);
    return true;
  }).sort((a, b) => (a.priority || 99) - (b.priority || 99));
}

/* ------------------------------------------------------------- soreness */

const DECAY_PER_HOUR = 0.01;

// Decay client-side from updated_at so the panel is honest between
// check-ins even when the static fallback served a stale file.
export function decayedSorenessLevels(soreness) {
  const out = new Map(); // body-part slug -> level
  const now = Date.now();
  for (const [muscle, data] of Object.entries(soreness?.muscles || {})) {
    const slug = bodyPartForMuscle(muscle);
    if (!slug) continue;
    let level = typeof data.level === "number" ? data.level : 0;
    const updated = Date.parse(data.updated_at || "");
    if (!Number.isNaN(updated)) {
      level = Math.max(0, level - ((now - updated) / 3600000) * DECAY_PER_HOUR);
    }
    if (!out.has(slug) || level > out.get(slug)) out.set(slug, level);
  }
  return out;
}

export function sorenessBand(level) {
  if (!level || level <= 0.1) return { id: "none", label: "OK", tone: "" };
  if (level <= 0.4) return { id: "mild", label: "Mild", tone: "warn" };
  if (level <= 0.7) return { id: "moderate", label: "Sore", tone: "warn" };
  return { id: "high", label: "High", tone: "danger" };
}

/* --------------------------------------------------------------- volume */

export function setLoad(set) {
  if (set.weight_lb_each !== undefined) return Number(set.weight_lb_each) * 2;
  if (set.weight_lb !== undefined) return Number(set.weight_lb);
  if (set.plate_load_lb !== undefined) return Number(set.plate_load_lb);
  if (set.added_weight_lb !== undefined) return Number(set.added_weight_lb);
  if (set.load !== undefined) return Number(set.load);
  return 0;
}

export function totalVolume(workout) {
  let total = 0;
  for (const exercise of workout?.exercises || []) {
    for (const set of exercise.actual || exercise.sets || []) {
      total += Number(set.reps || 0) * setLoad(set);
    }
  }
  return Math.round(total);
}

export function rollingVolume(state, endDateText, daysCount = 7) {
  const start = dayOffset(endDateText, -(daysCount - 1));
  return state.workouts.reduce((sum, workout) =>
    (workout.date >= start && workout.date <= endDateText) ? sum + totalVolume(workout) : sum, 0);
}

export function weeklySeries(state) {
  const base = new Date(`${state.plan?.date || isoDate()}T12:00:00`);
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((monday.getDay() + 6) % 7));
  const volumes = new Map(state.workouts.map((workout) => [workout.date, totalVolume(workout)]));
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const key = isoDate(date);
    return {
      date: key,
      label: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date).slice(0, 2),
      volume: volumes.get(key) || 0,
      today: key === isoDate()
    };
  });
}

export function bestSets(state, limit = 6) {
  const best = new Map();
  for (const workout of state.workouts) {
    for (const exercise of workout.exercises || []) {
      for (const set of exercise.actual || exercise.sets || []) {
        const reps = Number(set.reps || 0);
        const load = setLoad(set);
        if (!reps || !load) continue;
        const id = exercise.exercise_id || normalizeId(exercise.name);
        const score = load * reps;
        const existing = best.get(id);
        if (!existing || score > existing.score) {
          const displayLoad = set.weight_lb_each ?? set.weight_lb ?? set.plate_load_lb ?? load;
          best.set(id, { id, name: exercise.name || id, load: displayLoad, reps, score, date: workout.date });
        }
      }
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildMuscleSessionMap(state) {
  const slugSessions = new Map();
  for (const workout of state.workouts) {
    const hit = new Set();
    for (const ex of workout.exercises || []) {
      const details = exerciseDetails(state, ex.exercise_id || normalizeId(ex.name));
      if (!details) continue;
      for (const m of [...(details.primary_muscles || []), ...(details.secondary_muscles || [])]) {
        const slug = bodyPartForMuscle(m);
        if (slug) hit.add(slug);
      }
    }
    for (const slug of hit) slugSessions.set(slug, (slugSessions.get(slug) || 0) + 1);
  }
  return slugSessions;
}

/* ----------------------------------------------------------------- goals */

function goalLoad(obj) {
  return Number(obj?.weight_lb ?? obj?.plate_load_lb ?? 0);
}

function goalStart(goal) {
  return Number(goal.start_weight_lb || goalLoad(goal.current_baseline) || 0);
}

// Fraction of start->target covered. NOT baseline/target — that flattered
// every meter to ~70% on day one.
export function goalProgress(goal) {
  const start = goalStart(goal);
  const current = goalLoad(goal.current_baseline);
  const target = goalLoad(goal.target);
  if (!current || !target || target <= start) return null;
  return Math.max(2, Math.min(100, Math.round(((current - start) / (target - start)) * 100)));
}

export function expectedProgress(goal) {
  if (!goal.start_date || !goal.target_date) return null;
  const start = new Date(`${goal.start_date}T12:00:00`);
  const end = new Date(`${goal.target_date}T12:00:00`);
  const total = end - start;
  if (total <= 0) return null;
  const fraction = Math.max(0, Math.min(1, (Date.now() - start) / total));
  const startWeight = goalStart(goal);
  const target = goalLoad(goal.target);
  if (!startWeight || !target || target <= startWeight) return null;
  return {
    percent: Math.round(fraction * 100),
    weight: Math.round(startWeight + (target - startWeight) * fraction)
  };
}

/* ------------------------------------------------- summary v2 analytics */

// Weekly fractional set volume aggregated to display muscle groups.
// Returns { week, prevWeek, rows: [{slug, sets, prev}] } or null.
export function weeklyMuscleGroupSets(state) {
  const weeks = state.training_summary?.weekly_muscle_sets || {};
  const keys = Object.keys(weeks).sort();
  if (!keys.length) return null;
  const cur = keys[keys.length - 1];
  const prev = keys.length > 1 ? keys[keys.length - 2] : null;
  const agg = (wk) => {
    const out = new Map();
    for (const [muscle, sets] of Object.entries(weeks[wk] || {})) {
      const slug = bodyPartForMuscle(muscle);
      if (!slug) continue;
      out.set(slug, (out.get(slug) || 0) + sets);
    }
    return out;
  };
  const curMap = agg(cur);
  const prevMap = prev ? agg(prev) : new Map();
  const slugs = new Set([...curMap.keys(), ...prevMap.keys()]);
  const rows = [...slugs].map((slug) => ({
    slug,
    sets: Math.round((curMap.get(slug) || 0) * 10) / 10,
    prev: Math.round((prevMap.get(slug) || 0) * 10) / 10
  })).sort((a, b) => b.sets - a.sets || a.slug.localeCompare(b.slug));
  return { week: cur, prevWeek: prev, rows };
}

// Estimated-1RM trend rows for the strength ledger. One row per exercise
// with enough history; sparkline points from history est_1rm.
export function e1rmTrendRows(state, limit = 10) {
  const exercises = state.training_summary?.exercises || {};
  const rows = [];
  for (const [id, e] of Object.entries(exercises)) {
    if (!e.best_e1rm || (e.times_trained || 0) < 3) continue;
    const points = (e.history || []).filter((h) => h.est_1rm > 0).map((h) => h.est_1rm);
    if (points.length < 2) continue;
    const history = (e.history || []).filter((h) => h.est_1rm > 0);
    const latest = history[history.length - 1];
    const baseline = history[Math.max(0, history.length - 4)];
    const deltaPct = baseline.est_1rm
      ? Math.round(((latest.est_1rm - baseline.est_1rm) / baseline.est_1rm) * 100) : 0;
    rows.push({
      id,
      points,
      latest: latest.est_1rm,
      best: e.best_e1rm,
      bestDate: e.best_e1rm_date,
      deltaPct,
      plateau: !!e.plateau,
      repPr: !!latest.rep_pr,
      lastTrained: e.last_trained,
      timesTrained: e.times_trained
    });
  }
  return rows.sort((a, b) => b.latest - a.latest).slice(0, limit);
}

// Days since the newest daily log (0 = today). null when nothing logged.
export function readinessAgeDays(state) {
  const dates = (state.dailies || []).map((d) => d.date).sort();
  if (!dates.length) return null;
  const last = new Date(`${dates[dates.length - 1]}T12:00:00`);
  const today = new Date(`${isoDate()}T12:00:00`);
  return Math.max(0, Math.round((today - last) / 86400000));
}

// Trimmed watch recovery series (already last-14-days from the server).
export function watchSeries(state, days = 7) {
  const rows = (state.health || []).filter((d) => d && d.date);
  return rows.slice(-days);
}

/* ------------------------------------------------------------- readiness */

export function normalizeSleep(d) {
  const h = d.sleep?.duration_hours;
  return typeof h === "number" && h > 0 ? h : null;
}

export function normalizeEnergy(d) {
  const e = d.energy;
  if (typeof e === "number") return e;
  if (typeof e === "string") {
    const s = e.toLowerCase();
    if (s.includes("high") || s.includes("great")) return 5;
    if (s.includes("good")) return 4;
    if (s.includes("moderate") || s.includes("medium") || s.includes("ok") || s.includes("fair")) return 3;
    if (s.includes("low") || s.includes("tired")) return 2;
    if (s.includes("bad") || s.includes("exhausted")) return 1;
  }
  return null;
}

export function normalizeProtein(d) {
  const p = d.nutrition?.protein;
  if (typeof p === "string") {
    const s = p.toLowerCase();
    if (s.includes("hit") || s.includes("high")) return "high";
    if (s.includes("medium") || s.includes("med") || s.includes("close")) return "medium";
    if (s.includes("low") || s.includes("skip") || s.includes("miss") || s.includes("none")) return "low";
  }
  return null;
}

export function normalizeCreatine(d) {
  const c = d.nutrition?.creatine;
  if (c === true || (typeof c === "string" && /taken|yes|scoop/i.test(c))) return true;
  if (c === false || (typeof c === "string" && /miss|no|skip/i.test(c))) return false;
  return null;
}
