(() => {
  const slides = Array.from(document.querySelectorAll(".tv-slide"));
  const stageSlides = Array.from(document.querySelectorAll(".tv-stage-slide"));
  const calendarSlides = Array.from(document.querySelectorAll(".tv-calendar-slide"));
  const clock = document.getElementById("tv-clock");
  const pageCount = document.getElementById("tv-page-count");
  const pauseButton = document.getElementById("tv-pause");
  const errorBox = document.getElementById("tv-error");
  const mobileLayout = window.matchMedia("(max-width: 800px)");
  const stageDays = [
    { key: "segunda", label: "Segunda" },
    { key: "terca", label: "Terça" },
    { key: "quarta", label: "Quarta" },
    { key: "quinta", label: "Quinta" },
    { key: "sexta", label: "Sexta" },
    { key: "sabado", label: "Sábado" },
  ];
  const calendarDates = { semanas: new Date(), mes: new Date(), ano: new Date() };
  let events = [];
  let slideIndex = 0;
  let rotationPaused = mobileLayout.matches;
  let wakeLock = null;

  function key(value) {
    return Calendario.key(value);
  }

  function startOfWeek(value = new Date()) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate() - ((value.getDay() + 6) % 7), 12);
  }

  function eventOverlaps(event, from, to) {
    return event.data <= key(to) && (event.data_fim ? event.data_fim >= key(from) : event.data >= key(from));
  }

  function currentWeekEvents(stage) {
    const from = startOfWeek();
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6, 12);
    return events.filter((event) => event.etapa === stage && eventOverlaps(event, from, to));
  }

  function eventState(items) {
    if (items.some((event) => event.estado === "problema")) return "tv-problema";
    if (items.some((event) => event.estado === "aviso")) return "tv-aviso";
    return "tv-ok";
  }

  function fitCardText(card) {
    const heading = card.querySelector("h2");
    const text = card.querySelector("p");
    if (!heading || !text || !card.clientWidth || !card.clientHeight) return;
    let scale = 1;
    heading.style.fontSize = "36px";
    text.style.fontSize = "48px";
    while ((card.scrollHeight > card.clientHeight || card.scrollWidth > card.clientWidth || text.scrollWidth > text.clientWidth || heading.scrollWidth > heading.clientWidth) && scale > 0.3) {
      scale -= 0.04;
      heading.style.fontSize = `${Math.max(14, 36 * scale)}px`;
      text.style.fontSize = `${Math.max(16, 48 * scale)}px`;
    }
  }

  function fitVisibleSlide() {
    const active = document.querySelector(".tv-slide.active");
    if (!active || mobileLayout.matches) return;
    const heading = active.querySelector("h1");
    if (heading) {
      let size = Math.min(70, Math.max(38, window.innerWidth * 0.05));
      heading.style.fontSize = `${size}px`;
      while (heading.scrollWidth > heading.clientWidth && size > 26) {
        size -= 2;
        heading.style.fontSize = `${size}px`;
      }
    }
    active.querySelectorAll(".tv-card").forEach(fitCardText);
  }

  function scheduleFit() {
    requestAnimationFrame(() => requestAnimationFrame(fitVisibleSlide));
  }

  function renderStage(slide) {
    const stage = slide.dataset.stage;
    const columns = [slide.querySelector('[data-column="1"]'), slide.querySelector('[data-column="2"]')];
    columns.forEach((column) => { column.innerHTML = ""; });
    const from = startOfWeek();
    const grouped = new Map();
    currentWeekEvents(stage).forEach((event) => {
      const date = Calendario.date(event.data);
      const dayIndex = (date.getDay() + 6) % 7;
      if (dayIndex > 5) return;
      if (!grouped.has(dayIndex)) grouped.set(dayIndex, []);
      grouped.get(dayIndex).push(event);
    });

    stageDays.forEach((day, index) => {
      const items = grouped.get(index) || [];
      if (!items.length) return;
      const card = document.createElement("article");
      card.className = `tv-card ${eventState(items)}`;
      const names = items.map((event) => `${event.titulo}${event.notas ? ` - (${event.notas})` : ""}`).join("\n");
      card.innerHTML = `<h2>${day.label}</h2><p>${Calendario.esc(names)}</p>`;
      card.querySelector("p").innerHTML = Calendario.esc(names).replace(/\n/g, "<br>");
      columns[index < 3 ? 0 : 1].appendChild(card);
    });
    slide.classList.toggle("tv-planned-visible", stageSlides.indexOf(slide) < 6 || grouped.size > 0);
  }

  function renderCalendar(slide) {
    const view = slide.dataset.calendarView;
    const date = calendarDates[view];
    slide.querySelector(".tv-calendar-period").textContent = view === "ano" ? String(date.getFullYear()) : Calendario.month(date);
    Calendario.render(slide.querySelector(".tv-calendar-root"), view, date, events);
  }

  function renderAll() {
    stageSlides.forEach(renderStage);
    calendarSlides.forEach(renderCalendar);
    const available = activeSlides();
    if (!available.includes(document.querySelector(".tv-slide.active"))) slideIndex = Math.min(slideIndex, available.length - 1);
    showSlide(slideIndex);
    scheduleFit();
  }

  function activeSlides() {
    return slides.filter((slide) => !slide.classList.contains("tv-conditional-slide") || slide.classList.contains("tv-planned-visible"));
  }

  function showSlide(index) {
    const available = activeSlides();
    if (!available.length) return;
    slideIndex = (index + available.length) % available.length;
    slides.forEach((slide) => slide.classList.remove("active"));
    available[slideIndex].classList.add("active");
    pageCount.textContent = `${slideIndex + 1} / ${available.length}`;
    scheduleFit();
  }

  function updateClock() {
    clock.textContent = new Date().toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setError(message = "") {
    errorBox.textContent = message;
    errorBox.classList.toggle("visible", Boolean(message));
  }

  async function loadEvents() {
    const displayToken = new URLSearchParams(window.location.search).get("token");
    const loginToken = localStorage.getItem("token");
    const endpoint = displayToken
      ? window.apiUrl(`/api/public/calendar/events?token=${encodeURIComponent(displayToken)}`)
      : window.apiUrl("/api/calendar/events");
    const headers = displayToken || !loginToken ? {} : { Authorization: `Bearer ${loginToken}` };
    try {
      const response = await fetch(endpoint, { headers, cache: "no-store" });
      const text = await response.text();
      let data;
      try { data = text ? JSON.parse(text) : []; } catch { throw new Error("O servidor devolveu uma resposta inválida."); }
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar o painel.");
      events = Array.isArray(data) ? data : [];
      setError("");
      renderAll();
    } catch (error) {
      setError(error.message || "Não foi possível carregar o painel.");
    }
  }

  async function keepScreenAwake() {
    if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (_error) { /* alguns televisores não suportam Wake Lock */ }
  }

  document.querySelectorAll(".tv-calendar-slide").forEach((slide) => {
    slide.addEventListener("click", (event) => {
      const view = slide.dataset.calendarView;
      const step = event.target.closest("[data-tv-step]");
      if (step) {
        if (step.dataset.tvStep === "today") calendarDates[view] = new Date();
        else if (view === "ano") calendarDates[view] = new Date(calendarDates[view].getFullYear() + Number(step.dataset.tvStep), calendarDates[view].getMonth(), 1, 12);
        else calendarDates[view] = new Date(calendarDates[view].getFullYear(), calendarDates[view].getMonth() + Number(step.dataset.tvStep), 1, 12);
        renderCalendar(slide);
      }
      const day = event.target.closest("[data-date]");
      if (day) Calendario.details(day.dataset.date, events);
      const month = event.target.closest("[data-month]");
      if (month) {
        calendarDates.mes = new Date(calendarDates.ano.getFullYear(), Number(month.dataset.month), 1, 12);
        const monthSlide = document.querySelector('[data-calendar-view="mes"]');
        renderCalendar(monthSlide);
        showSlide(activeSlides().indexOf(monthSlide));
      }
    });
  });

  document.getElementById("tv-previous").addEventListener("click", () => showSlide(slideIndex - 1));
  document.getElementById("tv-next").addEventListener("click", () => showSlide(slideIndex + 1));
  pauseButton.addEventListener("click", () => {
    rotationPaused = !rotationPaused;
    pauseButton.textContent = rotationPaused ? "Retomar" : "Pausar";
  });
  window.addEventListener("resize", scheduleFit);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") keepScreenAwake(); });

  updateClock();
  setInterval(updateClock, 1000);
  setInterval(() => { if (!rotationPaused && !document.querySelector("dialog[open]")) showSlide(slideIndex + 1); }, 10000);
  setInterval(loadEvents, 15000);
  window.addEventListener("focus", loadEvents);
  keepScreenAwake();
  pauseButton.textContent = rotationPaused ? "Retomar" : "Pausar";
  renderAll();
  loadEvents();
})();
