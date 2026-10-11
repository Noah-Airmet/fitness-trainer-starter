// FIT/OS — data link. Prefers the v2 server API (one round-trip, server-side
// soreness decay); falls back to assembling the bundle from static JSON so
// the panel still works under a plain static server (reversibility).

import { isoDate } from "./util.js";

function fetchJson(path) {
  return fetch(path, { cache: "no-store" }).then((response) => {
    if (!response.ok) throw new Error(`${path}: ${response.status}`);
    return response.json();
  });
}

export function fetchOptional(path) {
  return path ? fetchJson(path).catch(() => null) : Promise.resolve(null);
}

// True while the v2 API answered the last state load — drives the
// annunciator LINK indicator and whether readiness taps can round-trip.
export const link = { live: false };

export async function loadState(user) {
  try {
    const state = await fetchJson(`/api/${user}/state`);
    link.live = true;
    return state;
  } catch {
    link.live = false;
    return loadStateStatic(user);
  }
}

async function loadStateStatic(user) {
  const current = await fetchJson(`data/${user}/current.json?_=${Date.now()}`);
  const [goals, plan, latestWorkout, summary, soreness, outline, metrics] = await Promise.all([
    fetchOptional(current.goals),
    fetchOptional(current.next_plan),
    fetchOptional(current.latest_workout),
    fetchOptional(current.training_summary || `data/${user}/training-summary.json`),
    fetchOptional(current.soreness),
    fetchOptional(current.week_outline || `data/${user}/plans/week-outline.json`),
    fetchOptional(current.metrics)
  ]);
  const dailyPaths = [...(current.daily_history || [])];
  const todayPath = `data/${user}/daily/${isoDate()}.json`;
  if (!dailyPaths.includes(todayPath)) dailyPaths.push(todayPath);
  const dailies = (await Promise.all(dailyPaths.map(fetchOptional))).filter(Boolean);
  return {
    user,
    version: null,
    current,
    goals,
    plan,
    latest_workout: latestWorkout,
    training_summary: summary,
    soreness,
    week_outline: outline,
    metrics,
    dailies
  };
}

export async function loadWorkouts(current) {
  const paths = current.workout_history || [];
  return (await Promise.all(paths.map(fetchOptional))).filter(Boolean);
}

export function fetchVersion(user) {
  return fetchJson(`/api/${user}/state/version`).then((doc) => doc.version);
}

export async function postDaily(user, field, value) {
  const response = await fetch(`/api/${user}/daily`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, date: isoDate(), field, value })
  });
  if (!response.ok) throw new Error(`daily save failed: ${response.status}`);
  return response.json();
}
