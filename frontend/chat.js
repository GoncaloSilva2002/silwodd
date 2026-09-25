(() => {
  const el = (id) => document.getElementById(`chat-${id}`);
  let current = null;
  let messages = [];
  let busy = false;
  let generation = 0;
  let loadedUsers = false;
  const drafts = new Map();
  const participant = (c) => [c.user_a, c.user_b].some((id) => id != null && Number(id) === Number(user.id));
  const label = (c) => participant(c) ? (Number(c.user_a) === Number(user.id) ? c.name_b : c.name_a) : `${c.name_a} · ${c.name_b}`;
  const fail = (error) => { el("status").textContent = error.message; };
  if (user.role === "admin") el("list-title").textContent = "Todas as conversas";

  function renderMessages(scroll = false) {
    const box = el("messages");
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.replaceChildren();
    for (const m of messages) {
      const item = document.createElement("article");
      item.className = "chat-message" + (Number(m.sender_id) === Number(user.id) ? " chat-mine" : "");
      const meta = document.createElement("small");
      meta.textContent = `${m.sender_name} · ${new Date(m.created_at).toLocaleString("pt-PT")}`;
      const body = document.createElement("p");
      body.textContent = m.body;
      item.append(meta, body);
      box.append(item);
    }
    if (!messages.length) box.textContent = "Ainda não há mensagens nesta conversa.";
    if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
  }

  async function select(c) {
    if (current) drafts.set(current.id, el("body").value);
    current = c;
    const revision = ++generation;
    messages = [];
    el("body").value = drafts.get(c.id) || "";
    el("title").textContent = label(c);
    el("send").classList.toggle("hidden", !participant(c) || c.user_a == null || c.user_b == null);
    el("readonly").classList.toggle("hidden", participant(c));
    el("older").classList.add("hidden");
    el("messages").textContent = "A carregar mensagens…";
    document.querySelectorAll(".chat-conversation").forEach((b) => b.classList.toggle("selected", b.dataset.id === String(c.id)));
    try {
      const rows = await api(`/api/chat/conversations/${c.id}/messages`);
      if (revision !== generation || !rows) return;
      messages = rows;
      el("older").classList.toggle("hidden", rows.length < 100);
      renderMessages(true);
      el("status").textContent = "";
    } catch (error) { if (revision === generation) fail(error); }
  }

  async function refresh() {
    if (busy || document.hidden || document.getElementById("tab-chat").classList.contains("hidden")) return;
    busy = true;
    const revision = generation;
    try {
      if (!loadedUsers) {
        const people = await api("/api/chat/users");
        if (!people) return;
        for (const person of people) el("recipient").add(new Option(person.username, person.id));
        loadedUsers = true;
      }
      const conversations = await api("/api/chat/conversations");
      if (!conversations) return;
      el("conversations").replaceChildren();
      if (!conversations.length) el("conversations").textContent = "Ainda não há conversas.";
      for (const c of conversations) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-conversation" + (current?.id === c.id ? " selected" : "");
        button.dataset.id = c.id;
        const name = document.createElement("strong");
        name.textContent = label(c);
        const preview = document.createElement("small");
        preview.textContent = c.last_message || "Sem mensagens";
        button.append(name, preview);
        button.addEventListener("click", () => select(c));
        el("conversations").append(button);
      }
      if (current && revision === generation) {
        const last = messages.at(-1)?.id;
        const rows = await api(`/api/chat/conversations/${current.id}/messages${last ? `?after=${last}` : ""}`);
        if (revision !== generation || !rows) return;
        if (rows.length) {
          const existing = new Set(messages.map((m) => m.id));
          messages.push(...rows.filter((m) => !existing.has(m.id)));
          messages.sort((a, b) => a.id - b.id);
          if (!last) el("older").classList.toggle("hidden", rows.length < 100);
          renderMessages();
        }
      }
      el("status").textContent = "";
    } catch (error) { fail(error); }
    finally { busy = false; }
  }

  el("start").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const c = await api("/api/chat/conversations", { method: "POST", body: JSON.stringify({ recipient_id: el("recipient").value }) });
      if (c) { await select(c); await refresh(); }
    } catch (error) { fail(error); }
    finally { button.disabled = false; }
  });
  el("send").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!current || !el("body").value.trim()) return;
    const c = current;
    const body = el("body").value;
    const button = event.submitter;
    button.disabled = true;
    try {
      const sent = await api(`/api/chat/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      if (!sent) return;
      drafts.delete(c.id);
      if (current.id === c.id) {
        if (el("body").value === body) el("body").value = "";
        // Fetch from the last cursor so concurrent incoming messages are not skipped.
        await refresh();
      }
    } catch (error) { fail(error); }
    finally { button.disabled = false; }
  });
  el("older").addEventListener("click", async () => {
    if (!current || !messages.length) return;
    const revision = generation;
    el("older").disabled = true;
    try {
      const rows = await api(`/api/chat/conversations/${current.id}/messages?before=${messages[0].id}`);
      if (revision !== generation || !rows) return;
      const box = el("messages");
      const height = box.scrollHeight;
      const top = box.scrollTop;
      messages.unshift(...rows);
      renderMessages();
      box.scrollTop = top + box.scrollHeight - height;
      el("older").classList.toggle("hidden", rows.length < 100);
    } catch (error) { fail(error); }
    finally { el("older").disabled = false; }
  });
  document.querySelector('[data-tab="chat"]').addEventListener("click", refresh);
  document.addEventListener("visibilitychange", refresh);
  const timer = setInterval(refresh, 6000);
  window.addEventListener("pagehide", () => clearInterval(timer));
})();
