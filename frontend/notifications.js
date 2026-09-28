(() => {
  const list = document.getElementById("notifications-list");
  const status = document.getElementById("notifications-status");
  const badge = document.getElementById("notification-count");
  const older = document.getElementById("notifications-older");
  const tab = document.querySelector('[data-tab="notifications"]');
  const mobileMenu = document.getElementById("mobile-menu-btn");
  const pushButton = document.getElementById("enable-push-notifications");
  const pushStatus = document.getElementById("push-notifications-status");
  let items = new Map();
  let known = new Set();
  let initialized = false;
  let busy = false;
  let oldest = null;
  let notificationAudioContext = null;

  function playNotificationSound() {
    try {
      notificationAudioContext ||= new AudioContext();
      const context = notificationAudioContext;
      if (context.state === "suspended") context.resume();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      oscillator.frequency.setValueAtTime(1174, context.currentTime + 0.12);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.35);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.36);
    } catch (_error) {
      // O navegador pode bloquear som até existir uma interação do utilizador.
    }
  }

  function base64ToBytes(value) {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  }

  async function enablePushNotifications() {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isStandalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
    if (isIOS && !isStandalone) {
      throw new Error("No iPhone, abre o menu Partilhar, escolhe 'Adicionar ao ecrã principal' e abre a app pelo novo ícone.");
    }
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      throw new Error("Este iPhone precisa de iOS 16.4 ou superior e da app aberta pelo ícone do ecrã principal. Confirma também que o endereço começa por https://.");
    }
    if (!("Notification" in window)) throw new Error("As notificações não estão disponíveis neste navegador.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("A autorização para notificações foi recusada.");
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    const registration = await navigator.serviceWorker.ready;
    const keyResponse = await api("/api/push/public-key", { successMessage: false });
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToBytes(keyResponse.publicKey)
    });
    await api("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription),
      successMessage: false
    });
    pushButton.textContent = "Notificações ativas neste dispositivo";
    pushButton.disabled = true;
    pushStatus.textContent = "Este dispositivo já pode receber notificações.";
  }

  pushButton?.addEventListener("click", async () => {
    pushButton.disabled = true;
    pushStatus.textContent = "A pedir autorização...";
    try { await enablePushNotifications(); }
    catch (error) { pushStatus.textContent = error.message; pushButton.disabled = false; }
  });

  async function restorePushSubscription() {
    if (!pushButton || !window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const subscription = await registration?.pushManager.getSubscription();
      if (!subscription) return;
      await api("/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
        successMessage: false
      });
      pushButton.textContent = "Notificações ativas neste dispositivo";
      pushButton.disabled = true;
      pushStatus.textContent = "Este dispositivo já pode receber notificações.";
    } catch (_error) {
      // A subscrição continua no navegador e pode ser sincronizada no próximo acesso.
    }
  }

  restorePushSubscription();

  function showNotificationPopup(item) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const popup = document.createElement("div");
    popup.className = "toast toast-notification-popup";
    popup.setAttribute("role", "alert");
    const content = document.createElement("div");
    content.className = "notification-popup-content";
    const heading = document.createElement("strong");
    heading.textContent = "Nova notificação";
    const message = document.createElement("span");
    message.textContent = item.title;
    content.append(heading, message);
    const actions = document.createElement("div");
    actions.className = "notification-popup-actions";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Abrir";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "notification-popup-close";
    close.setAttribute("aria-label", "Fechar notificação");
    close.textContent = "×";
    const remove = () => {
      if (!popup.isConnected) return;
      popup.classList.add("toast-leaving");
      window.setTimeout(() => popup.remove(), 180);
    };
    close.addEventListener("click", remove);
    open.addEventListener("click", async () => {
      open.disabled = true;
      try {
        await acknowledge(item);
        remove();
        if (item.kind === "message") {
          setActiveTab("chat");
          document.dispatchEvent(new CustomEvent("open-chat-conversation", { detail: item.conversation_id }));
        } else {
          setActiveTab("works");
          await refreshWorksView({ workId: item.work_id });
        }
      } catch (error) { showToast(error.message, "error"); open.disabled = false; }
    });
    actions.append(open, close);
    popup.append(content, actions);
    container.appendChild(popup);
    window.setTimeout(remove, 8000);
  }

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

  async function updateAppBadge(unread) {
    try {
      if (!navigator.setAppBadge || !navigator.clearAppBadge) return;
      if (Number(unread) > 0) await navigator.setAppBadge(Number(unread));
      else await navigator.clearAppBadge();
    } catch (_error) {
      // O suporte ao badge depende do navegador e do sistema operativo.
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
        playNotificationSound();
        if (fresh.length === 1) showNotificationPopup(fresh[0]);
        else showToast(`Tens ${fresh.length} novas notificações.`, "info");
      }
      for (const item of data.items) { items.set(item.id, item); known.add(item.id); }
      if (!initialized || !oldest) {
        oldest = data.items.at(-1)?.id;
        older.classList.toggle("hidden", data.items.length < 50);
      }
      initialized = true;
      badge.textContent = data.unread > 99 ? "99+" : String(data.unread);
      badge.classList.toggle("hidden", !data.unread);
      updateAppBadge(data.unread);
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
