(() => {
  const root = document.getElementById("calendar-root");
  if (!root || !window.Calendario || typeof window.api !== "function") return;

  const editor = document.getElementById("calendar-editor");
  const form = document.getElementById("calendar-event-form");
  const status = document.getElementById("calendar-status");
  const period = document.getElementById("calendar-period");
  const search = document.getElementById("event-search");
  const title = document.getElementById("event-title");
  const date = document.getElementById("event-date");
  const endDate = document.getElementById("event-end-date");
  const dayKind = document.getElementById("event-day-kind");
  const stage = document.getElementById("event-stage");
  const state = document.getElementById("event-state");
  const notes = document.getElementById("event-notes");
  const submit = document.getElementById("event-submit");
  const cancel = document.getElementById("event-cancel");
  const isAdmin = (() => {
    try {
      return JSON.parse(localStorage.getItem("user") || "{}").role === "admin";
    } catch {
      return false;
    }
  })();

  let events = [];
  let view = "mes";
  let current = new Date();
  let editingId = null;
  let loaded = false;

  const stateLabels = {
    ok: "Confirmado",
    aviso: "Atrasado",
    problema: "Urgente",
  };

  function todayKey() {
    return Calendario.key(new Date());
  }

  function setStatus(message = "", isError = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", isError);
  }

  function updatePeriod() {
    if (!period) return;
    period.textContent = view === "ano" ? String(current.getFullYear()) : Calendario.month(current);
    document.querySelectorAll("[data-calendar-view]").forEach((button) => {
      const active = button.dataset.calendarView === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function eventLabel(item) {
    if (item.especial || item.categoria === "especial") return "Feriado / férias";
    return Calendario.etapas[item.etapa] || Calendario.tipos[item.tipo] || "Sem etapa";
  }

  function eventDateLabel(item) {
    const start = Calendario.date(item.data);
    const end = item.data_fim && item.data_fim !== item.data ? Calendario.date(item.data_fim) : null;
    return end ? `${start} a ${end}` : start;
  }

  function renderEventList() {
    const list = document.getElementById("event-list");
    if (!list) return;

    const query = (search?.value || "").trim().toLowerCase();
    const visible = Calendario
      .sorted(events)
      .filter((item) => !query || `${item.titulo} ${item.notas || ""} ${eventLabel(item)}`.toLowerCase().includes(query));

    if (!visible.length) {
      list.innerHTML = `<p class="calendar-empty">${query ? "Nenhuma marcação encontrada." : "Ainda não existem marcações."}</p>`;
      return;
    }

    list.innerHTML = visible.map((item) => `
      <article class="calendar-event-row">
        <div class="calendar-event-row-main">
          <strong>${Calendario.esc(item.titulo)}</strong>
          <span>${Calendario.esc(eventDateLabel(item))} · ${Calendario.esc(eventLabel(item))}</span>
          ${item.notas ? `<small>${Calendario.esc(item.notas)}</small>` : ""}
        </div>
        <div class="calendar-event-row-meta">
          <span class="calendar-status-badge calendar-status-${Calendario.esc(item.estado || "ok")}">${Calendario.esc(stateLabels[item.estado] || "Confirmado")}</span>
          ${isAdmin ? `
            <div class="calendar-event-actions">
              <button type="button" class="btn secondary small" data-calendar-edit="${Calendario.esc(String(item.id))}">Editar</button>
              <button type="button" class="btn secondary small calendar-delete-btn" data-calendar-delete="${Calendario.esc(String(item.id))}">Eliminar</button>
            </div>` : ""}
        </div>
      </article>
    `).join("");
  }

  function render() {
    updatePeriod();
    Calendario.render(root, view, current, events);
    renderEventList();
  }

  async function loadCalendar() {
    if (!root) return;
    setStatus("A carregar calendário…");
    try {
      const data = await window.api("/api/calendar/events", { successMessage: false });
      events = Array.isArray(data) ? data : [];
      loaded = true;
      render();
      setStatus("");
    } catch (error) {
      setStatus(error.message || "Não foi possível carregar o calendário.", true);
    }
  }

  function setEditorMode() {
    const special = dayKind?.value === "especial";
    if (stage) stage.disabled = special;
    if (endDate) endDate.disabled = !special;
    if (special && title && !title.value.trim()) title.value = "Férias / Feriado / Ponte";
  }

  function resetForm() {
    if (!form) return;
    form.reset();
    editingId = null;
    if (date) date.value = todayKey();
    if (dayKind) dayKind.value = "normal";
    if (state) state.value = "ok";
    if (submit) submit.textContent = "Adicionar marcação";
    if (cancel) {
      cancel.hidden = true;
      cancel.classList.add("hidden");
    }
    setEditorMode();
    setStatus("");
  }

  function editEvent(item) {
    if (!form || !item) return;
    editingId = String(item.id);
    title.value = item.titulo || "";
    date.value = item.data || todayKey();
    endDate.value = item.data_fim || "";
    dayKind.value = item.especial || item.categoria === "especial" ? "especial" : "normal";
    stage.value = item.etapa || item.tipo || "";
    state.value = item.estado || "ok";
    notes.value = item.notas || "";
    if (submit) submit.textContent = "Guardar alterações";
    if (cancel) {
      cancel.hidden = false;
      cancel.classList.remove("hidden");
    }
    setEditorMode();
    editor?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function saveEvent(submitEvent) {
    submitEvent.preventDefault();
    if (!isAdmin) return;

    const special = dayKind.value === "especial";
    if (!title.value.trim() || !date.value) {
      setStatus("Indica pelo menos um título e uma data.", true);
      return;
    }
    if (special && endDate.value && endDate.value < date.value) {
      setStatus("A data final não pode ser anterior à data inicial.", true);
      return;
    }

    const payload = {
      titulo: title.value.trim(),
      data: date.value,
      data_fim: special ? (endDate.value || null) : null,
      categoria: special ? "especial" : "normal",
      etapa: special ? "especial" : stage.value,
      tipo: special ? "" : stage.value,
      estado: state.value,
      notas: notes.value.trim(),
    };

    try {
      setStatus("A guardar…");
      const endpoint = editingId ? `/api/calendar/events/${encodeURIComponent(editingId)}` : "/api/calendar/events";
      const method = editingId ? "PATCH" : "POST";
      await window.api(endpoint, {
        method,
        body: payload,
        successMessage: editingId ? "Marcação atualizada." : "Marcação adicionada.",
      });
      resetForm();
      await loadCalendar();
    } catch (error) {
      setStatus(error.message || "Não foi possível guardar a marcação.", true);
    }
  }

  async function deleteEvent(id) {
    if (!isAdmin || !window.confirm("Tem a certeza de que quer eliminar esta marcação?")) return;
    try {
      await window.api(`/api/calendar/events/${encodeURIComponent(id)}`, {
        method: "DELETE",
        successMessage: "Marcação eliminada.",
      });
      if (editingId === String(id)) resetForm();
      await loadCalendar();
    } catch (error) {
      setStatus(error.message || "Não foi possível eliminar a marcação.", true);
    }
  }

  document.querySelectorAll("[data-calendar-view]").forEach((button) => {
    button.addEventListener("click", () => {
      view = button.dataset.calendarView || "mes";
      render();
    });
  });

  document.querySelectorAll("[data-calendar-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.calendarStep;
      if (step === "today") current = new Date();
      else if (view === "ano") current = new Date(current.getFullYear() + Number(step), current.getMonth(), 1);
      else current = new Date(current.getFullYear(), current.getMonth() + Number(step), 1);
      render();
    });
  });

  root.addEventListener("click", (clickEvent) => {
    const monthButton = clickEvent.target.closest("[data-month]");
    if (monthButton) {
      current = new Date(current.getFullYear(), Number(monthButton.dataset.month), 1);
      view = "mes";
      render();
      return;
    }
    const dayButton = clickEvent.target.closest("[data-date]");
    if (dayButton) Calendario.details(dayButton.dataset.date, events);
  });

  document.getElementById("event-list")?.addEventListener("click", (clickEvent) => {
    const editButton = clickEvent.target.closest("[data-calendar-edit]");
    if (editButton) {
      editEvent(events.find((item) => String(item.id) === editButton.dataset.calendarEdit));
      return;
    }
    const deleteButton = clickEvent.target.closest("[data-calendar-delete]");
    if (deleteButton) deleteEvent(deleteButton.dataset.calendarDelete);
  });

  search?.addEventListener("input", renderEventList);
  dayKind?.addEventListener("change", setEditorMode);
  form?.addEventListener("submit", saveEvent);
  cancel?.addEventListener("click", resetForm);

  if (isAdmin) {
    editor?.removeAttribute("hidden");
    editor?.classList.remove("hidden");
    resetForm();
  }

  document.querySelector('[data-tab="calendario"]')?.addEventListener("click", () => {
    if (!loaded) loadCalendar();
  });

  if (document.getElementById("tab-calendario")?.classList.contains("active")) loadCalendar();
})();
