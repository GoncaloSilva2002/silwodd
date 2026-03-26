const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

if (!token) {
  window.location.href = "/login.html";
}

document.body.classList.add(`role-${String(user.role || "user").toLowerCase()}`);

const welcomeLine = document.getElementById("welcome-line");
const logoutBtn = document.getElementById("logout-btn");
const tabButtons = document.querySelectorAll(".tab-btn");
const tabWorks = document.getElementById("tab-works");
const tabClients = document.getElementById("tab-clients");
const tabLogs = document.getElementById("tab-logs");
const tabAddWork = document.getElementById("tab-add-work");
const tabAddClient = document.getElementById("tab-add-client");
const tabUsers = document.getElementById("tab-users");
const worksList = document.getElementById("works-list");
const clientsList = document.getElementById("clients-list");
const logsList = document.getElementById("logs-list");
const usersList = document.getElementById("users-list");
const clientForm = document.getElementById("client-form");
const workForm = document.getElementById("work-form");
const userForm = document.getElementById("user-form");
const workClientIdInput = document.getElementById("work-client");
const workClientNameInput = document.getElementById("work-client-input");
const workClientMenu = document.getElementById("work-client-menu");
const worksClientSearchInput = document.getElementById("works-client-search");
const worksClientSearchMenu = document.getElementById("works-client-search-menu");
const worksSearchBtn = document.getElementById("works-search-btn");
const worksClearBtn = document.getElementById("works-clear-btn");
const clientsSearchInput = document.getElementById("clients-search");
const clientsSearchMenu = document.getElementById("clients-search-menu");
const clientsSearchBtn = document.getElementById("clients-search-btn");
const clientsClearBtn = document.getElementById("clients-clear-btn");
const logsWorkSearchInput = document.getElementById("logs-work-search");
const logsSearchBtn = document.getElementById("logs-search-btn");
const logsClearBtn = document.getElementById("logs-clear-btn");
const statusFilterButtons = document.querySelectorAll(".status-filter-btn");
const clientNameToId = new Map();
let clientAutocompleteItems = [];
let clientByNormalizedName = new Map();
let worksFilterStatus = "";
let worksFilterClient = "";
let worksFilterClientId = "";
let clientsFilterTerm = "";
let clientsFilterClientId = "";
let logsFilterWork = "";
let clientsCache = [];
let usersCache = [];
let logsCache = [];

const materialTypes = [
  { key: "stone", label: "Pedra" },
  { key: "wood_panels", label: "Placas de madeira" },
  { key: "hardware", label: "Ferragens" },
  { key: "paint", label: "Tinta" }
];
const processSteps = [
  { key: "kitchen_design", label: "Desenho da cozinha" },
  { key: "cutting", label: "Corte" },
  { key: "cnc", label: "CNC" },
  { key: "assembly", label: "Montagem" },
  { key: "painting", label: "Pintura" },
  { key: "loaded", label: "Carregar" },
  { key: "unloaded", label: "Descarregar" },
  { key: "installation_start", label: "Inicio de montagem" },
  { key: "installation_end", label: "Fim de montagem" }
];
const processStepIcons = {
  kitchen_design: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18h16v2H4zm2-3 8-8 3 3-8 8H6zm9-9 1.5-1.5a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4L18 9z" fill="currentColor"></path>
    </svg>
  `,
  cutting: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 4h4v5l4 2v2l-4 2v5h-4v-5l-4-2v-2l4-2z" fill="currentColor"></path>
    </svg>
  `,
  cnc: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v12H4zm3 3v6h10V9zm4-5h2v3h-2z" fill="currentColor"></path>
    </svg>
  `,
  assembly: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m7 4 3 3-2 2 2 2-3 3-5-5zm10 6 3 3-8 8H9v-3zM14 4h6v6h-2V7.4l-4.3 4.3-1.4-1.4L16.6 6H14z" fill="currentColor"></path>
    </svg>
  `,
  painting: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 17h10v3H3zm8-8h10l-2 6H9zm1-4h6l2 3H10z" fill="currentColor"></path>
    </svg>
  `,
  loaded: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7h11v8H3zm11 2h3l3 3v3h-6zm-8 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm11 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" fill="currentColor"></path>
    </svg>
  `,
  unloaded: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v10H4zm8 13-4-4h3v-4h2v4h3z" fill="currentColor"></path>
    </svg>
  `,
  installation_start: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 10h2v10h5v-6h4v6h5V10h2z" fill="currentColor"></path>
    </svg>
  `,
  installation_end: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 3 10h2v10h14V10h2zm-2 12 7-7 1.4 1.4L10 17.8l-3.4-3.4L8 13z" fill="currentColor"></path>
    </svg>
  `
};
const statusOptions = [
  { value: "pending", label: "Pendente" },
  { value: "in_progress", label: "Em progresso" },
  { value: "done", label: "Concluida" },
  { value: "suspended", label: "Suspensa" }
];
const priorityOptions = [
  { value: "high", label: "Alta" },
  { value: "medium", label: "Media" },
  { value: "low", label: "Baixa" }
];

welcomeLine.textContent = `Utilizador: ${user.username || "N/A"} (${user.role || "user"})`;

if (user.role !== "admin") {
  const addWorkTabButton = document.querySelector('.tab-btn[data-tab="add-work"]');
  const addClientTabButton = document.querySelector('.tab-btn[data-tab="add-client"]');
  const addUserTabButton = document.querySelector('.tab-btn[data-tab="users"]');
  const logsTabButton = document.querySelector('.tab-btn[data-tab="logs"]');
  if (addWorkTabButton) addWorkTabButton.classList.add("hidden");
  if (addClientTabButton) addClientTabButton.classList.add("hidden");
  if (addUserTabButton) addUserTabButton.classList.add("hidden");
  if (logsTabButton) logsTabButton.classList.add("hidden");
  tabAddWork.classList.add("hidden");
  tabAddClient.classList.add("hidden");
  tabUsers.classList.add("hidden");
  if (tabLogs) tabLogs.classList.add("hidden");
}

logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "/login.html";
});

function setActiveTab(tab) {
  const sections = {
    works: tabWorks,
    clients: tabClients,
    logs: tabLogs,
    "add-work": tabAddWork,
    "add-client": tabAddClient,
    users: tabUsers
  };

  Object.entries(sections).forEach(([key, section]) => {
    if (!section) return;
    section.classList.toggle("hidden", key !== tab);
  });

  tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });

  if (tab === "add-work") {
    renderClientMenu(workClientNameInput.value);
  }
}

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
  });
});

function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function api(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };
  if (!(options.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(path, {
    ...options,
    headers
  });

  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
    return null;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "Erro no pedido.");
  }
  return data;
}

function materialHtml(work, material) {
  const pdfPath = work[`${material.key}_pdf_path`];
  const ordered = Boolean(work[`${material.key}_ordered`]);
  const arrived = Boolean(work[`${material.key}_arrived`]);

  return `
    <div class="material-item" data-work-id="${work.id}" data-material-key="${material.key}">
      <div class="material-head">
        <h4>${material.label}</h4>
        ${
          pdfPath
            ? `
              <div class="material-links">
                <a class="material-link" href="${escapeHtml(pdfPath)}" target="_blank" rel="noopener noreferrer">Ver PDF</a>
                <a class="material-link" href="${escapeHtml(pdfPath)}" download>Download PDF</a>
              </div>
            `
            : `<span class="muted">Sem PDF</span>`
        }
      </div>
      <div class="material-toggle-row">
        <span>Encomendado</span>
        <button type="button" class="material-toggle-btn material-ordered ${ordered ? "done" : ""}" aria-label="${ordered ? "Encomendado" : "Marcar como encomendado"}">
          <span class="material-toggle-square" aria-hidden="true"></span>
        </button>
      </div>
      <div class="material-toggle-row">
        <span>Recebido</span>
        <button type="button" class="material-toggle-btn material-arrived ${arrived ? "done" : ""}" aria-label="${arrived ? "Recebido" : "Marcar como recebido"}">
          <span class="material-toggle-square" aria-hidden="true"></span>
        </button>
      </div>
      <div class="material-actions">
        <input type="file" class="material-file" accept="application/pdf" />
        <button type="button" class="upload-material-btn">Anexar PDF</button>
      </div>
    </div>
  `;
}

function renderMaterialLinks(pdfPath) {
  if (!pdfPath) return `<span class="muted">Sem PDF</span>`;
  const safePath = escapeHtml(pdfPath);
  return `
    <div class="material-links">
      <a class="material-link" href="${safePath}" target="_blank" rel="noopener noreferrer">Ver PDF</a>
      <a class="material-link" href="${safePath}" download>Download PDF</a>
    </div>
  `;
}

function updateMaterialItemFromWork(materialItem, work) {
  if (!materialItem || !work) return;
  const materialKey = materialItem.dataset.materialKey;
  if (!materialKey) return;

  const ordered = Boolean(work[`${materialKey}_ordered`]);
  const arrived = Boolean(work[`${materialKey}_arrived`]);
  const pdfPath = work[`${materialKey}_pdf_path`] || null;

  const orderedInput = materialItem.querySelector(".material-ordered");
  const arrivedInput = materialItem.querySelector(".material-arrived");
  if (orderedInput) {
    orderedInput.classList.toggle("done", ordered);
    orderedInput.setAttribute("aria-label", ordered ? "Encomendado" : "Marcar como encomendado");
  }
  if (arrivedInput) {
    arrivedInput.classList.toggle("done", arrived);
    arrivedInput.setAttribute("aria-label", arrived ? "Recebido" : "Marcar como recebido");
  }

  const linksContainer = materialItem.querySelector(".material-head > :last-child");
  if (linksContainer) {
    linksContainer.outerHTML = renderMaterialLinks(pdfPath);
  }
}

function processStepHtml(work, step) {
  const stepIndex = processSteps.findIndex((item) => item.key === step.key);
  const previousStep = stepIndex > 0 ? processSteps[stepIndex - 1] : null;
  const previousDone = previousStep ? Boolean(work[`${previousStep.key}_done`]) : true;
  const done = Boolean(work[`${step.key}_done`]);
  const pdfPath = work[`${step.key}_pdf_path`] || null;
  const blockedByOrder = !previousDone && !done;
  const canUploadPdf = step.key === "kitchen_design";
  const pdfHtml = canUploadPdf
    ? `
      <div class="process-pdf-links">
        ${renderMaterialLinks(pdfPath)}
      </div>
      <div class="material-actions">
        <input type="file" class="process-file" accept="application/pdf" />
        <button type="button" class="upload-process-btn">Anexar PDF</button>
      </div>
    `
    : "";
  return `
    <div class="process-item" data-work-id="${work.id}" data-step-key="${step.key}">
      <div class="process-step-head">
        <span class="process-step-icon">${processStepIcons[step.key] || ""}</span>
        <h4>${step.label}</h4>
      </div>
      <button type="button" class="process-toggle-btn ${done ? "done" : ""}" ${blockedByOrder ? "disabled" : ""} aria-label="${done ? "Etapa feita" : "Marcar etapa como feita"}">
        <span class="process-toggle-square" aria-hidden="true"></span>
      </button>
      <p class="muted process-order-hint ${blockedByOrder ? "" : "hidden"}">Conclui a etapa anterior primeiro.</p>
      ${pdfHtml}
    </div>
  `;
}

function applyProcessSequenceUI(workItem) {
  const processItems = Array.from(workItem.querySelectorAll(".process-item"));
  let previousDone = true;

  for (const item of processItems) {
    const toggleButton = item.querySelector(".process-toggle-btn");
    const hint = item.querySelector(".process-order-hint");
    if (!toggleButton) continue;

    const isChecked = toggleButton.classList.contains("done");
    const blocked = !previousDone && !isChecked;
    toggleButton.disabled = blocked;
    if (hint) hint.classList.toggle("hidden", !blocked);
    previousDone = isChecked;
  }
}

function updateProcessItemFromWork(processItem, work) {
  if (!processItem || !work) return;
  const stepKey = processItem.dataset.stepKey;
  if (!stepKey) return;

  const doneButton = processItem.querySelector(".process-toggle-btn");
  const done = Boolean(work[`${stepKey}_done`]);
  if (doneButton) {
    doneButton.classList.toggle("done", done);
    doneButton.setAttribute("aria-label", done ? "Etapa feita" : "Marcar etapa como feita");
  }

  if (stepKey === "kitchen_design") {
    const linksWrapper = processItem.querySelector(".process-pdf-links");
    const pdfPath = work[`${stepKey}_pdf_path`] || null;
    if (linksWrapper) {
      linksWrapper.innerHTML = renderMaterialLinks(pdfPath);
    }
    const fileInput = processItem.querySelector(".process-file");
    if (fileInput) fileInput.value = "";
  }
}

function updateWorkCardFromWork(workItem, work) {
  if (!workItem || !work) return;

  const meta = workItem.querySelector(".work-summary-meta");
  if (meta) {
    meta.textContent = `Cliente: ${work.client_name || "Sem cliente"} | Estado: ${statusLabel(work.status)} | Prioridade: ${priorityLabel(work.priority)}`;
  }

  const statusSelect = workItem.querySelector(".work-status-select");
  if (statusSelect) {
    if (work.status) statusSelect.value = work.status;
    statusSelect.disabled = user.role !== "admin";
    syncWorkStatusOptions(statusSelect, work);
  }

  const saveStatusButton = workItem.querySelector(".save-work-status-btn");
  if (saveStatusButton) {
    saveStatusButton.disabled = user.role !== "admin";
  }

  const prioritySelect = workItem.querySelector(".work-priority-select");
  if (prioritySelect) {
    if (work.priority) prioritySelect.value = work.priority;
    prioritySelect.disabled = user.role !== "admin";
  }

  const savePriorityButton = workItem.querySelector(".save-work-priority-btn");
  if (savePriorityButton) {
    savePriorityButton.disabled = user.role !== "admin";
  }

  const observationsInput = workItem.querySelector(".work-observations-input");
  if (observationsInput) {
    observationsInput.value = work.observations || "";
  }
}

function syncWorkStatusOptions(statusSelect, work) {
  if (!statusSelect || !work) return;
  const canSetInProgress = Boolean(work.kitchen_design_done);
  const inProgressOption = statusSelect.querySelector('option[value="in_progress"]');
  if (inProgressOption) {
    inProgressOption.disabled = !canSetInProgress;
  }
}

function statusLabel(value) {
  const found = statusOptions.find((status) => status.value === value);
  return found ? found.label : value;
}

function priorityLabel(value) {
  const found = priorityOptions.find((priority) => priority.value === value);
  return found ? found.label : "Media";
}

function formatLogDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-PT");
}

function formatLogDetails(details) {
  if (!details) return "";
  if (typeof details === "string") return details;
  return Object.entries(details)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${value}`)
    .join(" | ");
}

function renderWorks(items, target) {
  if (!items.length) {
    target.innerHTML = "<p class='muted'>Sem registos.</p>";
    return;
  }
  target.innerHTML = items
    .map(
      (w) => `
      <article class="work-item" data-work-id="${w.id}">
        <button type="button" class="work-summary-btn">
          <span><strong>${escapeHtml(w.title)}</strong></span>
          <span class="work-summary-meta">Cliente: ${escapeHtml(w.client_name || "Sem cliente")} | Estado: ${escapeHtml(statusLabel(w.status))} | Prioridade: ${escapeHtml(priorityLabel(w.priority))}</span>
        </button>
        <div class="work-details hidden">
          <div class="work-config-row">
            <div class="material-actions">
              <label><strong>Estado da obra</strong></label>
              <select class="work-status-select">
                ${statusOptions
                  .map((status) => `<option value="${status.value}" ${w.status === status.value ? "selected" : ""}>${status.label}</option>`)
                  .join("")}
              </select>
              <button type="button" class="save-work-status-btn">Guardar estado</button>
            </div>
            <div class="material-actions">
              <label><strong>Prioridade</strong></label>
              <select class="work-priority-select">
                ${priorityOptions
                  .map((priority) => `<option value="${priority.value}" ${String(w.priority || "medium") === priority.value ? "selected" : ""}>${priority.label}</option>`)
                  .join("")}
              </select>
              <button type="button" class="save-work-priority-btn">Guardar prioridade</button>
            </div>
          </div>
          <p><strong>Prazo:</strong> ${escapeHtml(w.due_date || "Sem data")}</p>
          <p class="muted">${escapeHtml(w.description || "")}</p>
          <div class="detail-tabs">
            <button type="button" class="detail-tab-btn active" data-detail-tab="materials">Materiais</button>
            <button type="button" class="detail-tab-btn" data-detail-tab="process">Etapas do Processo</button>
            <button type="button" class="detail-tab-btn" data-detail-tab="observations">Observacoes</button>
          </div>
          <div class="detail-panel detail-panel-materials">
            <div class="materials-grid">
              ${materialTypes.map((material) => materialHtml(w, material)).join("")}
            </div>
          </div>
          <div class="detail-panel detail-panel-process hidden">
            <div class="process-grid">
              ${processSteps.map((step) => processStepHtml(w, step)).join("")}
            </div>
          </div>
          <div class="detail-panel detail-panel-observations hidden">
            <div class="work-observations-box">
              <label><strong>Observacoes</strong></label>
              <textarea class="work-observations-input" placeholder="Escreve aqui observacoes sobre esta obra...">${escapeHtml(w.observations || "")}</textarea>
              <button type="button" class="save-work-observations-btn">Guardar observacoes</button>
            </div>
          </div>
        </div>
      </article>
    `
    )
    .join("");
}

function renderClients(items) {
  if (!items.length) {
    clientsList.innerHTML = "<p class='muted'>Sem clientes.</p>";
    return;
  }
  clientsList.innerHTML = items
    .map(
      (c) => `
      <article class="client-item">
        <h3>${escapeHtml(c.name)}</h3>
        <p><strong>NIF:</strong> ${escapeHtml(c.nif || "-")}</p>
        <p><strong>Telefone:</strong> ${escapeHtml(c.phone || "-")}</p>
        <p><strong>Email:</strong> ${escapeHtml(c.email || "-")}</p>
        <p class="muted">${escapeHtml(c.notes || "")}</p>
      </article>
    `
    )
    .join("");
}

function renderUsers(items) {
  if (!usersList) return;
  if (!items.length) {
    usersList.innerHTML = "<p class='muted'>Sem utilizadores.</p>";
    return;
  }

  usersList.innerHTML = items
    .map((u) => {
      const canDelete = Number(u.id) !== Number(user.id);
      return `
      <article class="user-item">
        <div>
          <h3>${escapeHtml(u.username || "-")}</h3>
          <p><strong>Password:</strong> ${escapeHtml(u.password_preview || "********")}</p>
          <p class="muted"><strong>Role:</strong> ${escapeHtml(u.role || "-")}</p>
        </div>
        <button
          type="button"
          class="delete-user-btn"
          data-user-id="${u.id}"
          ${canDelete ? "" : "disabled"}
          title="${canDelete ? "Eliminar utilizador" : "Nao podes eliminar o teu utilizador"}"
          aria-label="Eliminar utilizador"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 6h2v9h-2V9zm4 0h2v9h-2V9zM7 9h2v9H7V9z" fill="currentColor"></path>
          </svg>
        </button>
      </article>
    `;
    })
    .join("");
}

function renderLogs(items) {
  if (!logsList) return;
  if (!items.length) {
    logsList.innerHTML = "<p class='muted'>Sem logs.</p>";
    return;
  }

  logsList.innerHTML = items
    .map(
      (item) => `
      <article class="client-item">
        <h3>${escapeHtml(item.action_type || "-")}</h3>
        <p><strong>Utilizador:</strong> ${escapeHtml(item.username || "-")} (${escapeHtml(item.user_role || "-")})</p>
        <p><strong>Entidade:</strong> ${escapeHtml(item.entity_type || "-")} ${escapeHtml(item.entity_id || "-")}</p>
        <p><strong>Obra:</strong> ${escapeHtml(item.work_title || "-")} ${item.work_id ? `(ID: ${escapeHtml(item.work_id)})` : ""}</p>
        <p><strong>Data:</strong> ${escapeHtml(formatLogDate(item.created_at))}</p>
        <p class="muted">${escapeHtml(formatLogDetails(item.details) || "-")}</p>
      </article>
    `
    )
    .join("");
}

function renderClientOptions(items) {
  const counts = new Map();
  for (const client of items) {
    const name = String(client.name || "").trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  clientNameToId.clear();
  clientByNormalizedName = new Map();
  clientAutocompleteItems = items
    .map((client) => {
      const name = String(client.name || "").trim();
      if (!name) return null;
      const label = counts.get(name) > 1 ? `${name} (ID: ${client.id})` : name;
      const clientId = String(client.id);
      clientNameToId.set(label, clientId);
      const normalized = name.toLowerCase();
      if (!clientByNormalizedName.has(normalized)) {
        clientByNormalizedName.set(normalized, []);
      }
      clientByNormalizedName.get(normalized).push(clientId);
      return { id: clientId, name, label, search: label.toLowerCase() };
    })
    .filter(Boolean);

  renderClientMenu(workClientNameInput.value);
  renderWorksClientSearchMenu(worksClientSearchInput.value);
  renderClientsSearchMenu(clientsSearchInput?.value || "");
}

function syncClientIdFromInput() {
  const typedName = workClientNameInput.value.trim();
  const clientId = clientNameToId.get(typedName);
  workClientIdInput.value = clientId || "";
}

function resolveClientIdFromTypedName() {
  const typed = workClientNameInput.value.trim();
  if (!typed) return null;

  const byExactLabel = clientNameToId.get(typed);
  if (byExactLabel) return byExactLabel;

  const matchesByName = clientByNormalizedName.get(typed.toLowerCase()) || [];
  if (matchesByName.length === 1) return matchesByName[0];
  if (matchesByName.length > 1) {
    window.alert("Existem clientes com o mesmo nome. Escolhe um da lista.");
    return "__ambiguous__";
  }

  const partialMatches = clientAutocompleteItems.filter((item) =>
    item.search.includes(typed.toLowerCase())
  );
  if (partialMatches.length === 1) return partialMatches[0].id;
  return null;
}

function renderClientMenu(term = "") {
  const normalized = String(term).trim().toLowerCase();
  const filtered = !normalized
    ? clientAutocompleteItems
    : clientAutocompleteItems.filter((item) => item.search.includes(normalized));

  if (!filtered.length) {
    workClientMenu.innerHTML = "<div class='autocomplete-empty'>Sem clientes com esse nome.</div>";
    workClientMenu.classList.remove("hidden");
    return;
  }

  workClientMenu.innerHTML = filtered
    .map(
      (item) => `
      <button type="button" class="autocomplete-item" data-client-id="${item.id}" data-client-label="${escapeHtml(item.label)}">
        ${escapeHtml(item.label)}
      </button>
    `
    )
    .join("");
  workClientMenu.classList.remove("hidden");
}

function renderWorksClientSearchMenu(term = "") {
  if (!worksClientSearchMenu) return;

  const normalized = String(term).trim().toLowerCase();
  const filtered = !normalized
    ? clientAutocompleteItems
    : clientAutocompleteItems.filter((item) => item.search.includes(normalized));

  if (!filtered.length) {
    worksClientSearchMenu.innerHTML = "<div class='autocomplete-empty'>Sem clientes com esse nome.</div>";
    worksClientSearchMenu.classList.remove("hidden");
    return;
  }

  worksClientSearchMenu.innerHTML = filtered
    .map(
      (item) => `
      <button type="button" class="autocomplete-item works-client-option" data-client-id="${item.id}" data-client-label="${escapeHtml(item.label)}" data-client-name="${escapeHtml(item.name)}">
        ${escapeHtml(item.label)}
      </button>
    `
    )
    .join("");
  worksClientSearchMenu.classList.remove("hidden");
}

function renderClientsSearchMenu(term = "") {
  if (!clientsSearchMenu) return;

  const normalized = String(term).trim().toLowerCase();
  const filtered = !normalized
    ? clientAutocompleteItems
    : clientAutocompleteItems.filter((item) => item.search.includes(normalized));

  if (!filtered.length) {
    clientsSearchMenu.innerHTML = "<div class='autocomplete-empty'>Sem clientes com esse nome.</div>";
    clientsSearchMenu.classList.remove("hidden");
    return;
  }

  clientsSearchMenu.innerHTML = filtered
    .map(
      (item) => `
      <button type="button" class="autocomplete-item clients-option" data-client-id="${item.id}" data-client-label="${escapeHtml(item.label)}" data-client-name="${escapeHtml(item.name)}">
        ${escapeHtml(item.label)}
      </button>
    `
    )
    .join("");
  clientsSearchMenu.classList.remove("hidden");
}

function updateStatusFilterButtons() {
  statusFilterButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.status === worksFilterStatus);
  });
}

function buildWorksQuery() {
  const params = new URLSearchParams();
  if (worksFilterStatus) params.set("status", worksFilterStatus);
  if (worksFilterClientId) params.set("client_id", worksFilterClientId);
  if (worksFilterClient) params.set("client", worksFilterClient);
  const query = params.toString();
  return query ? `/api/works?${query}` : "/api/works";
}

function applyClientsFilter() {
  if (!clientsFilterClientId && !clientsFilterTerm) {
    renderClients(clientsCache);
    return;
  }

  if (clientsFilterClientId) {
    const filtered = clientsCache.filter((item) => String(item.id) === String(clientsFilterClientId));
    renderClients(filtered);
    return;
  }

  const normalized = clientsFilterTerm.toLowerCase();
  const filtered = clientsCache.filter((item) =>
    String(item.name || "").toLowerCase().includes(normalized)
  );
  renderClients(filtered);
}

async function loadWorksTab() {
  const list = await api(buildWorksQuery());
  renderWorks(list || [], worksList);
  (list || []).forEach((work) => {
    const workItem = worksList.querySelector(`.work-item[data-work-id="${work.id}"]`);
    if (workItem) updateWorkCardFromWork(workItem, work);
  });
  worksList.querySelectorAll(".work-status-select, .save-work-status-btn, .work-priority-select, .save-work-priority-btn").forEach((element) => {
    element.disabled = user.role !== "admin";
  });
}

async function loadUsers() {
  if (user.role !== "admin" || !usersList) return;
  const list = await api("/api/users");
  usersCache = list || [];
  renderUsers(usersCache);
}

async function loadLogs() {
  if (!logsList || user.role !== "admin") return;
  try {
    const params = new URLSearchParams({ limit: "200" });
    if (logsFilterWork) params.set("work", logsFilterWork);
    const list = await api(`/api/logs?${params.toString()}`);
    logsCache = list || [];
    renderLogs(logsCache);
  } catch (_error) {
    if (logsList) {
      logsList.innerHTML = "<p class='muted'>Erro ao carregar logs.</p>";
    }
  }
}

if (logsSearchBtn) {
  logsSearchBtn.addEventListener("click", async () => {
    logsFilterWork = String(logsWorkSearchInput?.value || "").trim();
    await loadLogs();
  });
}

if (logsClearBtn) {
  logsClearBtn.addEventListener("click", async () => {
    logsFilterWork = "";
    if (logsWorkSearchInput) logsWorkSearchInput.value = "";
    await loadLogs();
  });
}

if (logsWorkSearchInput) {
  logsWorkSearchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    logsFilterWork = String(logsWorkSearchInput.value || "").trim();
    await loadLogs();
  });
}

async function loadData() {
  const promises = [loadWorksTab(), api("/api/clients"), loadLogs()];
  if (user.role === "admin") {
    promises.push(loadUsers());
  }
  const [worksResult, clientsResult, logsResult, usersResult] = await Promise.allSettled(promises);

  if (clientsResult.status === "fulfilled") {
    clientsCache = clientsResult.value || [];
    renderClientOptions(clientsCache);
    applyClientsFilter();
  } else {
    clientsList.innerHTML = "<p class='muted'>Erro ao carregar clientes.</p>";
    clientsCache = [];
    renderClientOptions([]);
  }

  if (worksResult.status === "rejected") {
    worksList.innerHTML = "<p class='muted'>Erro ao carregar obras.</p>";
  }

  if (logsResult.status === "rejected" && logsList) {
    logsList.innerHTML = "<p class='muted'>Erro ao carregar logs.</p>";
  }

  if (user.role === "admin" && usersResult?.status === "rejected" && usersList) {
    usersList.innerHTML = "<p class='muted'>Erro ao carregar utilizadores.</p>";
  }
}

clientForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    name: document.getElementById("client-name").value.trim(),
    phone: document.getElementById("client-phone").value.trim(),
    email: document.getElementById("client-email").value.trim(),
    nif: document.getElementById("client-nif").value.trim(),
    notes: document.getElementById("client-notes").value.trim()
  };

  try {
    await api("/api/clients", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    clientForm.reset();
    await loadData();
  } catch (error) {
    window.alert(error.message);
  }
});

workForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncClientIdFromInput();
  const resolvedClientId = workClientIdInput.value || resolveClientIdFromTypedName();
  if (resolvedClientId === "__ambiguous__") return;
  workClientIdInput.value = resolvedClientId || "";

  const payload = {
    title: document.getElementById("work-title").value.trim(),
    status: document.getElementById("work-status").value,
    priority: document.getElementById("work-priority").value,
    client_id: workClientIdInput.value || null,
    client_name: workClientNameInput.value.trim() || null,
    due_date: document.getElementById("work-due-date").value || null,
    description: document.getElementById("work-description").value.trim()
  };

  try {
    await api("/api/works", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    workForm.reset();
    workClientIdInput.value = "";
    await loadData();
    setActiveTab("works");
  } catch (error) {
    window.alert(error.message);
  }
});

workClientNameInput.addEventListener("input", syncClientIdFromInput);
workClientNameInput.addEventListener("change", syncClientIdFromInput);
workClientNameInput.addEventListener("focus", () => {
  renderClientMenu(workClientNameInput.value);
});
workClientNameInput.addEventListener("click", () => {
  renderClientMenu(workClientNameInput.value);
});
workClientNameInput.addEventListener("input", () => {
  renderClientMenu(workClientNameInput.value);
});
workClientMenu.addEventListener("click", (event) => {
  const option = event.target.closest(".autocomplete-item");
  if (!option) return;
  const label = option.dataset.clientLabel || "";
  const clientId = option.dataset.clientId || "";
  workClientNameInput.value = label;
  workClientIdInput.value = clientId;
  workClientMenu.classList.add("hidden");
});
document.addEventListener("click", (event) => {
  const insideClientInput = event.target.closest("#work-client-input") || event.target.closest("#work-client-menu");
  if (!insideClientInput) {
    workClientMenu.classList.add("hidden");
  }

  const insideWorksSearch =
    event.target.closest("#works-client-search") ||
    event.target.closest("#works-client-search-menu");
  if (!insideWorksSearch && worksClientSearchMenu) {
    worksClientSearchMenu.classList.add("hidden");
  }

  const insideClientsSearch =
    event.target.closest("#clients-search") ||
    event.target.closest("#clients-search-menu");
  if (!insideClientsSearch && clientsSearchMenu) {
    clientsSearchMenu.classList.add("hidden");
  }
});

statusFilterButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    worksFilterStatus = button.dataset.status || "";
    updateStatusFilterButtons();
    await loadWorksTab();
  });
});

if (worksSearchBtn) {
  worksSearchBtn.addEventListener("click", async () => {
    const typed = String(worksClientSearchInput.value || "").trim();
    const selectedId = clientNameToId.get(typed);
    worksFilterClientId = selectedId || "";
    worksFilterClient = selectedId ? "" : typed;
    if (worksClientSearchMenu) worksClientSearchMenu.classList.add("hidden");
    await loadWorksTab();
  });
}

if (worksClearBtn) {
  worksClearBtn.addEventListener("click", async () => {
    worksFilterStatus = "";
    worksFilterClient = "";
    worksFilterClientId = "";
    worksClientSearchInput.value = "";
    if (worksClientSearchMenu) worksClientSearchMenu.classList.add("hidden");
    updateStatusFilterButtons();
    await loadWorksTab();
  });
}

if (worksClientSearchInput) {
  worksClientSearchInput.addEventListener("focus", () => {
    renderWorksClientSearchMenu(worksClientSearchInput.value);
  });
  worksClientSearchInput.addEventListener("click", () => {
    renderWorksClientSearchMenu(worksClientSearchInput.value);
  });
  worksClientSearchInput.addEventListener("input", () => {
    worksFilterClientId = "";
    renderWorksClientSearchMenu(worksClientSearchInput.value);
  });
  worksClientSearchInput.addEventListener("keydown", async (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const typed = String(worksClientSearchInput.value || "").trim();
    const selectedId = clientNameToId.get(typed);
    worksFilterClientId = selectedId || "";
    worksFilterClient = selectedId ? "" : typed;
    if (worksClientSearchMenu) worksClientSearchMenu.classList.add("hidden");
    await loadWorksTab();
  });
}

if (worksClientSearchMenu) {
  worksClientSearchMenu.addEventListener("click", async (event) => {
    const option = event.target.closest(".works-client-option");
    if (!option) return;
    const clientLabel = option.dataset.clientLabel || option.dataset.clientName || "";
    const clientId = option.dataset.clientId || "";
    worksClientSearchInput.value = clientLabel;
    worksFilterClientId = clientId;
    worksFilterClient = "";
    worksClientSearchMenu.classList.add("hidden");
    await loadWorksTab();
  });
}

if (clientsSearchBtn) {
  clientsSearchBtn.addEventListener("click", () => {
    const typed = String(clientsSearchInput?.value || "").trim();
    const selectedId = clientNameToId.get(typed);
    clientsFilterClientId = selectedId || "";
    clientsFilterTerm = selectedId ? "" : typed;
    if (clientsSearchMenu) clientsSearchMenu.classList.add("hidden");
    applyClientsFilter();
  });
}

if (clientsClearBtn) {
  clientsClearBtn.addEventListener("click", () => {
    clientsFilterClientId = "";
    clientsFilterTerm = "";
    if (clientsSearchInput) clientsSearchInput.value = "";
    if (clientsSearchMenu) clientsSearchMenu.classList.add("hidden");
    applyClientsFilter();
  });
}

if (clientsSearchInput) {
  clientsSearchInput.addEventListener("focus", () => {
    renderClientsSearchMenu(clientsSearchInput.value);
  });
  clientsSearchInput.addEventListener("click", () => {
    renderClientsSearchMenu(clientsSearchInput.value);
  });
  clientsSearchInput.addEventListener("input", () => {
    clientsFilterClientId = "";
    clientsFilterTerm = String(clientsSearchInput.value || "").trim();
    renderClientsSearchMenu(clientsSearchInput.value);
    applyClientsFilter();
  });
  clientsSearchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const typed = String(clientsSearchInput.value || "").trim();
    const selectedId = clientNameToId.get(typed);
    clientsFilterClientId = selectedId || "";
    clientsFilterTerm = selectedId ? "" : typed;
    if (clientsSearchMenu) clientsSearchMenu.classList.add("hidden");
    applyClientsFilter();
  });
}

if (clientsSearchMenu) {
  clientsSearchMenu.addEventListener("click", (event) => {
    const option = event.target.closest(".clients-option");
    if (!option) return;
    const clientLabel = option.dataset.clientLabel || option.dataset.clientName || "";
    const clientId = option.dataset.clientId || "";
    if (clientsSearchInput) clientsSearchInput.value = clientLabel;
    clientsFilterClientId = clientId;
    clientsFilterTerm = "";
    clientsSearchMenu.classList.add("hidden");
    applyClientsFilter();
  });
}

if (userForm) {
  userForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      username: document.getElementById("user-username").value.trim(),
      password: document.getElementById("user-password").value,
      role: document.getElementById("user-role").value
    };

    try {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      userForm.reset();
      window.alert("Utilizador criado com sucesso.");
      await loadUsers();
    } catch (error) {
      window.alert(error.message);
    }
  });
}

if (usersList) {
  usersList.addEventListener("click", async (event) => {
    const button = event.target.closest(".delete-user-btn");
    if (!button || button.disabled) return;

    const userId = Number(button.dataset.userId);
    if (!Number.isInteger(userId) || userId <= 0) return;

    const confirmed = window.confirm("Tem certeza que quer eliminar este utilizador?");
    if (!confirmed) return;

    button.disabled = true;
    try {
      await api(`/api/users/${userId}`, { method: "DELETE" });
      await loadUsers();
    } catch (error) {
      button.disabled = false;
      window.alert(error.message);
    }
  });
}

async function handleWorksInteraction(event) {
  const button = event.target.closest("button");
  if (!button) return;

  const workItem = button.closest(".work-item");
  if (button.classList.contains("save-work-status-btn")) {
    await saveWorkStatus(workItem, button);
    return;
  }

  const materialItem = button.closest(".material-item");
  if (materialItem) {
    const workId = materialItem.dataset.workId;
    const materialKey = materialItem.dataset.materialKey;
    if (!workId || !materialKey) return;

    if (button.classList.contains("upload-material-btn")) {
      const input = materialItem.querySelector(".material-file");
      const file = input.files?.[0];
      if (!file) {
        window.alert("Seleciona um ficheiro PDF primeiro.");
        return;
      }
      if (file.type !== "application/pdf") {
        window.alert("So sao permitidos ficheiros PDF.");
        return;
      }

      const formData = new FormData();
      formData.append("pdf", file);

      button.disabled = true;
      try {
        const updatedWork = await api(`/api/works/${workId}/materials/${materialKey}/upload`, {
          method: "POST",
          body: formData
        });
        updateMaterialItemFromWork(materialItem, updatedWork);
        await loadLogs();
        input.value = "";
      } catch (error) {
        window.alert(error.message);
      } finally {
        button.disabled = false;
      }
      return;
    }
  }

  const processItem = button.closest(".process-item");
  if (processItem && button.classList.contains("upload-process-btn")) {
    const workId = processItem.dataset.workId;
    const stepKey = processItem.dataset.stepKey;
    const input = processItem.querySelector(".process-file");
    const file = input?.files?.[0];
    if (!workId || !stepKey) return;
    if (!file) {
      window.alert("Seleciona um ficheiro PDF primeiro.");
      return;
    }
    if (file.type !== "application/pdf") {
      window.alert("So sao permitidos ficheiros PDF.");
      return;
    }

    const formData = new FormData();
    formData.append("pdf", file);
    button.disabled = true;
    try {
      const updatedWork = await api(`/api/works/${workId}/process/${stepKey}/upload`, {
        method: "POST",
        body: formData
      });
      updateProcessItemFromWork(processItem, updatedWork);
      await loadLogs();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.classList.contains("save-work-priority-btn")) {
    if (user.role !== "admin") return;
    if (!workItem) return;
    const workId = workItem.dataset.workId;
    const prioritySelect = workItem.querySelector(".work-priority-select");
    if (!workId || !prioritySelect) return;

    button.disabled = true;
    try {
      await api(`/api/works/${workId}/priority`, {
        method: "PATCH",
        body: JSON.stringify({ priority: prioritySelect.value })
      });
      await loadWorksTab();
      await loadLogs();
    } catch (error) {
      window.alert(error.message);
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (button.classList.contains("save-work-observations-btn")) {
    if (!workItem) return;
    const workId = workItem.dataset.workId;
    const observationsInput = workItem.querySelector(".work-observations-input");
    if (!workId || !observationsInput) return;

    button.disabled = true;
    observationsInput.disabled = true;
    try {
      const updatedWork = await api(`/api/works/${workId}/observations`, {
        method: "PATCH",
        body: JSON.stringify({ observations: observationsInput.value })
      });
      updateWorkCardFromWork(workItem, updatedWork);
      await loadLogs();
    } catch (error) {
      window.alert(error.message);
    } finally {
      observationsInput.disabled = false;
      button.disabled = false;
    }
    return;
  }
}

async function saveWorkStatus(workItem, triggerButton = null) {
  if (!workItem) return;
  if (user.role !== "admin") return;

  const workId = workItem.dataset.workId;
  const statusSelect = workItem.querySelector(".work-status-select");
  if (!workId || !statusSelect) return;

  const saveButton = triggerButton || workItem.querySelector(".save-work-status-btn");
  if (saveButton) saveButton.disabled = true;
  statusSelect.disabled = true;

  try {
    const updatedWork = await api(`/api/works/${workId}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status: statusSelect.value })
    });
    updateWorkCardFromWork(workItem, updatedWork);
    await loadLogs();
  } catch (error) {
    window.alert(error.message);
  } finally {
    statusSelect.disabled = false;
    if (saveButton) saveButton.disabled = false;
  }
}

async function handleMaterialCheckboxChange(event) {
  const changedInput = event.target.closest(".material-ordered, .material-arrived");
  if (!changedInput || !changedInput.classList.contains("material-toggle-btn")) return;

  const materialItem = changedInput.closest(".material-item");
  if (!materialItem) return;

  const workId = materialItem.dataset.workId;
  const materialKey = materialItem.dataset.materialKey;
  const orderedInput = materialItem.querySelector(".material-ordered");
  const arrivedInput = materialItem.querySelector(".material-arrived");
  if (!workId || !materialKey || !orderedInput || !arrivedInput) return;

  const isOrderedToggle = changedInput.classList.contains("material-ordered");
  const isArrivedToggle = changedInput.classList.contains("material-arrived");
  const ordered = isOrderedToggle ? !orderedInput.classList.contains("done") : orderedInput.classList.contains("done");
  const arrived = isArrivedToggle ? !arrivedInput.classList.contains("done") : arrivedInput.classList.contains("done");

  orderedInput.disabled = true;
  arrivedInput.disabled = true;
  try {
    const updatedWork = await api(`/api/works/${workId}/materials/${materialKey}`, {
      method: "PATCH",
      body: JSON.stringify({ ordered, arrived })
    });
    updateMaterialItemFromWork(materialItem, updatedWork);
    await loadLogs();
  } catch (error) {
    window.alert(error.message);
  } finally {
    orderedInput.disabled = false;
    arrivedInput.disabled = false;
  }
}

async function handleProcessCheckboxChange(event) {
  const toggleButton = event.target.closest(".process-toggle-btn");
  if (!toggleButton) return;

  const processItem = toggleButton.closest(".process-item");
  const workItem = toggleButton.closest(".work-item");
  if (!processItem || !workItem) return;

  const workId = processItem.dataset.workId;
  const stepKey = processItem.dataset.stepKey;
  if (!workId || !stepKey) return;

  const nextDone = !toggleButton.classList.contains("done");
  const previousValue = !nextDone;
  toggleButton.disabled = true;

  try {
    const updatedWork = await api(`/api/works/${workId}/process/${stepKey}`, {
      method: "PATCH",
      body: JSON.stringify({ done: nextDone })
    });
    updateProcessItemFromWork(processItem, updatedWork);
    updateWorkCardFromWork(workItem, updatedWork);
    applyProcessSequenceUI(workItem);
    await loadLogs();
  } catch (error) {
    toggleButton.classList.toggle("done", previousValue);
    toggleButton.setAttribute("aria-label", previousValue ? "Etapa feita" : "Marcar etapa como feita");
    applyProcessSequenceUI(workItem);
    window.alert(error.message);
  } finally {
    toggleButton.disabled = false;
  }
}

async function handleWorkStatusChange(event) {
  const statusSelect = event.target.closest(".work-status-select");
  if (!statusSelect) return;

  const workItem = statusSelect.closest(".work-item");
  await saveWorkStatus(workItem);
}

function handleWorkToggle(event) {
  const detailTabButton = event.target.closest(".detail-tab-btn");
  if (detailTabButton) {
    const details = detailTabButton.closest(".work-details");
    if (!details) return;
    const tab = detailTabButton.dataset.detailTab;
    details.querySelectorAll(".detail-tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn === detailTabButton);
    });
    details.querySelector(".detail-panel-materials")?.classList.toggle("hidden", tab !== "materials");
    details.querySelector(".detail-panel-process")?.classList.toggle("hidden", tab !== "process");
    details.querySelector(".detail-panel-observations")?.classList.toggle("hidden", tab !== "observations");
    return;
  }

  const summaryButton = event.target.closest(".work-summary-btn");
  if (!summaryButton) return;

  const workItem = summaryButton.closest(".work-item");
  const details = workItem?.querySelector(".work-details");
  if (!details) return;
  const shouldOpen = details.classList.contains("hidden");

  worksList.querySelectorAll(".work-item").forEach((item) => {
    const itemDetails = item.querySelector(".work-details");
    const itemSummaryButton = item.querySelector(".work-summary-btn");
    if (!itemDetails || !itemSummaryButton) return;
    if (item === workItem && shouldOpen) return;
    itemDetails.classList.add("hidden");
    itemSummaryButton.classList.remove("expanded");
  });

  details.classList.toggle("hidden");
  summaryButton.classList.toggle("expanded", !details.classList.contains("hidden"));
}

[worksList].forEach((list) => {
  list.addEventListener("click", handleWorksInteraction);
  list.addEventListener("click", handleWorkToggle);
  list.addEventListener("change", handleWorkStatusChange);
  list.addEventListener("click", handleMaterialCheckboxChange);
  list.addEventListener("click", handleProcessCheckboxChange);
});

updateStatusFilterButtons();
loadData().catch((error) => {
  window.alert(`Erro ao carregar dados: ${error.message}`);
});
