// Dates are stored as local "YYYY-MM-DD" day keys; timestamps as ms numbers.
export const pad = (n) => (n < 10 ? "0" : "") + n;
export const dayKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const parseKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => dayKey(new Date());
export const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return dayKey(d); };
export const diffDays = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export { MON, MONTH, WD, WEEKDAY };

// Date rules agreed in design: relative for activity, short date for milestones, full when the date is the subject.
export function rel(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = s / 60; if (m < 60) return Math.floor(m) + "m ago";
  const h = m / 60; if (h < 24) return Math.floor(h) + "h ago";
  const d = h / 24; if (d < 14) return Math.floor(d) + "d ago";
  if (d < 60) return Math.floor(d / 7) + "w ago";
  if (d < 365) return Math.floor(d / 30) + "mo ago";
  return Math.floor(d / 365) + "y ago";
}
export const shortDate = (ts) => { const d = new Date(ts); return d.getDate() + " " + MON[d.getMonth()] + " " + String(d.getFullYear()).slice(2); };
export const dayLabel = (k) => { const d = parseKey(k); return WD[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()]; };
export const fullDay = (k) => { const d = parseKey(k); return WEEKDAY[d.getDay()] + ", " + d.getDate() + " " + MONTH[d.getMonth()] + " " + d.getFullYear(); };
export const monthDay = (k) => { const d = parseKey(k); return d.getDate() + " " + MON[d.getMonth()]; };
export function relDay(k) {
  const n = diffDays(todayKey(), k);
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  return dayLabel(k);
}
export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
export const fmtSec = (t) => { const m = Math.floor(t / 60); const s = t - m * 60; return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1); };
export const fmtDur = (t) => { t = Math.round(t); const m = Math.floor(t / 60); const s = t % 60; return m + ":" + pad(s); };
export const plural = (n, w, p) => n + " " + (n === 1 ? w : (p || w + "s"));
export const uid = (p) => (p || "id") + Math.random().toString(36).slice(2, 9);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")"; };
// Human size: picks KB, MB or GB so a new library doesn't read "0.0 GB".
export const gb = (bytes) => {
  const b = Math.max(0, bytes || 0);
  if (b >= 1e9) return (b / 1e9).toFixed(b < 1e10 ? 1 : 0) + " GB";
  if (b >= 1e6) return Math.round(b / 1e6) + " MB";
  return b > 0 ? Math.max(1, Math.round(b / 1e3)) + " KB" : "0 MB";
};

export const PALETTE = [
  { name: "Amber", color: "#E8A33D" }, { name: "Gold", color: "#D9C04A" }, { name: "Lime", color: "#9BBF5A" }, { name: "Mint", color: "#6CC99B" },
  { name: "Teal", color: "#5BA3A0" }, { name: "Cyan", color: "#52BCCB" }, { name: "Sky", color: "#6FA8DC" }, { name: "Indigo", color: "#7C89E3" },
  { name: "Violet", color: "#9B87D6" }, { name: "Plum", color: "#B47AC9" }, { name: "Pink", color: "#E895C2" }, { name: "Rose", color: "#D9768F" },
  { name: "Coral", color: "#EB8A72" }, { name: "Clay", color: "#D97757" }, { name: "Sand", color: "#C4A57F" }, { name: "Slate", color: "#8C96A3" }
];
export const ACCENTS = ["#E8A33D", "#D97757", "#5B8C7B", "#7C93C4"];

// Clip "footage" stand-ins: warm-to-cool gradients like the mockups.
export const GRADS = [
  "linear-gradient(135deg,#8C5B3F,#C98A4B)", "linear-gradient(135deg,#3F5B6B,#6E96A8)", "linear-gradient(135deg,#5B6B3F,#8FA35B)",
  "linear-gradient(135deg,#6B3F5B,#A85B8F)", "linear-gradient(135deg,#3F4A6B,#5B73A8)", "linear-gradient(135deg,#6B4A3F,#A87A5B)",
  "linear-gradient(160deg,#D29655,#7E5A55)", "linear-gradient(160deg,#4F6E62,#9DBB9A)", "linear-gradient(160deg,#5A4C78,#C48A84)",
  "linear-gradient(160deg,#2E4A5E,#E0A86B)", "linear-gradient(160deg,#704B3B,#E2C08D)", "linear-gradient(160deg,#3C5A48,#7FB0C4)"
];

export const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
