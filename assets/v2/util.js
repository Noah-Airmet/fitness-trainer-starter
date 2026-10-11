// FIT/OS — shared formatting + date helpers.

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function humanize(value) {
  if (value === null || value === undefined || value === "") return "Not reported";
  if (Array.isArray(value)) return value.map(humanize).join(", ");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== "")
      .map(([key, item]) => `${humanize(key)}: ${humanize(item)}`)
      .join("; ") || "Not reported";
  }
  return String(value).replaceAll("_", " ");
}

export function titleCase(value) {
  return humanize(value).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeId(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function isoDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dayOffset(dateText, offset) {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return isoDate(date);
}

export function formatDate(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return titleCase(value || "Today");
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(date);
}

export function formatUpdated(value) {
  const date = new Date(String(value || "").replace(/([+-]\d{2}):?(\d{2})$/, "$1:$2"));
  if (Number.isNaN(date.getTime())) return "unknown";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

export function shortNumber(value) {
  if (!value) return "0";
  if (value >= 1000) {
    const k = value / 1000;
    return `${k.toFixed(k >= 10 ? 0 : 1)}k`;
  }
  return String(Math.round(value));
}
