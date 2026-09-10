import { client } from "@/api";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export async function enablePushNotifications() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { ok: false, reason: "unsupported" };
  if (Notification.permission !== "granted") return { ok: false, reason: "permission" };
  const { data: cfg } = await client.get("/push/config");
  if (!cfg?.enabled || !cfg.public_key) return { ok: false, reason: "server-not-configured" };
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cfg.public_key) });
  const key = subscription.toJSON().keys || {};
  await client.post("/push/subscribe", { endpoint: subscription.endpoint, keys: key, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  localStorage.setItem("dd_push_enabled", "1");
  return { ok: true };
}
