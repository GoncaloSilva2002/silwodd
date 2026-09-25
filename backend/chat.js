const express = require("express");
const fs = require("fs");
const path = require("path");

async function initChat(query) {
  const statements = fs.readFileSync(path.join(__dirname, "chat-schema.sql"), "utf8").split(";");
  for (const statement of statements) {
    if (statement.trim()) await query(statement);
  }
}

function createChatRouter(query, requireAuth) {
  const router = express.Router();
  const id = (value) => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const route = (handler) => async (req, res, next) => {
    try { await handler(req, res, next); }
    catch (error) {
      console.error("Chat:", error.message);
      res.status(500).json({ error: "Não foi possível atualizar o chat. Tenta novamente." });
    }
  };
  router.use(requireAuth);
  // Check the current database role, including account removal and role changes.
  router.use(route(async (req, res, next) => {
    const rows = await query("SELECT id, username, role FROM funcionarios WHERE id = ?", [req.user.id]);
    if (!rows[0]) return res.status(401).json({ error: "Sessão inválida." });
    req.chatUser = rows[0];
    next();
  }));
  router.get("/users", route(async (req, res) => {
    res.json(await query("SELECT id, username FROM funcionarios WHERE id <> ? ORDER BY username", [req.chatUser.id]));
  }));
  router.get("/conversations", route(async (req, res) => {
    const admin = req.chatUser.role === "admin";
    res.json(await query(`SELECT c.*, m.body AS last_message, m.created_at AS last_at
      FROM chat_conversations c
      LEFT JOIN LATERAL (SELECT body, created_at FROM chat_messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) m ON TRUE
      ${admin ? "" : "WHERE c.user_a = ? OR c.user_b = ?"}
      ORDER BY COALESCE(m.created_at, c.created_at) DESC, c.id DESC`, admin ? [] : [req.chatUser.id, req.chatUser.id]));
  }));
  router.post("/conversations", route(async (req, res) => {
    const recipient = req.body.recipient_id;
    if (!id(recipient) || Number(recipient) === Number(req.chatUser.id)) return res.status(400).json({ error: "Escolhe outro utilizador." });
    const rows = await query("SELECT id, username FROM funcionarios WHERE id = ?", [recipient]);
    if (!rows[0]) return res.status(404).json({ error: "Utilizador não encontrado." });
    const people = [req.chatUser, rows[0]].sort((a, b) => Number(a.id) - Number(b.id));
    const conversation = await query(`INSERT INTO chat_conversations (user_a, user_b, name_a, name_b) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_a, user_b) DO UPDATE SET name_a = EXCLUDED.name_a, name_b = EXCLUDED.name_b RETURNING *`,
    [people[0].id, people[1].id, people[0].username, people[1].username]);
    res.status(201).json(conversation[0]);
  }));
  router.use("/conversations/:id", route(async (req, res, next) => {
    if (!id(req.params.id)) return res.status(400).json({ error: "Conversa inválida." });
    const rows = await query("SELECT * FROM chat_conversations WHERE id = ?", [req.params.id]);
    const c = rows[0];
    const participant = c && [c.user_a, c.user_b].some((value) => value != null && Number(value) === Number(req.chatUser.id));
    if (!c || (!participant && req.chatUser.role !== "admin")) return res.status(404).json({ error: "Conversa não encontrada." });
    req.conversation = c;
    req.chatParticipant = participant;
    next();
  }));
  router.get("/conversations/:id/messages", route(async (req, res) => {
    const { before, after } = req.query;
    if ((before && !id(before)) || (after && !id(after)) || (before && after)) return res.status(400).json({ error: "Página inválida." });
    const rows = await query(`SELECT * FROM chat_messages WHERE conversation_id = ?
      ${before ? "AND id < ?" : after ? "AND id > ?" : ""} ORDER BY id ${after ? "ASC" : "DESC"} LIMIT 100`,
    [req.conversation.id, ...(before || after ? [before || after] : [])]);
    res.json(after ? rows : rows.reverse());
  }));
  router.post("/conversations/:id/messages", route(async (req, res) => {
    if (!req.chatParticipant) return res.status(403).json({ error: "Só os participantes podem enviar mensagens nesta conversa." });
    const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
    if (!body || body.length > 4000) return res.status(400).json({ error: "Escreve uma mensagem com 1 a 4000 caracteres." });
    if (req.conversation.user_a == null || req.conversation.user_b == null) return res.status(409).json({ error: "Este utilizador já não está disponível. O histórico foi preservado." });
    const rows = await query("INSERT INTO chat_messages (conversation_id, sender_id, sender_name, body) VALUES (?, ?, ?, ?) RETURNING *",
      [req.conversation.id, req.chatUser.id, req.chatUser.username, body]);
    res.status(201).json(rows[0]);
  }));
  return router;
}
module.exports = { createChatRouter, initChat };
