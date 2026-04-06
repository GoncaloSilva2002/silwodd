require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const { query, initDb } = require("./db");
const { requireAuth } = require("./middleware/auth");

const app = express();
const port = process.env.PORT || 3000;
const normalizedPort = Number(port);
const jwtSecret = process.env.JWT_SECRET || "";
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || "8h";
const nodeEnv = process.env.NODE_ENV || "development";
const uploadsDir = path.join(__dirname, "uploads");
const isProd = nodeEnv === "production";
const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const materialMap = {
  stone: "Pedra",
  wood_panels: "Placas de madeira",
  hardware: "Ferragens",
  paint: "Tinta"
};
const defaultMaterials = Object.entries(materialMap).map(([key, label]) => ({ key, label }));
const materialKeys = new Set(Object.keys(materialMap));
const materialNameToKey = new Map(defaultMaterials.map((material) => [material.label, material.key]));
const defaultProcessSteps = [
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
const processStepMap = Object.fromEntries(defaultProcessSteps.map((step) => [step.key, step.label]));
const processStepOrder = defaultProcessSteps.map((step) => step.key);
const processStepKeys = new Set(Object.keys(processStepMap));
const processStepNameToKey = new Map(defaultProcessSteps.map((step) => [step.label, step.key]));
const schemaInfo = {
  obrasDueDateColumn: null,
  obrasPriorityColumn: null,
  obrasObservationsColumn: null,
  clientesNifColumn: null,
  clientesAddressColumn: null,
  obrasProcessConfiguredColumn: null
};

const statusCodeToCandidates = {
  pending: ["Pendente"],
  in_progress: ["Em Progresso", "Em execucao"],
  done: ["Concluida"],
  suspended: ["Suspensa"]
};
const statusNameToCode = {
  pendente: "pending",
  "em progresso": "in_progress",
  "em execucao": "in_progress",
  concluida: "done",
  suspensa: "suspended"
};

fs.mkdirSync(uploadsDir, { recursive: true });

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "same-origin" }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!isProd) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Origem nao permitida por CORS."));
    }
  })
);

const apiLimiter = rateLimit({
  windowMs: Number(process.env.API_RATE_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.API_RATE_MAX || 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados pedidos. Tenta novamente daqui a pouco." }
});

const authLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_MAX || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas de login. Tenta novamente mais tarde." }
});

app.use("/api", apiLimiter);
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "frontend")));
app.use("/uploads", express.static(uploadsDir));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, _file, cb) => {
      const uploadKey = String(req.params.materialKey || req.params.stepKey || "").replace(/[^a-z_]/g, "");
      cb(null, `${req.params.id}-${uploadKey}-${Date.now()}.pdf`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const original = String(file.originalname || "").toLowerCase();
    const looksLikePdf = original.endsWith(".pdf");
    if (file.mimetype !== "application/pdf" || !looksLikePdf) {
      return cb(new Error("Apenas ficheiros PDF sao permitidos."));
    }
    return cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

const imageUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const rawExt = path.extname(String(file.originalname || "")).toLowerCase();
      const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(rawExt) ? rawExt : ".jpg";
      const uploadKey = String(req.params.materialId || req.params.id || "material").replace(/[^a-zA-Z0-9_-]/g, "");
      cb(null, `${req.params.id}-${uploadKey}-${Date.now()}${safeExt}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    if (!String(file.mimetype || "").startsWith("image/")) {
      return cb(new Error("Apenas imagens sao permitidas."));
    }
    return cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Apenas admin pode executar esta acao." });
  }
  return next();
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeMaterialLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getMaterialKeyByName(materialName) {
  return materialNameToKey.get(materialName) || null;
}

function mapStatusNameToCode(name) {
  if (!name) return "pending";
  return statusNameToCode[normalizeText(name)] || "pending";
}

async function getEstadoIdFromCode(statusCode) {
  const candidates = statusCodeToCandidates[statusCode] || [];
  if (!candidates.length) return null;
  const normalizedCandidates = new Set(candidates.map((value) => normalizeText(value)));
  const rows = await query("SELECT id, nome FROM estados");
  const row = rows.find((item) => normalizedCandidates.has(normalizeText(item.nome)));
  return row?.id || null;
}

async function isWorkReadyForInProgress(workId) {
  const rows = await getOrderedProcessSteps(workId);
  if (!rows.length) return true;
  return Number(Boolean(rows[0]?.concluida)) === 1;
}

async function loadSchemaInfo() {
  const columns = await query("SHOW COLUMNS FROM obras");
  const names = new Set(columns.map((column) => String(column.Field)));
  const dueDateCandidates = ["data_fim_prevista", "data_fim_previsao", "data_fim", "prazo"];
  schemaInfo.obrasDueDateColumn = dueDateCandidates.find((name) => names.has(name)) || null;
  const priorityCandidates = ["prioridade", "priority"];
  schemaInfo.obrasPriorityColumn = priorityCandidates.find((name) => names.has(name)) || null;
  const observationsCandidates = ["observacoes", "observacoes_obra", "notes"];
  schemaInfo.obrasObservationsColumn = observationsCandidates.find((name) => names.has(name)) || null;
  const processConfiguredCandidates = ["process_steps_configured", "etapas_configuradas"];
  schemaInfo.obrasProcessConfiguredColumn = processConfiguredCandidates.find((name) => names.has(name)) || null;

  const clientColumns = await query("SHOW COLUMNS FROM clientes");
  const clientNames = new Set(clientColumns.map((column) => String(column.Field)));
  const nifCandidates = ["nif", "numero_contribuinte"];
  schemaInfo.clientesNifColumn = nifCandidates.find((name) => clientNames.has(name)) || null;
  const addressCandidates = ["morada", "endereco", "address"];
  schemaInfo.clientesAddressColumn = addressCandidates.find((name) => clientNames.has(name)) || null;
}

async function ensureWorksPriorityColumn() {
  const columns = await query("SHOW COLUMNS FROM obras");
  const hasPriority = columns.some((column) => String(column.Field) === "prioridade");
  if (!hasPriority) {
    await query("ALTER TABLE obras ADD COLUMN prioridade VARCHAR(20) NOT NULL DEFAULT 'medium'");
  }
}

async function ensureWorksObservationsColumn() {
  const columns = await query("SHOW COLUMNS FROM obras");
  const hasObservations = columns.some((column) => String(column.Field) === "observacoes");
  if (!hasObservations) {
    await query("ALTER TABLE obras ADD COLUMN observacoes TEXT NULL");
  }
}

async function ensureClientsNifColumn() {
  const columns = await query("SHOW COLUMNS FROM clientes");
  const hasNif = columns.some((column) => String(column.Field) === "nif");
  if (!hasNif) {
    await query("ALTER TABLE clientes ADD COLUMN nif VARCHAR(20) NULL");
  }
}

async function ensureClientsAddressColumn() {
  const columns = await query("SHOW COLUMNS FROM clientes");
  const hasAddress = columns.some((column) => String(column.Field) === "morada");
  if (!hasAddress) {
    await query("ALTER TABLE clientes ADD COLUMN morada VARCHAR(255) NULL");
  }
}

async function ensureWorksProcessConfiguredColumn() {
  const columns = await query("SHOW COLUMNS FROM obras");
  const hasColumn = columns.some((column) => String(column.Field) === "process_steps_configured");
  if (!hasColumn) {
    await query("ALTER TABLE obras ADD COLUMN process_steps_configured TINYINT(1) NOT NULL DEFAULT 0");
  }
}

async function getNextTableId(tableName) {
  const rows = await query(`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM ${tableName}`);
  return Number(rows[0]?.nextId || 1);
}

async function getOrderedMaterials(workId) {
  return query(
    `
      SELECT id, id_obra, nome_material, pdf_path, encomendado, chegou, nota_encomenda, invoice_photo_path
      FROM materiais
      WHERE id_obra = ?
      ORDER BY id ASC
    `,
    [workId]
  );
}

async function ensureDefaultMaterialsForWork(workId) {
  const existing = await query(
    "SELECT nome_material FROM materiais WHERE id_obra = ?",
    [workId]
  );
  const existingNames = new Set(existing.map((row) => String(row.nome_material)));

  for (const material of defaultMaterials) {
    if (existingNames.has(material.label)) continue;
    const nextId = await getNextTableId("materiais");
    await query(
      "INSERT INTO materiais (id, id_obra, nome_material, encomendado, chegou) VALUES (?, ?, ?, 0, 0)",
      [nextId, workId, material.label]
    );
  }
}

async function ensureMaterialsExtraColumns() {
  const columns = await query("SHOW COLUMNS FROM materiais");
  const hasOrderNote = columns.some((column) => String(column.Field) === "nota_encomenda");
  if (!hasOrderNote) {
    await query("ALTER TABLE materiais ADD COLUMN nota_encomenda TEXT NULL");
  }
  const hasInvoicePhotoPath = columns.some((column) => String(column.Field) === "invoice_photo_path");
  if (!hasInvoicePhotoPath) {
    await query("ALTER TABLE materiais ADD COLUMN invoice_photo_path VARCHAR(255) NULL");
  }
}

async function initializeMaterialsForExistingWorks() {
  const works = await query("SELECT id FROM obras");
  for (const work of works) {
    await ensureDefaultMaterialsForWork(work.id);
  }
}

async function ensureProcessStepsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS obra_etapas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      id_obra INT NOT NULL,
      nome_etapa VARCHAR(120) NOT NULL,
      pdf_path VARCHAR(255) NULL,
      concluida TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_obra_etapa (id_obra, nome_etapa),
      INDEX idx_obra_etapas_obra (id_obra)
    )
  `);
  const columns = await query("SHOW COLUMNS FROM obra_etapas");
  const hasPdfPath = columns.some((column) => String(column.Field) === "pdf_path");
  if (!hasPdfPath) {
    await query("ALTER TABLE obra_etapas ADD COLUMN pdf_path VARCHAR(255) NULL");
  }
  const hasOrderIndex = columns.some((column) => String(column.Field) === "order_index");
  if (!hasOrderIndex) {
    await query("ALTER TABLE obra_etapas ADD COLUMN order_index INT NOT NULL DEFAULT 0");
  }
  const hasCheckedByUserId = columns.some((column) => String(column.Field) === "checked_by_user_id");
  if (!hasCheckedByUserId) {
    await query("ALTER TABLE obra_etapas ADD COLUMN checked_by_user_id INT NULL");
  }
  const hasCheckedByUsername = columns.some((column) => String(column.Field) === "checked_by_username");
  if (!hasCheckedByUsername) {
    await query("ALTER TABLE obra_etapas ADD COLUMN checked_by_username VARCHAR(120) NULL");
  }
  const hasCheckedAt = columns.some((column) => String(column.Field) === "checked_at");
  if (!hasCheckedAt) {
    await query("ALTER TABLE obra_etapas ADD COLUMN checked_at DATETIME NULL");
  }
}

function normalizeProcessStepLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getProcessStepKeyByName(stepName) {
  return processStepNameToKey.get(stepName) || null;
}

async function getOrderedProcessSteps(workId) {
  return query(
    `
      SELECT id, id_obra, nome_etapa, concluida, pdf_path, order_index, checked_by_user_id, checked_by_username, checked_at
      FROM obra_etapas
      WHERE id_obra = ?
      ORDER BY order_index ASC, id ASC
    `,
    [workId]
  );
}

async function normalizeProcessStepOrder(workId) {
  const steps = await getOrderedProcessSteps(workId);
  for (let index = 0; index < steps.length; index += 1) {
    if (Number(steps[index].order_index) === index) continue;
    await query("UPDATE obra_etapas SET order_index = ? WHERE id = ?", [index, steps[index].id]);
  }
  return steps.map((step, index) => ({ ...step, order_index: index }));
}

async function ensureDefaultProcessStepsForWork(workId) {
  const existing = await query(
    "SELECT id, nome_etapa FROM obra_etapas WHERE id_obra = ?",
    [workId]
  );
  const existingNames = new Set(existing.map((row) => String(row.nome_etapa)));
  const nextRows = [];
  for (const [index, step] of defaultProcessSteps.entries()) {
    if (existingNames.has(step.label)) continue;
    nextRows.push({ label: step.label, orderIndex: index });
  }

  for (const step of nextRows) {
    const nextId = await getNextTableId("obra_etapas");
    await query(
      "INSERT INTO obra_etapas (id, id_obra, nome_etapa, concluida, order_index) VALUES (?, ?, ?, 0, ?)",
      [nextId, workId, step.label, step.orderIndex]
    );
  }

  await query("UPDATE obras SET process_steps_configured = 1 WHERE id = ?", [workId]);
  await normalizeProcessStepOrder(workId);
}

async function initializeProcessStepsForExistingWorks() {
  const works = await query(
    "SELECT id, process_steps_configured FROM obras"
  );

  for (const work of works) {
    if (Number(Boolean(work.process_steps_configured)) === 1) {
      await normalizeProcessStepOrder(work.id);
      continue;
    }
    await ensureDefaultProcessStepsForWork(work.id);
  }
}

async function recalculateWorkStatusFromProcessSteps(workId) {
  const steps = await getOrderedProcessSteps(workId);
  const hasSteps = steps.length > 0;
  const allDone = hasSteps && steps.every((step) => Number(Boolean(step.concluida)) === 1);
  const firstDone = hasSteps ? Number(Boolean(steps[0].concluida)) === 1 : false;

  if (allDone) {
    const doneEstadoId = await getEstadoIdFromCode("done");
    if (doneEstadoId) {
      await query("UPDATE obras SET id_estado = ? WHERE id = ?", [doneEstadoId, workId]);
    }
    return;
  }

  if (firstDone) {
    const inProgressEstadoId = await getEstadoIdFromCode("in_progress");
    if (inProgressEstadoId) {
      await query("UPDATE obras SET id_estado = ? WHERE id = ?", [inProgressEstadoId, workId]);
    }
    return;
  }

  const pendingEstadoId = await getEstadoIdFromCode("pending");
  if (pendingEstadoId) {
    await query("UPDATE obras SET id_estado = ? WHERE id = ?", [pendingEstadoId, workId]);
  }
}

async function ensureAuditLogsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      username VARCHAR(120) NULL,
      user_role VARCHAR(50) NULL,
      action_type VARCHAR(120) NOT NULL,
      entity_type VARCHAR(120) NOT NULL,
      entity_id INT NULL,
      work_id INT NULL,
      details TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_logs_created_at (created_at),
      INDEX idx_audit_logs_work_id (work_id)
    )
  `);
}

async function createAuditLog(req, actionType, entityType, entityId = null, workId = null, details = null) {
  try {
    await ensureAuditLogsTable();
    const nextAuditLogId = await getNextTableId("audit_logs");
    await query(
      `INSERT INTO audit_logs (id, user_id, username, user_role, action_type, entity_type, entity_id, work_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nextAuditLogId,
        req.user?.id || null,
        req.user?.username || null,
        req.user?.role || null,
        actionType,
        entityType,
        entityId,
        workId,
        details ? JSON.stringify(details) : null
      ]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Erro ao gravar log de auditoria:", error.sqlMessage || error.message);
  }
}

async function getAuditLogs(limit = 200, workSearch = "") {
  await ensureAuditLogsTable();
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const workTerm = String(workSearch || "").trim();
  const whereClauses = [];
  const params = [];

  if (workTerm) {
    const workId = Number(workTerm);
    if (Number.isInteger(workId) && workId > 0) {
      whereClauses.push("(l.work_id = ? OR LOWER(o.nome_obra) LIKE LOWER(?))");
      params.push(workId, `%${workTerm}%`);
    } else {
      whereClauses.push("LOWER(o.nome_obra) LIKE LOWER(?)");
      params.push(`%${workTerm}%`);
    }
  }

  const rows = await query(
    `SELECT l.id, l.user_id, l.username, l.user_role, l.action_type, l.entity_type, l.entity_id, l.work_id, l.details, l.created_at,
            o.nome_obra AS work_title
     FROM audit_logs l
     LEFT JOIN obras o ON o.id = l.work_id
     ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT ${safeLimit}`,
    params
  );

  return rows.map((row) => {
    let parsedDetails = null;
    try {
      parsedDetails = row.details ? JSON.parse(row.details) : null;
    } catch (_error) {
      parsedDetails = row.details || null;
    }
    return {
      id: row.id,
      user_id: row.user_id,
      username: row.username,
      user_role: row.user_role,
      action_type: row.action_type,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      work_id: row.work_id,
      work_title: row.work_title || null,
      details: parsedDetails,
      created_at: row.created_at
    };
  });
}

function normalizePriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["high", "alta"].includes(normalized)) return "high";
  if (["low", "baixa"].includes(normalized)) return "low";
  return "medium";
}

function buildWorksOrderBy() {
  const priorityColumn = schemaInfo.obrasPriorityColumn ? `o.${schemaInfo.obrasPriorityColumn}` : "'medium'";
  const priorityRank = `
    CASE LOWER(COALESCE(${priorityColumn}, 'medium'))
      WHEN 'high' THEN 3
      WHEN 'alta' THEN 3
      WHEN 'medium' THEN 2
      WHEN 'media' THEN 2
      WHEN 'low' THEN 1
      WHEN 'baixa' THEN 1
      ELSE 2
    END
  `;
  const doneRank = `
    CASE LOWER(COALESCE(e.nome, ''))
      WHEN 'concluida' THEN 1
      ELSE 0
    END
  `;
  return `${doneRank} ASC, ${priorityRank} DESC, o.id DESC`;
}

async function getWorks(statusFilterCode = null, clientSearch = "", clientIdFilter = null) {
  const dueDateSelect = schemaInfo.obrasDueDateColumn
    ? `o.${schemaInfo.obrasDueDateColumn} AS data_fim_prevista`
    : "NULL AS data_fim_prevista";
  const prioritySelect = schemaInfo.obrasPriorityColumn
    ? `o.${schemaInfo.obrasPriorityColumn} AS prioridade`
    : "'medium' AS prioridade";
  const observationsSelect = schemaInfo.obrasObservationsColumn
    ? `o.${schemaInfo.obrasObservationsColumn} AS observacoes`
    : "NULL AS observacoes";

  let sql = `
    SELECT
      o.id,
      o.nome_obra,
      o.descricao,
      ${dueDateSelect},
      ${prioritySelect},
      ${observationsSelect},
      c.id AS client_id,
      c.nome AS client_name,
      e.nome AS estado_nome
    FROM obras o
    LEFT JOIN clientes c ON c.id = o.id_cliente
    INNER JOIN estados e ON e.id = o.id_estado
  `;
  const params = [];
  const whereClauses = [];

  if (statusFilterCode) {
    const estadoId = await getEstadoIdFromCode(statusFilterCode);
    if (!estadoId) return [];
    whereClauses.push("o.id_estado = ?");
    params.push(estadoId);
  }

  if (Number.isInteger(clientIdFilter) && clientIdFilter > 0) {
    whereClauses.push("c.id = ?");
    params.push(clientIdFilter);
  }

  const clientTerm = String(clientSearch || "").trim();
  if (clientTerm && !(Number.isInteger(clientIdFilter) && clientIdFilter > 0)) {
    whereClauses.push("LOWER(c.nome) LIKE LOWER(?)");
    params.push(`%${clientTerm}%`);
  }

  if (whereClauses.length) {
    sql += ` WHERE ${whereClauses.join(" AND ")}`;
  }
  sql += ` ORDER BY ${buildWorksOrderBy()}`;

  const obras = await query(sql, params);
  if (!obras.length) return [];

  const obraIds = obras.map((obra) => obra.id);
  const placeholdersObras = obraIds.map(() => "?").join(", ");
  let materials = [];
  let processSteps = [];
  try {
    materials = await query(
      `
        SELECT id_obra, nome_material, pdf_path, encomendado, chegou
             , id, nota_encomenda, invoice_photo_path
        FROM materiais
        WHERE id_obra IN (${placeholdersObras})
        ORDER BY id_obra ASC, id ASC
      `,
      [...obraIds]
    );
  } catch (error) {
    // Keep works visible even if materiais table/columns are inconsistent.
    // eslint-disable-next-line no-console
    console.error("Erro ao carregar materiais:", error.sqlMessage || error.message);
  }
  try {
    processSteps = await query(
      `
        SELECT id, id_obra, nome_etapa, concluida, pdf_path, order_index
             , checked_by_user_id, checked_by_username, checked_at
        FROM obra_etapas
        WHERE id_obra IN (${placeholdersObras})
        ORDER BY id_obra ASC, order_index ASC, id ASC
      `,
      [...obraIds]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Erro ao carregar etapas:", error.sqlMessage || error.message);
  }

  const grouped = new Map();
  for (const material of materials) {
    if (!grouped.has(material.id_obra)) grouped.set(material.id_obra, []);
    grouped.get(material.id_obra).push(material);
  }
  const stepsGrouped = new Map();
  for (const step of processSteps) {
    if (!stepsGrouped.has(step.id_obra)) stepsGrouped.set(step.id_obra, []);
    stepsGrouped.get(step.id_obra).push(step);
  }

  return obras.map((obra) => {
    const item = {
      id: obra.id,
      title: obra.nome_obra,
      description: obra.descricao || "",
      observations: obra.observacoes || "",
      status: mapStatusNameToCode(obra.estado_nome),
      due_date: obra.data_fim_prevista || null,
      priority: normalizePriority(obra.prioridade),
      client_id: obra.client_id,
      client_name: obra.client_name
    };
    const workMaterials = grouped.get(obra.id) || [];
    const byName = new Map();
    for (const material of workMaterials) {
      byName.set(material.nome_material, material);
    }
    for (const [key, materialName] of Object.entries(materialMap)) {
      const material = byName.get(materialName);
      item[`${key}_pdf_path`] = material?.pdf_path || null;
      item[`${key}_ordered`] = Number(Boolean(material?.encomendado));
      item[`${key}_arrived`] = Number(Boolean(material?.chegou));
    }
    item.materials = workMaterials.map((material) => ({
      id: material.id,
      key: getMaterialKeyByName(material.nome_material),
      label: material.nome_material,
      pdf_path: material.pdf_path || null,
      ordered: Number(Boolean(material.encomendado)),
      arrived: Number(Boolean(material.chegou)),
      order_note: material.nota_encomenda || "",
      invoice_photo_path: material.invoice_photo_path || null
    }));
    const workSteps = stepsGrouped.get(obra.id) || [];
    const stepByName = new Map(workSteps.map((step) => [step.nome_etapa, step]));
    for (const [key, stepName] of Object.entries(processStepMap)) {
      const step = stepByName.get(stepName);
      item[`${key}_done`] = Number(Boolean(step?.concluida));
      item[`${key}_pdf_path`] = step?.pdf_path || null;
    }
    item.kitchen_design_done = Number(Boolean(stepByName.get(processStepMap.kitchen_design)?.concluida));
    item.process_steps = workSteps.map((step) => {
      const key = getProcessStepKeyByName(step.nome_etapa);
      return {
        id: step.id,
        key,
        label: step.nome_etapa,
        done: Number(Boolean(step.concluida)),
        pdf_path: step.pdf_path || null,
        order_index: Number(step.order_index) || 0,
        can_upload_pdf: key === "kitchen_design",
        checked_by_user_id: step.checked_by_user_id || null,
        checked_by_username: step.checked_by_username || null,
        checked_at: step.checked_at || null
      };
    });
    return item;
  });
}

app.post("/api/auth/login", authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Username e password sao obrigatorios." });
    }

    const rows = await query(
      "SELECT id, username, password, role FROM funcionarios WHERE username = ? LIMIT 1",
      [username]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Credenciais invalidas." });

    const storedPassword = String(user.password || "");
    const isBcryptHash = /^\$2[aby]\$\d{2}\$/.test(storedPassword);
    let isMatch = false;

    if (isBcryptHash) {
      isMatch = bcrypt.compareSync(password, storedPassword);
    } else if (password === storedPassword) {
      // Migra passwords antigas para hash no primeiro login bem-sucedido.
      const migratedHash = bcrypt.hashSync(password, 12);
      await query("UPDATE funcionarios SET password = ? WHERE id = ?", [migratedHash, user.id]);
      isMatch = true;
    }

    if (!isMatch) return res.status(401).json({ error: "Credenciais invalidas." });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      jwtSecret,
      { expiresIn: jwtExpiresIn }
    );
    return res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (_error) {
    return res.status(500).json({ error: "Erro interno no login." });
  }
});

app.get("/api/auth/me", requireAuth, (req, res) => res.json({ user: req.user }));

app.get("/api/works", requireAuth, async (req, res) => {
  try {
    const status = req.query.status || null;
    const client = req.query.client || "";
    const clientIdRaw = Number(req.query.client_id);
    const clientId = Number.isInteger(clientIdRaw) && clientIdRaw > 0 ? clientIdRaw : null;
    const allowed = ["pending", "in_progress", "done", "suspended"];
    const filter = status && allowed.includes(status) ? status : null;
    return res.json(await getWorks(filter, client, clientId));
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao listar obras." });
  }
});

app.post("/api/works", requireAuth, requireAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      status,
      priority,
      client_id: clientId,
      client_name: clientName,
      due_date: dueDate
    } = req.body || {};
    const allowed = ["pending", "in_progress", "done", "suspended"];

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "O titulo da obra e obrigatorio." });
    }
    if (status && !allowed.includes(status)) {
      return res.status(400).json({ error: "Estado de obra invalido." });
    }

    const priorityValue = normalizePriority(priority);

    let parsedClientId = null;
    if (clientId !== null && clientId !== undefined && String(clientId).trim() !== "") {
      parsedClientId = Number(clientId);
      if (!Number.isInteger(parsedClientId) || parsedClientId <= 0) {
        return res.status(400).json({ error: "Cliente invalido." });
      }
      const byId = await query("SELECT id FROM clientes WHERE id = ? LIMIT 1", [parsedClientId]);
      if (!byId[0]) {
        return res.status(400).json({ error: "Cliente nao encontrado." });
      }
    } else if (clientName && String(clientName).trim()) {
      const byName = await query(
        "SELECT id FROM clientes WHERE LOWER(nome) = LOWER(?) ORDER BY id DESC",
        [String(clientName).trim()]
      );
      if (byName.length === 1) {
        parsedClientId = byName[0].id;
      } else if (byName.length > 1) {
        return res.status(400).json({ error: "Existem varios clientes com esse nome. Escolhe um da lista." });
      } else {
        return res.status(400).json({ error: "Cliente nao encontrado." });
      }
    }

    if (!parsedClientId) {
      return res.status(400).json({ error: "Seleciona um cliente valido da lista." });
    }

    const estadoId = await getEstadoIdFromCode(status || "pending");
    if (!estadoId) {
      return res.status(400).json({ error: "Estado nao encontrado na tabela estados." });
    }

    const nextWorkId = await getNextTableId("obras");
    const baseColumns = ["id", "nome_obra", "descricao", "id_cliente", "id_estado", "process_steps_configured"];
    const baseValues = [nextWorkId, String(title).trim(), description ? String(description).trim() : null, parsedClientId, estadoId];
    baseValues.push(1);
    if (schemaInfo.obrasPriorityColumn) {
      baseColumns.push(schemaInfo.obrasPriorityColumn);
      baseValues.push(priorityValue);
    }
    if (schemaInfo.obrasDueDateColumn) {
      baseColumns.push(schemaInfo.obrasDueDateColumn);
      baseValues.push(dueDate || null);
    }
    const placeholders = baseColumns.map(() => "?").join(", ");
    const result = await query(
      `INSERT INTO obras (${baseColumns.join(", ")}) VALUES (${placeholders})`,
      baseValues
    );

    for (const [index, step] of defaultProcessSteps.entries()) {
      const nextStepId = await getNextTableId("obra_etapas");
      await query(
        "INSERT INTO obra_etapas (id, id_obra, nome_etapa, concluida, order_index) VALUES (?, ?, ?, 0, ?)",
        [nextStepId, nextWorkId, step.label, index]
      );
    }
    await ensureDefaultMaterialsForWork(nextWorkId);

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === nextWorkId);
    await createAuditLog(req, "create_work", "work", nextWorkId, nextWorkId, {
      title: String(title).trim(),
      status: status || "pending",
      priority: priorityValue,
      client_id: parsedClientId
    });
    return res.status(201).json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao criar obra." });
  }
});

app.patch("/api/works/:id/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = req.body?.status;
    const allowed = ["pending", "in_progress", "done", "suspended"];
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!allowed.includes(status)) return res.status(400).json({ error: "Estado de obra invalido." });

    if (status === "in_progress") {
      const firstStepDone = await isWorkReadyForInProgress(id);
      if (!firstStepDone) {
        return res.status(400).json({ error: "A obra so pode passar para Em progresso depois da primeira etapa estar concluida." });
      }
    }

    const estadoId = await getEstadoIdFromCode(status);
    if (!estadoId) return res.status(400).json({ error: "Estado nao encontrado na tabela estados." });

    const result = await query("UPDATE obras SET id_estado = ? WHERE id = ?", [estadoId, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Obra nao encontrada." });

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_work_status", "work", id, id, { status });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar estado da obra." });
  }
});

app.patch("/api/works/:id/materials/:materialKey", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { materialKey } = req.params;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!materialKeys.has(materialKey)) return res.status(400).json({ error: "Material invalido." });

    const ordered = req.body?.ordered === true || req.body?.ordered === "true" ? 1 : 0;
    const arrived = req.body?.arrived === true || req.body?.arrived === "true" ? 1 : 0;
    const materialName = materialMap[materialKey];

    const existing = await query(
      "SELECT id FROM materiais WHERE id_obra = ? AND nome_material = ? ORDER BY id DESC LIMIT 1",
      [id, materialName]
    );

    if (existing[0]) {
      await query(
        `UPDATE materiais
         SET encomendado = ?, chegou = ?,
             data_encomenda = IF(? = 1 AND data_encomenda IS NULL, CURDATE(), data_encomenda),
             data_chegada = IF(? = 1 AND data_chegada IS NULL, CURDATE(), data_chegada)
         WHERE id = ?`,
        [ordered, arrived, ordered, arrived, existing[0].id]
      );
    } else {
      const nextMaterialId = await getNextTableId("materiais");
      await query(
        `INSERT INTO materiais (id, id_obra, nome_material, encomendado, chegou, data_encomenda, data_chegada)
         VALUES (?, ?, ?, ?, ?, IF(? = 1, CURDATE(), NULL), IF(? = 1, CURDATE(), NULL))`,
        [nextMaterialId, id, materialName, ordered, arrived, ordered, arrived]
      );
      existing[0] = { id: nextMaterialId };
    }

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_material", "material", existing[0]?.id || null, id, {
      material_key: materialKey,
      ordered,
      arrived
    });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar material." });
  }
});

app.post("/api/works/:id/materials", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const label = normalizeMaterialLabel(req.body?.label);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!label) return res.status(400).json({ error: "O nome do material e obrigatorio." });
    if (label.length > 120) return res.status(400).json({ error: "O nome do material e demasiado longo." });

    const existing = await query(
      "SELECT id FROM materiais WHERE id_obra = ? AND LOWER(nome_material) = LOWER(?) ORDER BY id DESC LIMIT 1",
      [id, label]
    );
    if (existing[0]) {
      return res.status(409).json({ error: "Ja existe um material com esse nome nesta obra." });
    }

    const nextMaterialId = await getNextTableId("materiais");
    await query(
      "INSERT INTO materiais (id, id_obra, nome_material, encomendado, chegou) VALUES (?, ?, ?, 0, 0)",
      [nextMaterialId, id, label]
    );

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "create_material", "material", nextMaterialId, id, { label });
    return res.status(201).json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao criar material." });
  }
});

app.patch("/api/works/:id/materials/item/:materialId", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const materialId = Number(req.params.materialId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!Number.isInteger(materialId) || materialId <= 0) return res.status(400).json({ error: "Material invalido." });

    const ordered = req.body?.ordered === true || req.body?.ordered === "true" ? 1 : 0;
    const arrived = req.body?.arrived === true || req.body?.arrived === "true" ? 1 : 0;
    const existing = await query(
      "SELECT id, nome_material, invoice_photo_path FROM materiais WHERE id = ? AND id_obra = ? LIMIT 1",
      [materialId, id]
    );
    if (!existing[0]) return res.status(404).json({ error: "Material nao encontrado." });
    if (arrived === 1 && !existing[0].invoice_photo_path) {
      return res.status(400).json({ error: "Para marcar como recebido tens de anexar uma foto da fatura." });
    }

    await query(
      `UPDATE materiais
       SET encomendado = ?, chegou = ?,
           data_encomenda = IF(? = 1 AND data_encomenda IS NULL, CURDATE(), data_encomenda),
           data_chegada = IF(? = 1 AND data_chegada IS NULL, CURDATE(), data_chegada)
       WHERE id = ? AND id_obra = ?`,
      [ordered, arrived, ordered, arrived, materialId, id]
    );

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_material", "material", materialId, id, {
      label: existing[0].nome_material,
      ordered,
      arrived
    });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar material." });
  }
});

app.patch("/api/works/:id/materials/item/:materialId/order-note", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const materialId = Number(req.params.materialId);
    const orderNote = String(req.body?.order_note || "").trim();
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!Number.isInteger(materialId) || materialId <= 0) return res.status(400).json({ error: "Material invalido." });

    const existing = await query(
      "SELECT id, nome_material FROM materiais WHERE id = ? AND id_obra = ? LIMIT 1",
      [materialId, id]
    );
    if (!existing[0]) return res.status(404).json({ error: "Material nao encontrado." });

    await query(
      "UPDATE materiais SET nota_encomenda = ? WHERE id = ? AND id_obra = ?",
      [orderNote || null, materialId, id]
    );

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_material_order_note", "material", materialId, id, {
      label: existing[0].nome_material,
      order_note: orderNote
    });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao guardar nota de encomenda." });
  }
});

app.delete("/api/works/:id/materials/item/:materialId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const materialId = Number(req.params.materialId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!Number.isInteger(materialId) || materialId <= 0) return res.status(400).json({ error: "Material invalido." });

    const existing = await query(
      "SELECT id, nome_material FROM materiais WHERE id = ? AND id_obra = ? LIMIT 1",
      [materialId, id]
    );
    if (!existing[0]) return res.status(404).json({ error: "Material nao encontrado." });

    await query("DELETE FROM materiais WHERE id = ? AND id_obra = ?", [materialId, id]);
    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "delete_material", "material", materialId, id, { label: existing[0].nome_material });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao eliminar material." });
  }
});

async function updateProcessStepDone(req, workId, stepId, done) {
  const steps = await normalizeProcessStepOrder(workId);
  const stepIndex = steps.findIndex((step) => Number(step.id) === Number(stepId));
  if (stepIndex < 0) {
    throw new Error("Etapa nao encontrada.");
  }

  if (done === 1 && stepIndex > 0) {
    const previousDone = Number(Boolean(steps[stepIndex - 1].concluida));
    if (!previousDone) {
      throw new Error("Conclui a etapa anterior antes de avancar.");
    }
  }

  if (done === 0) {
    for (let index = stepIndex + 1; index < steps.length; index += 1) {
      if (Number(Boolean(steps[index].concluida)) === 1) {
        throw new Error("Nao podes desmarcar esta etapa enquanto existirem etapas seguintes concluidas.");
      }
    }
  }

  if (done === 1) {
    await query(
      "UPDATE obra_etapas SET concluida = ?, checked_by_user_id = ?, checked_by_username = ?, checked_at = NOW() WHERE id = ? AND id_obra = ?",
      [done, req.user?.id || null, req.user?.username || null, stepId, workId]
    );
  } else {
    await query(
      "UPDATE obra_etapas SET concluida = ?, checked_by_user_id = NULL, checked_by_username = NULL, checked_at = NULL WHERE id = ? AND id_obra = ?",
      [done, stepId, workId]
    );
  }
  await recalculateWorkStatusFromProcessSteps(workId);
}

app.post("/api/works/:id/process", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const label = normalizeProcessStepLabel(req.body?.label);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!label) return res.status(400).json({ error: "O nome da etapa e obrigatorio." });
    if (label.length > 120) return res.status(400).json({ error: "O nome da etapa e demasiado longo." });

    const existing = await query(
      "SELECT id FROM obra_etapas WHERE id_obra = ? AND LOWER(nome_etapa) = LOWER(?) LIMIT 1",
      [id, label]
    );
    if (existing[0]) {
      return res.status(409).json({ error: "Ja existe uma etapa com esse nome nesta obra." });
    }

    const rows = await getOrderedProcessSteps(id);
    const nextOrderIndex = rows.length;
    const nextStepId = await getNextTableId("obra_etapas");
    await query(
      "INSERT INTO obra_etapas (id, id_obra, nome_etapa, concluida, order_index) VALUES (?, ?, ?, 0, ?)",
      [nextStepId, id, label, nextOrderIndex]
    );
    await recalculateWorkStatusFromProcessSteps(id);

    const works = await getWorks(null);
    const work = works.find((item) => item.id === id);
    await createAuditLog(req, "create_process_step", "process_step", nextStepId, id, { label, order_index: nextOrderIndex });
    return res.status(201).json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao criar etapa." });
  }
});

app.patch("/api/works/:id/process/reorder", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stepIds = Array.isArray(req.body?.stepIds) ? req.body.stepIds.map((item) => Number(item)) : [];
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });

    const rows = await getOrderedProcessSteps(id);
    if (!rows.length) return res.status(400).json({ error: "Nao existem etapas para ordenar." });
    if (stepIds.length !== rows.length) {
      return res.status(400).json({ error: "A nova ordem das etapas esta incompleta." });
    }

    const currentIds = new Set(rows.map((row) => Number(row.id)));
    const nextIds = new Set(stepIds);
    if (currentIds.size !== nextIds.size || stepIds.some((stepId) => !currentIds.has(stepId))) {
      return res.status(400).json({ error: "A ordem indicada contem etapas invalidas." });
    }

    for (const [index, stepId] of stepIds.entries()) {
      await query("UPDATE obra_etapas SET order_index = ? WHERE id = ? AND id_obra = ?", [index, stepId, id]);
    }
    await recalculateWorkStatusFromProcessSteps(id);

    const works = await getWorks(null);
    const work = works.find((item) => item.id === id);
    await createAuditLog(req, "reorder_process_steps", "work", id, id, { step_ids: stepIds });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao reordenar etapas." });
  }
});

app.delete("/api/works/:id/process/item/:stepId", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stepId = Number(req.params.stepId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!Number.isInteger(stepId) || stepId <= 0) return res.status(400).json({ error: "Etapa invalida." });

    const existing = await query(
      "SELECT id, nome_etapa FROM obra_etapas WHERE id = ? AND id_obra = ? LIMIT 1",
      [stepId, id]
    );
    if (!existing[0]) return res.status(404).json({ error: "Etapa nao encontrada." });

    await query("DELETE FROM obra_etapas WHERE id = ? AND id_obra = ?", [stepId, id]);
    await normalizeProcessStepOrder(id);
    await recalculateWorkStatusFromProcessSteps(id);

    const works = await getWorks(null);
    const work = works.find((item) => item.id === id);
    await createAuditLog(req, "delete_process_step", "process_step", stepId, id, { label: existing[0].nome_etapa });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao eliminar etapa." });
  }
});

app.patch("/api/works/:id/process/item/:stepId", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const stepId = Number(req.params.stepId);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!Number.isInteger(stepId) || stepId <= 0) return res.status(400).json({ error: "Etapa invalida." });

    const done = req.body?.done === true || req.body?.done === "true" ? 1 : 0;
    const existing = await query(
      "SELECT id, nome_etapa FROM obra_etapas WHERE id = ? AND id_obra = ? LIMIT 1",
      [stepId, id]
    );
    if (!existing[0]) return res.status(404).json({ error: "Etapa nao encontrada." });

    await updateProcessStepDone(req, id, stepId, done);
    const works = await getWorks(null);
    const work = works.find((item) => item.id === id);
    await createAuditLog(req, "update_process_step", "process_step", stepId, id, {
      step_key: getProcessStepKeyByName(existing[0].nome_etapa),
      label: existing[0].nome_etapa,
      done
    });
    return res.json(work || null);
  } catch (error) {
    const message = error?.message || "Erro ao atualizar etapa.";
    const status = message.includes("antes de avancar") || message.includes("etapas seguintes") || message.includes("nao encontrada")
      ? 400
      : 500;
    return res.status(status).json({ error: message });
  }
});

app.patch("/api/works/:id/process/:stepKey", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { stepKey } = req.params;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!processStepKeys.has(stepKey)) return res.status(400).json({ error: "Etapa invalida." });

    const stepName = processStepMap[stepKey];
    const existing = await query(
      "SELECT id FROM obra_etapas WHERE id_obra = ? AND nome_etapa = ? LIMIT 1",
      [id, stepName]
    );
    if (!existing[0]) return res.status(404).json({ error: "Etapa nao encontrada." });

    const done = req.body?.done === true || req.body?.done === "true" ? 1 : 0;
    await updateProcessStepDone(req, id, existing[0].id, done);
    const works = await getWorks(null);
    const work = works.find((item) => item.id === id);
    await createAuditLog(req, "update_process_step", "process_step", existing[0].id, id, { step_key: stepKey, done });
    return res.json(work || null);
  } catch (error) {
    const message = error?.message || "Erro ao atualizar etapa.";
    const status = message.includes("antes de avancar") || message.includes("etapas seguintes") || message.includes("nao encontrada")
      ? 400
      : 500;
    return res.status(status).json({ error: message });
  }
});

app.post("/api/works/:id/process/:stepKey/upload", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { stepKey } = req.params;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
  if (stepKey !== "kitchen_design") {
    return res.status(400).json({ error: "Apenas a etapa Desenho da cozinha permite PDF." });
  }

  upload.single("pdf")(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || "Falha no upload do PDF." });
    if (!req.file) return res.status(400).json({ error: "Selecione um ficheiro PDF." });

    try {
      const stepName = processStepMap[stepKey];
      const publicPath = `/uploads/${req.file.filename}`;
      const existing = await query(
        "SELECT id FROM obra_etapas WHERE id_obra = ? AND nome_etapa = ? LIMIT 1",
        [id, stepName]
      );

      if (existing[0]) {
        await query("UPDATE obra_etapas SET pdf_path = ? WHERE id = ?", [publicPath, existing[0].id]);
      } else {
        const nextProcessStepId = await getNextTableId("obra_etapas");
        const orderedSteps = await getOrderedProcessSteps(id);
        await query(
          "INSERT INTO obra_etapas (id, id_obra, nome_etapa, concluida, pdf_path, order_index) VALUES (?, ?, ?, 0, ?, ?)",
          [nextProcessStepId, id, stepName, publicPath, orderedSteps.length]
        );
        existing[0] = { id: nextProcessStepId };
      }

      const rows = await getWorks(null);
      const work = rows.find((item) => item.id === id);
      await createAuditLog(req, "upload_process_pdf", "process_step", existing[0]?.id || null, id, {
        step_key: stepKey,
        pdf_path: publicPath
      });
      return res.json(work || null);
    } catch (_err) {
      return res.status(500).json({ error: "Erro ao guardar PDF da etapa." });
    }
  });
});

app.post("/api/works/:id/materials/:materialKey/upload", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { materialKey } = req.params;
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
  if (!materialKeys.has(materialKey)) return res.status(400).json({ error: "Material invalido." });

  upload.single("pdf")(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || "Falha no upload do PDF." });
    if (!req.file) return res.status(400).json({ error: "Selecione um ficheiro PDF." });

    try {
      const materialName = materialMap[materialKey];
      const publicPath = `/uploads/${req.file.filename}`;
      const existing = await query(
        "SELECT id FROM materiais WHERE id_obra = ? AND nome_material = ? ORDER BY id DESC LIMIT 1",
        [id, materialName]
      );

      if (existing[0]) {
        await query("UPDATE materiais SET pdf_path = ? WHERE id = ?", [publicPath, existing[0].id]);
      } else {
        const nextMaterialId = await getNextTableId("materiais");
        await query(
          "INSERT INTO materiais (id, id_obra, nome_material, pdf_path) VALUES (?, ?, ?, ?)",
          [nextMaterialId, id, materialName, publicPath]
        );
        existing[0] = { id: nextMaterialId };
      }

      const rows = await getWorks(null);
      const work = rows.find((item) => item.id === id);
      await createAuditLog(req, "upload_material_pdf", "material", existing[0]?.id || null, id, {
        material_key: materialKey,
        pdf_path: publicPath
      });
      return res.json(work || null);
    } catch (_err) {
      return res.status(500).json({ error: "Erro ao guardar PDF." });
    }
  });
});

app.post("/api/works/:id/materials/item/:materialId/upload", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const materialId = Number(req.params.materialId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
  if (!Number.isInteger(materialId) || materialId <= 0) return res.status(400).json({ error: "Material invalido." });

  upload.single("pdf")(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || "Falha no upload do PDF." });
    if (!req.file) return res.status(400).json({ error: "Selecione um ficheiro PDF." });

    try {
      const existing = await query(
        "SELECT id, nome_material FROM materiais WHERE id = ? AND id_obra = ? LIMIT 1",
        [materialId, id]
      );
      if (!existing[0]) return res.status(404).json({ error: "Material nao encontrado." });

      const publicPath = `/uploads/${req.file.filename}`;
      await query("UPDATE materiais SET pdf_path = ? WHERE id = ? AND id_obra = ?", [publicPath, materialId, id]);

      const rows = await getWorks(null);
      const work = rows.find((item) => item.id === id);
      await createAuditLog(req, "upload_material_pdf", "material", materialId, id, {
        label: existing[0].nome_material,
        pdf_path: publicPath
      });
      return res.json(work || null);
    } catch (_err) {
      return res.status(500).json({ error: "Erro ao guardar PDF." });
    }
  });
});

app.post("/api/works/:id/materials/item/:materialId/invoice-photo", requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const materialId = Number(req.params.materialId);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
  if (!Number.isInteger(materialId) || materialId <= 0) return res.status(400).json({ error: "Material invalido." });

  imageUpload.single("invoice_photo")(req, res, async (error) => {
    if (error) return res.status(400).json({ error: error.message || "Falha no upload da foto." });
    if (!req.file) return res.status(400).json({ error: "Seleciona ou tira uma foto da fatura." });

    try {
      const existing = await query(
        "SELECT id, nome_material FROM materiais WHERE id = ? AND id_obra = ? LIMIT 1",
        [materialId, id]
      );
      if (!existing[0]) return res.status(404).json({ error: "Material nao encontrado." });

      const publicPath = `/uploads/${req.file.filename}`;
      await query(
        "UPDATE materiais SET invoice_photo_path = ? WHERE id = ? AND id_obra = ?",
        [publicPath, materialId, id]
      );

      const rows = await getWorks(null);
      const work = rows.find((item) => item.id === id);
      await createAuditLog(req, "upload_material_invoice_photo", "material", materialId, id, {
        label: existing[0].nome_material,
        invoice_photo_path: publicPath
      });
      return res.json(work || null);
    } catch (_err) {
      return res.status(500).json({ error: "Erro ao guardar foto da fatura." });
    }
  });
});

app.get("/api/clients", requireAuth, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, nome AS name, telefone AS phone, email,
              ${schemaInfo.clientesNifColumn ? `${schemaInfo.clientesNifColumn} AS nif,` : "NULL AS nif,"}
              ${schemaInfo.clientesAddressColumn ? `${schemaInfo.clientesAddressColumn} AS address,` : "NULL AS address,"}
              NULL AS notes, created_at
       FROM clientes
       ORDER BY id DESC`
    );
    return res.json(rows);
  } catch (_error) {
    return res.status(500).json({ error: "Erro ao listar clientes." });
  }
});

app.post("/api/clients", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { name, phone, email, nif, address } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "O nome do cliente e obrigatorio." });
    }
    const nifValue = String(nif || "").trim();
    const addressValue = String(address || "").trim();
    if (nifValue && !/^\d{9}$/.test(nifValue)) {
      return res.status(400).json({ error: "NIF deve ter 9 digitos." });
    }
    const nextClientId = await getNextTableId("clientes");
    const insertColumns = ["id", "nome", "telefone", "email"];
    const insertValues = [nextClientId, String(name).trim(), phone || null, email || null];
    if (schemaInfo.clientesNifColumn) {
      insertColumns.push(schemaInfo.clientesNifColumn);
      insertValues.push(nifValue || null);
    }
    if (schemaInfo.clientesAddressColumn) {
      insertColumns.push(schemaInfo.clientesAddressColumn);
      insertValues.push(addressValue || null);
    }
    const placeholders = insertColumns.map(() => "?").join(", ");
    const result = await query(
      `INSERT INTO clientes (${insertColumns.join(", ")}) VALUES (${placeholders})`,
      insertValues
    );
    const rows = await query(
      `SELECT id, nome AS name, telefone AS phone, email, ${schemaInfo.clientesNifColumn ? `${schemaInfo.clientesNifColumn} AS nif,` : "NULL AS nif,"} NULL AS notes, created_at
       FROM clientes
       WHERE id = ?`,
      [nextClientId]
    );
    await createAuditLog(req, "create_client", "client", nextClientId, null, {
      name: String(name).trim(),
      nif: nifValue || null
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao criar cliente." });
  }
});

app.post("/api/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body || {};
    const roleValue = role === "admin" ? "admin" : "funcionario";
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: "Username obrigatorio." });
    }
    if (!password || String(password).length < 6) {
      return res.status(400).json({ error: "Password deve ter pelo menos 6 caracteres." });
    }
    const usernameValue = String(username).trim();
    const existing = await query("SELECT id FROM funcionarios WHERE username = ? LIMIT 1", [usernameValue]);
    if (existing[0]) return res.status(409).json({ error: "Username ja existe." });

    const nextUserId = await getNextTableId("funcionarios");
    const passwordHash = bcrypt.hashSync(String(password), 12);
    const result = await query(
      "INSERT INTO funcionarios (id, nome, username, password, role) VALUES (?, ?, ?, ?, ?)",
      [nextUserId, usernameValue, usernameValue, passwordHash, roleValue]
    );
    const rows = await query(
      "SELECT id, username, role, created_at FROM funcionarios WHERE id = ? LIMIT 1",
      [nextUserId]
    );
    await createAuditLog(req, "create_user", "user", nextUserId, null, {
      username: usernameValue,
      role: roleValue
    });
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao criar utilizador." });
  }
});

app.get("/api/logs", requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit || 200);
    const work = String(req.query.work || "");
    return res.json(await getAuditLogs(limit, work));
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao listar logs." });
  }
});

app.patch("/api/works/:id/priority", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const priority = normalizePriority(req.body?.priority);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!schemaInfo.obrasPriorityColumn) {
      return res.status(500).json({ error: "Coluna de prioridade nao encontrada." });
    }

    const result = await query(`UPDATE obras SET ${schemaInfo.obrasPriorityColumn} = ? WHERE id = ?`, [priority, id]);
    if (!result.affectedRows) return res.status(404).json({ error: "Obra nao encontrada." });

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_work_priority", "work", id, id, { priority });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar prioridade." });
  }
});

app.patch("/api/works/:id/observations", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const observations = String(req.body?.observations || "").trim() || null;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!schemaInfo.obrasObservationsColumn) {
      return res.status(500).json({ error: "Coluna de observacoes nao encontrada." });
    }

    const result = await query(
      `UPDATE obras SET ${schemaInfo.obrasObservationsColumn} = ? WHERE id = ?`,
      [observations, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: "Obra nao encontrada." });

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_work_observations", "work", id, id, {
      observations
    });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar observacoes." });
  }
});

app.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const rows = await query(
      "SELECT id, username, role, created_at FROM funcionarios ORDER BY id DESC"
    );
    return res.json(rows.map((row) => ({ ...row, password_preview: "********" })));
  } catch (_error) {
    return res.status(500).json({ error: "Erro ao listar utilizadores." });
  }
});

app.delete("/api/users/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID de utilizador invalido." });
    }
    if (id === Number(req.user?.id)) {
      return res.status(400).json({ error: "Nao podes eliminar o teu proprio utilizador." });
    }

    const result = await query("DELETE FROM funcionarios WHERE id = ?", [id]);
    if (!result.affectedRows) {
      return res.status(404).json({ error: "Utilizador nao encontrado." });
    }
    await createAuditLog(req, "delete_user", "user", id, null, { deleted_user_id: id });
    return res.json({ success: true });
  } catch (_error) {
    return res.status(500).json({ error: "Erro ao eliminar utilizador." });
  }
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "login.html")));

function validateRuntimeConfig() {
  const dbPort = Number(process.env.DB_PORT || 3306);
  if (!Number.isInteger(normalizedPort) || normalizedPort <= 0 || normalizedPort > 65535) {
    throw new Error(`PORT invalido: ${port}. Usa um porto entre 1 e 65535.`);
  }
  if (normalizedPort === dbPort) {
    throw new Error(
      `PORT (${normalizedPort}) nao pode ser igual ao DB_PORT (${dbPort}). ` +
      "Define PORT=3000 para a app e mantém DB_PORT=3306 para o MySQL."
    );
  }
}

async function start() {
  try {
    if (!jwtSecret) {
      throw new Error("JWT_SECRET obrigatorio no ambiente.");
    }
    if (isProd && jwtSecret.length < 32) {
      throw new Error("JWT_SECRET demasiado curto para producao (minimo 32 caracteres).");
    }
    validateRuntimeConfig();

    await initDb();
    await ensureProcessStepsTable();
    await ensureAuditLogsTable();
    await ensureWorksPriorityColumn();
    await ensureWorksObservationsColumn();
    await ensureClientsNifColumn();
    await ensureClientsAddressColumn();
    await ensureWorksProcessConfiguredColumn();
    await ensureMaterialsExtraColumns();
    await initializeMaterialsForExistingWorks();
    await initializeProcessStepsForExistingWorks();
    await loadSchemaInfo();
    const server = app.listen(normalizedPort, () => {
      // eslint-disable-next-line no-console
      console.log("Server running on port " + normalizedPort);
    });
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        // eslint-disable-next-line no-console
        console.error(`Falha ao arrancar: o porto ${normalizedPort} ja esta a ser usado por outro processo.`);
        process.exit(1);
      }
      // eslint-disable-next-line no-console
      console.error("Falha ao arrancar servidor:", error.message);
      process.exit(1);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Falha ao ligar ao MySQL:", error.message);
    process.exit(1);
  }
}

start();
