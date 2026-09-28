const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("./middleware/auth");
const { createChatRouter, initChat } = require("./chat");

test("chat permissions, validation, history and pagination through HTTP", async (t) => {
  process.env.JWT_SECRET = "isolated-chat-test-secret";
  const users = [1, 2, 3, 4].map((id) => ({ id, username: `User ${id}`, role: id === 4 ? "admin" : "funcionario" }));
  const conversation = { id: 10, user_a: 1, user_b: 2, name_a: "User 1", name_b: "User 2" };
  const messages = Array.from({ length: 105 }, (_, i) => ({ id: i + 1, conversation_id: 10, body: `Message ${i}`, sender_id: 1 }));
  const attachments = new Map();
  const query = async (sql, params = []) => {
    if (sql.startsWith("SELECT id, username, role")) return users.filter((u) => u.id === Number(params[0]));
    if (sql.startsWith("SELECT id, username FROM")) return users.filter((u) => sql.includes("<>") ? u.id !== Number(params[0]) : u.id === Number(params[0]));
    if (sql.startsWith("SELECT c.*")) return params.length && !params.includes(1) && !params.includes(2) ? [] : [conversation];
    if (sql.startsWith("SELECT * FROM chat_conversations")) return Number(params[0]) === 10 ? [conversation] : [];
    if (sql.startsWith("INSERT INTO chat_conversations")) return [conversation];
    if (sql.startsWith("SELECT *, (SELECT filename")) {
      let rows = messages.filter((m) => m.conversation_id === Number(params[0]));
      if (sql.includes("id < ?")) rows = rows.filter((m) => m.id < Number(params[1]));
      if (sql.includes("id > ?")) rows = rows.filter((m) => m.id > Number(params[1]));
      return rows.sort((a, b) => sql.includes("ASC") ? a.id - b.id : b.id - a.id).slice(0, 100);
    }
    if (sql.startsWith("INSERT INTO chat_messages")) {
      const m = { id: messages.length + 1, conversation_id: params[0], sender_id: params[1], sender_name: params[2], body: params[3] };
      messages.push(m);
      return [m];
    }
    if (sql.startsWith("WITH message AS")) {
      const m = { id: messages.length + 1, conversation_id: params[0], sender_id: params[1], sender_name: params[2], body: params[3], attachment_name: params[4] };
      messages.push(m);
      attachments.set(m.id, { filename: params[4], content: params[5] });
      return [m];
    }
    if (sql.startsWith("SELECT a.filename")) {
      const attachment = Number(params[0]) === 10 && attachments.get(Number(params[1]));
      return attachment ? [attachment] : [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  };
  const app = express();
  app.use(express.json());
  app.use("/chat", createChatRouter(query, requireAuth));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (id, path, body) => {
    const headers = { "Content-Type": "application/json" };
    if (id) headers.Authorization = `Bearer ${jwt.sign({ id, role: "admin" }, process.env.JWT_SECRET)}`;
    const response = await fetch(`http://127.0.0.1:${server.address().port}/chat${path}`, { headers, method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await request(null, "/users")).status, 401);
  assert.equal((await request(99, "/users")).status, 401);
  assert.equal((await request(1, "/users")).body.some((u) => "password" in u), false);
  assert.deepEqual((await request(3, "/conversations")).body, []);
  assert.equal((await request(4, "/conversations")).body.length, 1);
  assert.equal((await request(3, "/conversations/10/messages")).status, 404);
  assert.equal((await request(3, "/conversations/10/messages", { body: "Intrusion" })).status, 404);
  assert.equal((await request(4, "/conversations/10/messages")).status, 200);
  assert.equal((await request(4, "/conversations/10/messages", { body: "Admin intrusion" })).status, 403);
  assert.equal((await request(1, "/conversations/10/messages", { body: "  " })).status, 400);
  assert.equal((await request(1, "/conversations/10/messages", { body: "x".repeat(4001) })).status, 400);
  assert.equal((await request(1, "/conversations", { recipient_id: 1 })).status, 400);
  assert.equal((await request(1, "/conversations", { recipient_id: 99 })).status, 404);
  assert.equal((await request(1, "/conversations", { recipient_id: 2 })).status, 201);
  const latest = await request(2, "/conversations/10/messages");
  assert.equal(latest.body.length, 100);
  assert.equal(latest.body[0].id, 6);
  assert.equal((await request(2, "/conversations/10/messages?before=6")).body.length, 5);
  assert.equal((await request(2, "/conversations/10/messages?after=104")).body[0].id, 105);
  assert.equal((await request(2, "/conversations/10/messages?after=bad")).status, 400);
  const sent = await request(2, "/conversations/10/messages", { body: "Olá 👋" });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.sender_id, 2);
  assert.equal((await request(1, "/conversations/10/messages?after=105")).body[0].body, "Olá 👋");
  const fileRequest = (id, suffix, form) => fetch(`http://127.0.0.1:${server.address().port}/chat/conversations/10/attachments${suffix}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ id }, process.env.JWT_SECRET)}` },
    ...(form ? { method: "POST", body: form } : {})
  });
  const form = new FormData();
  form.append("file", new Blob(["file contents"]), "document.txt");
  assert.equal((await fileRequest(3, "", form)).status, 404);
  assert.equal((await fileRequest(4, "", form)).status, 403);
  const uploaded = await fileRequest(1, "", form);
  assert.equal(uploaded.status, 201);
  const attachmentMessage = await uploaded.json();
  assert.equal(attachmentMessage.attachment_name, "document.txt");
  const suffix = `/${attachmentMessage.id}`;
  assert.equal((await fileRequest(3, suffix)).status, 404);
  for (const viewer of [1, 2, 4]) {
    const downloaded = await fileRequest(viewer, suffix);
    assert.equal(downloaded.status, 200);
    assert.match(downloaded.headers.get("content-disposition"), /attachment/);
    assert.equal(await downloaded.text(), "file contents");
  }
  assert.equal((await fileRequest(1, "/9999")).status, 404);
  const oversized = new FormData();
  oversized.append("file", new Blob([new Uint8Array(10485761)]), "large.bin");
  assert.equal((await fileRequest(1, "", oversized)).status, 400);
  const empty = new FormData();
  empty.append("file", new Blob([]), "empty.txt");
  assert.equal((await fileRequest(1, "", empty)).status, 400);
  conversation.user_b = null;
  assert.equal((await request(1, "/conversations/10/messages", { body: "Deleted recipient" })).status, 409);
  assert.equal((await request(1, "/conversations/10/messages")).status, 200);
});

test("schema initialization executes individual statements and enables RLS", async () => {
  const statements = [];
  await initChat(async (sql) => { statements.push(sql); });
  assert.equal(statements.length, 7);
  assert.equal(statements.filter((s) => s.includes("ENABLE ROW LEVEL SECURITY")).length, 3);
});
