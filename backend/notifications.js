const express = require("express");
const fs = require("fs");
const path = require("path");

async function initNotifications(query) {
  for (const statement of fs.readFileSync(path.join(__dirname, "notifications-schema.sql"), "utf8").split("-- statement-break")) {
    if (statement.trim()) await query(statement);
  }
}

function createNotificationsRouter(query, requireAuth) {
  const router = express.Router();
  const handle = (callback) => async (req, res) => {
    try {
      const users = await query("SELECT id FROM funcionarios WHERE id = ?", [req.user.id]);
      if (!users[0]) return res.status(401).json({ error: "Sessão inválida." });
      await callback(req, res);
    } catch (error) {
      console.error("Notifications:", error.message);
      res.status(500).json({ error: "Não foi possível atualizar as notificações." });
    }
  };
  router.use(requireAuth);
  router.get("/", handle(async (req, res) => {
    const before = req.query.before;
    if (before && (!/^\d+$/.test(before) || !Number.isSafeInteger(Number(before)) || Number(before) <= 0)) {
      return res.status(400).json({ error: "Página inválida." });
    }
    const items = await query(`SELECT * FROM app_notifications WHERE user_id = ? ${before ? "AND id < ?" : ""} ORDER BY id DESC LIMIT 50`,
      [req.user.id, ...(before ? [before] : [])]);
    const counts = await query("SELECT COUNT(*) AS total FROM app_notifications WHERE user_id = ? AND seen = FALSE", [req.user.id]);
    res.set("Cache-Control", "no-store").json({ items, unread: Number(counts[0].total) });
  }));
  router.patch("/:id/seen", handle(async (req, res) => {
    if (!/^\d+$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)) || Number(req.params.id) <= 0) {
      return res.status(400).json({ error: "Notificação inválida." });
    }
    const rows = await query("UPDATE app_notifications SET seen = TRUE WHERE id = ? AND user_id = ? RETURNING id", [req.params.id, req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: "Notificação não encontrada." });
    res.json({ ok: true });
  }));
  return router;
}
module.exports = { initNotifications, createNotificationsRouter };
