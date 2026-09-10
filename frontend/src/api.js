import axios from "axios";

export const client = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  withCredentials: true,
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("dd_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On a 401 (expired access token), try refreshing once via the refresh cookie
// and replay the original request. Login / refresh calls skip this loop.
let refreshInFlight = null;
client.interceptors.response.use(
  (r) => r,
  async (error) => {
    const cfg = error.config || {};
    const url = cfg.url || "";
    const isAuthEndpoint = url.includes("/auth/refresh") || url.includes("/auth/login") || url.includes("/auth/register");
    if (error?.response?.status !== 401 || cfg._retry || isAuthEndpoint) {
      throw error;
    }
    cfg._retry = true;
    try {
      refreshInFlight = refreshInFlight || client.post("/auth/refresh");
      const { data } = await refreshInFlight;
      refreshInFlight = null;
      if (data?.access_token) localStorage.setItem("dd_token", data.access_token);
      return client(cfg);
    } catch (refreshErr) {
      refreshInFlight = null;
      localStorage.removeItem("dd_token");
      throw error;
    }
  },
);

export const nowMin = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

/** A past day is fully behind you; a future day hasn't started. */
export const nowMinFor = (date) => {
  const t = todayStr();
  if (date === t) return nowMin();
  return date < t ? 1440 : -1;
};

export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const prettyDate = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
};

export const fmtMin = (m) => {
  const v = Math.max(0, Math.round(m || 0));
  if (v < 60) return `${v}m`;
  const h = Math.floor(v / 60);
  const r = v % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};

export const clock = (min) =>
  `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;

export const errMsg = (e) => {
  const detail = e?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail.map((x) => (typeof x?.msg === "string" ? x.msg : JSON.stringify(x))).join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return e?.message || "Something went wrong";
};

export const TASK_LABEL = {
  recurring: "Recurring share",
  one_off: "One-off",
  fixed: "Fixed time",
  carry: "Carried over",
};

export const TASK_COLOR = {
  recurring: "var(--sage)",
  one_off: "var(--sky)",
  fixed: "var(--amber)",
  carry: "var(--terracotta)",
};
