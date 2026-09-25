(() => {
  const list = document.getElementById("notifications-list");
  const status = document.getElementById("notifications-status");
  const badge = document.getElementById("notification-count");
  const older = document.getElementById("notifications-older");
  const tab = document.querySelector('[data-tab="notifications"]');
  const mobileMenu = document.getElementById("mobile-menu-btn");
  let items = new Map();
  let known = new Set();
  let initialized = false;
  let busy = false;
  let oldest = null;

  function render() {
    list.replaceChildren();
    if (!items.size) list.textContent = "Ainda não tens notificações.";
    for (const item of [...items.values()].sort((a, b) => b.id - a.id)) {
      const row = document.createElement("div");
      row.className = "notification-item" + (item.seen ? "" : " notification-new");
      const open = document.createElement("button");
      open.type = "button";
      open.className = "notification-open";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const time = document.createElement("small");
      time.textContent = new Date(item.created_at).toLocaleString("pt-PT");
      open.append(title, time);
      open.addEventListener("click", async () => {
        open.disabled = true;
        try {
          await acknowledge(item);
          if (item.kind === "message") {
            setActiveTab("chat");
            document.dispatchEvent(new CustomEvent("open-chat-conversation", { detail: item.conversation_id }));
          } else {
            await openWorkFromClient(item.work_id);
          }
        } catch (error) { showToast(error.message, "error"); }
        finally { open.disabled = false; }
      });
      row.append(open);
      if (!item.seen) {
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "notification-dismiss";
        dismiss.textContent = "Marcar como vista";
        dismiss.addEventListener("click", async () => {
          dismiss.disabled = true;
          try { await acknowledge(item); }
          catch (error) { status.textContent = error.message; dismiss.disabled = false; }
        });
        row.append(dismiss);
      }
      list.append(row);
    }
  }

  async function acknowledge(item) {
    if (item.seen) return;
    const result = await api(`/api/notifications/${item.id}/seen`, { method: "PATCH", successMessage: false });
    if (!result) return;
    item.seen = true;
    render();
    await refresh();
  }

  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const data = await api("/api/notifications");
      if (!data) return;
      const fresh = data.items.filter((item) => !item.seen && !known.has(item.id));
      if (initialized && fresh.length) {
        showToast(fresh.length === 1 ? fresh[0].title : `Tens ${fresh.length} novas notificações.`, "info");
      }
      for (const item of data.items) { items.set(item.id, item); known.add(item.id); }
      if (!initialized || !oldest) {
        oldest = data.items.at(-1)?.id;
        older.classList.toggle("hidden", data.items.length < 50);
      }
      initialized = true;
      badge.textContent = data.unread > 99 ? "99+" : String(data.unread);
      badge.classList.toggle("hidden", !data.unread);
      tab.setAttribute("aria-label", `Notificações: ${data.unread} por consultar`);
      mobileMenu?.classList.toggle("has-notifications", data.unread > 0);
      status.textContent = "";
      render();
    } catch (error) { status.textContent = `${error.message} A tentar novamente automaticamente.`; }
    finally { busy = false; }
  }
  older.addEventListener("click", async () => {
    if (!oldest) return;
    older.disabled = true;
    try {
      const data = await api(`/api/notifications?before=${oldest}`);
      if (!data) return;
      for (const item of data.items) { items.set(item.id, item); known.add(item.id); }
      oldest = data.items.at(-1)?.id;
      older.classList.toggle("hidden", data.items.length < 50);
      render();
    } catch (error) { status.textContent = error.message; }
    finally { older.disabled = false; }
  });
  tab.addEventListener("click", refresh);
  document.addEventListener("visibilitychange", refresh);
  // Together with chat polling, this stays below the default API rate limit.
  setInterval(refresh, 15000);
  refresh();
})();
