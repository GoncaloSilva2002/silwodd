const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const jwt = require("jsonwebtoken");
const { requireAuth } = require("./middleware/auth");
const { createNotificationsRouter } = require("./notifications");

test("notifications are private, paginated and acknowledged only by their owner", async (t) => {
  process.env.JWT_SECRET = "notifications-test-secret";
  const records = Array.from({ length: 55 }, (_, i) => ({ id: i + 1, user_id: 1, seen: false, title: `Notice ${i}` }));
  records.push({ id: 56, user_id: 2, seen: false, title: "Private message" });
  const query = async (sql, params) => {
    if (sql.startsWith("SELECT id FROM funcionarios")) return [1, 2, 3].includes(params[0]) ? [{ id: params[0] }] : [];
    if (sql.startsWith("SELECT * FROM app_notifications")) return records.filter((n) => n.user_id === params[0] && (!params[1] || n.id < Number(params[1]))).sort((a, b) => b.id - a.id).slice(0, 50);
    if (sql.startsWith("SELECT COUNT")) return [{ total: records.filter((n) => n.user_id === params[0] && !n.seen).length }];
    if (sql.startsWith("UPDATE app_notifications")) {
      const item = records.find((n) => n.id === Number(params[0]) && n.user_id === params[1]);
      if (!item) return [];
      item.seen = true;
      return [{ id: item.id }];
    }
    throw new Error("Unexpected query");
  };
  const app = express();
  app.use(createNotificationsRouter(query, requireAuth));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (id, path = "/", method = "GET") => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      headers: id ? { Authorization: `Bearer ${jwt.sign({ id, role: "admin" }, process.env.JWT_SECRET)}` } : {} });
    return { status: response.status, data: await response.json() };
  };
  assert.equal((await request(null)).status, 401);
  assert.equal((await request(99)).status, 401);
  const first = await request(1);
  assert.equal(first.data.items.length, 50);
  assert.equal(first.data.unread, 55);
  assert.ok(first.data.items.every((n) => n.user_id === 1));
  assert.equal((await request(1, "/?before=6")).data.items.length, 5);
  assert.equal((await request(1, "/?before=invalid")).status, 400);
  assert.equal((await request(1, "/56/seen", "PATCH")).status, 404);
  assert.equal((await request(1, "/invalid/seen", "PATCH")).status, 400);
  assert.equal((await request(1, "/55/seen", "PATCH")).status, 200);
  assert.equal((await request(1)).data.unread, 54);
  assert.equal((await request(1, "/55/seen", "PATCH")).status, 200);
  assert.equal((await request(1)).data.unread, 54);
  assert.equal((await request(2)).data.unread, 1);
  assert.deepEqual((await request(3)).data, { items: [], unread: 0 });
});
