const express = require("express");
const webpush = require("web-push");

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const vapidSubject = String(process.env.VAPID_SUBJECT || "mailto:admin@example.com").trim();
const enabled = Boolean(vapidPublicKey && vapidPrivateKey);

if (enabled) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

async function initPush(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query("CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id)");
}

function createPushRouter(query, requireAuth) {
  const router = express.Router();
  router.use(requireAuth);

  router.get("/public-key", (_req, res) => {
    if (!enabled) return res.status(503).json({ error: "Notificacoes push nao configuradas no servidor." });
    return res.json({ publicKey: vapidPublicKey });
  });

  router.post("/subscribe", async (req, res) => {
    try {
      if (!enabled) return res.status(503).json({ error: "Notificacoes push nao configuradas no servidor." });
      const subscription = req.body || {};
      const endpoint = String(subscription.endpoint || "").trim();
      const p256dh = String(subscription.keys?.p256dh || "").trim();
      const auth = String(subscription.keys?.auth || "").trim();
      if (!endpoint || !p256dh || !auth) return res.status(400).json({ error: "Subscricao push invalida." });
      await query(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth
      `, [req.user.id, endpoint, p256dh, auth]);
      return res.status(201).json({ ok: true });
    } catch (error) {
      return res.status(500).json({ error: error?.message || "Nao foi possivel guardar a subscricao push." });
    }
  });

  router.delete("/subscribe", async (req, res) => {
    const endpoint = String(req.body?.endpoint || "").trim();
    if (endpoint) await query("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", [req.user.id, endpoint]);
    return res.json({ ok: true });
  });

  return router;
}

async function sendPushToUsers(query, userIds, payload) {
  if (!enabled || !Array.isArray(userIds) || !userIds.length) return;
  const ids = [...new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!ids.length) return;
  const subscriptions = await query(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const unreadRows = await query(
    `SELECT user_id, COUNT(*) AS total FROM app_notifications WHERE seen = FALSE AND user_id IN (${ids.map(() => "?").join(",")}) GROUP BY user_id`,
    ids
  );
  const unreadByUser = new Map(unreadRows.map((row) => [Number(row.user_id), Number(row.total)]));
  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      const unread = unreadByUser.get(Number(subscription.user_id)) || 0;
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth }
      }, JSON.stringify({ ...payload, unread }));
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await query("DELETE FROM push_subscriptions WHERE id = ?", [subscription.id]);
      } else {
        console.error("Push notification:", error.message);
      }
    }
  }));
}

module.exports = { initPush, createPushRouter, sendPushToUsers, pushEnabled: enabled };
