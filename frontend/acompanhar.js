const content = document.getElementById("tracking-content");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const statusLabels = {
  pending: "Pendente / Encomenda",
  in_progress: "Em produção",
  done: "Finalizada",
  suspended: "Suspensa"
};

async function loadTracking() {
  const token = window.location.hash.slice(1).trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    content.innerHTML = `<div class="tracking-error"><h1>Link inválido</h1><p>Confirma se copiaste o link completo.</p></div>`;
    return;
  }

  try {
    const response = await fetch(`/api/public/works/${encodeURIComponent(token)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível abrir este acompanhamento.");
    const percent = data.total_steps ? Math.round((data.completed_steps / data.total_steps) * 100) : 0;
    content.innerHTML = `
      <div class="tracking-head">
        <span class="eyebrow">Estado atual · ${escapeHtml(statusLabels[data.status] || data.status)}</span>
        <h1>${escapeHtml(data.title)}</h1>
        ${data.due_date ? `<p class="muted">Prazo previsto: ${escapeHtml(data.due_date)}</p>` : ""}
      </div>
      <div class="tracking-progress-copy"><strong>${percent}% concluído</strong><span>${data.completed_steps} de ${data.total_steps} etapas</span></div>
      <div class="tracking-progress"><span style="width:${percent}%"></span></div>
      <ol class="tracking-steps">
        ${data.steps.map((step, index) => `
          <li class="${step.done ? "done" : ""}">
            <span class="tracking-step-number">${step.done ? "✓" : index + 1}</span>
            <span><strong>${escapeHtml(step.label)}</strong><small>${step.done ? "Concluída" : "Por concluir"}</small></span>
          </li>
        `).join("")}
      </ol>
    `;
  } catch (error) {
    content.innerHTML = `<div class="tracking-error"><h1>Acesso indisponível</h1><p>${escapeHtml(error.message)}</p></div>`;
  }
}

loadTracking();
