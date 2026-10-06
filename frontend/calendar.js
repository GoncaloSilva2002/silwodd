/* Renderização do calendário sem conversões de fuso horário. */
window.Calendario = (() => {
  const tipos = { obra: "Fim de obra", inicio_obra: "Início de obra", camiao: "Carregar camião" };
  const etapas = {
    obra: "Fim de obra",
    inicio_obra: "Início de obra",
    camiao: "Carregar camião",
    corte: "Corte",
    orlar: "Orlar",
    cnc: "CNC",
    embalar: "Embalar",
    montagem_fabrica: "Montagem Fábrica",
    pintura: "Pintura",
    montagem_obra: "Montagem Obra"
  };
  const dias = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
  const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const date = (value) => new Date(`${value}T12:00:00`);
  const add = (dateValue, amount) => new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate() + amount, 12);
  const month = (dateValue) => dateValue.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  const short = (dateValue) => dateValue.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
  const sorted = (events) => (Array.isArray(events) ? events : [])
    .filter((event) => event && /^\d{4}-\d{2}-\d{2}$/.test(event.data) && !Number.isNaN(date(event.data).getTime()))
    .sort((a, b) => `${a.data}${a.hora || ""}`.localeCompare(`${b.data}${b.hora || ""}`));
  const covers = (event, iso) => event.data <= iso && (event.data_fim ? event.data_fim >= iso : event.data === iso);
  const badge = (event, withDate = false, showStage = true) => {
    const special = event.categoria === "especial";
    const stage = special ? "Férias / Feriado / Ponte" : (etapas[event.etapa] || tipos[event.tipo] || "Sem etapa");
    const detail = showStage
      ? `${stage}${event.data_fim ? ` · até ${esc(short(date(event.data_fim)))}` : ""}`
      : "";
    return `<div class="cal-event ${special ? "especial" : "trabalho"}" title="${esc([event.titulo, stage, event.notas].filter(Boolean).join(" — "))}"><b>${withDate ? `${short(date(event.data))} · ` : ""}${esc(event.titulo)}</b>${detail ? `<small>${detail}</small>` : ""}</div>`;
  };

  function grid(dateValue, events, mini = false) {
    const first = new Date(dateValue.getFullYear(), dateValue.getMonth(), 1, 12);
    const start = add(first, -((first.getDay() + 6) % 7));
    const today = key(new Date());
    let html = dias.map((day) => `<div class="cal-weekday">${day}</div>`).join("");
    for (let index = 0; index < 42; index += 1) {
      const day = add(start, index);
      const iso = key(day);
      const own = day.getMonth() === dateValue.getMonth();
      const items = events.filter((event) => covers(event, iso));
      const specialDay = items.some((event) => event.categoria === "especial");
      const dayKind = items.length ? (specialDay ? "special-day" : "work-day") : "";
      html += `<${mini ? "span" : "button"} ${mini ? "" : 'type="button"'} class="cal-day ${own ? "" : "muted"} ${iso === today ? "today" : ""} ${items.length ? "marked" : ""} ${dayKind}" ${mini ? "" : `data-date="${iso}"`} title="${esc(`${iso}${items.length ? `: ${items.map((event) => event.titulo).join(", ")}` : ""}`)}"><span>${day.getDate()}</span>${mini ? (items.length ? "<i></i>" : "") : items.slice(0, 2).map((event) => badge(event)).join("") + (items.length > 2 ? `<small>+${items.length - 2} marcações</small>` : "")}</${mini ? "span" : "button"}>`;
    }
    return `<div class="cal-grid ${mini ? "mini" : ""}">${html}</div>`;
  }

  function render(root, view, dateValue, input) {
    const events = sorted(input);
    const year = dateValue.getFullYear();
    const monthIndex = dateValue.getMonth();
    root.replaceChildren();
    if (view === "mes") root.innerHTML = grid(dateValue, events);
    if (view === "semanas") {
      const first = new Date(year, monthIndex, 1, 12);
      const last = new Date(year, monthIndex + 1, 0, 12);
      let start = add(first, -((first.getDay() + 6) % 7));
      let index = 1;
      let html = "";
      while (start <= last) {
        const end = add(start, 6);
        const from = start < first ? first : start;
        const to = end > last ? last : end;
        const items = events.filter((event) => event.data <= key(to) && (event.data_fim ? event.data_fim >= key(from) : event.data >= key(from) && event.data <= key(to)));
        html += `<section class="cal-week"><h2>Semana ${index++}</h2><div class="cal-range">${short(from)} – ${short(to)}</div><div class="cal-week-events">${items.length ? items.map((event) => `<button type="button" class="cal-event-button" data-date="${esc(event.data)}">${badge(event, true, false)}</button>`).join("") : '<div class="cal-empty">Sem marcações</div>'}</div></section>`;
        start = add(start, 7);
      }
      root.innerHTML = `<div class="cal-weeks">${html}</div>`;
    }
    if (view === "ano") {
      root.innerHTML = `<div class="cal-year">${Array.from({ length: 12 }, (_, index) => {
        const monthDate = new Date(year, index, 1, 12);
        const monthStart = key(monthDate);
        const monthEnd = key(new Date(year, index + 1, 0, 12));
        const items = events.filter((event) => event.data <= monthEnd && (event.data_fim ? event.data_fim >= monthStart : event.data >= monthStart && event.data <= monthEnd));
        return `<button type="button" class="cal-month" data-month="${index}"><strong>${esc(monthDate.toLocaleDateString("pt-PT", { month: "long" }))}<small>${items.length} marcações</small></strong>${grid(monthDate, items, true)}<span class="cal-month-summary">${items.length ? `${items.slice(0, 2).map((event) => `${short(date(event.data))} ${esc(event.titulo)}`).join(" · ")}${items.length > 2 ? ` · +${items.length - 2}` : ""}` : "Sem marcações"}</span></button>`;
      }).join("")}</div>`;
    }
  }

  function details(iso, input) {
    const dialog = document.createElement("dialog");
    dialog.className = "cal-dialog";
    const items = sorted(input).filter((event) => covers(event, iso));
    dialog.innerHTML = `<h2>${esc(date(iso).toLocaleDateString("pt-PT", { dateStyle: "full" }))}</h2>${items.length ? items.map((event) => badge(event)).join("") : "<p>Sem marcações para este dia.</p>"}<form method="dialog"><button>Fechar</button></form>`;
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }

  return { tipos, etapas, key, date, month, esc, sorted, covers, render, details };
})();
