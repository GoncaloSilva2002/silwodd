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
const materialKeys = new Set(Object.keys(materialMap));
const processStepMap = {
  kitchen_design: "Desenho da cozinha",
  cutting: "Corte",
  cnc: "CNC",
  assembly: "Montagem",
  painting: "Pintura",
  loaded: "Carregar",
  unloaded: "Descarregar",
  installation_start: "Inicio de montagem",
  installation_end: "Fim de montagem"
};
const processStepOrder = [
  "kitchen_design",
  "cutting",
  "cnc",
  "assembly",
  "painting",
  "loaded",
  "unloaded",
  "installation_start",
  "installation_end"
];
const processStepKeys = new Set(Object.keys(processStepMap));
const schemaInfo = {
  obrasDueDateColumn: null,
  obrasPriorityColumn: null,
  obrasObservationsColumn: null,
  clientesNifColumn: null
};

const statusCodeToCandidates = {
  pending: ["Pendente"],
  in_progress: ["Em execucao", "Em execucao"],
  done: ["Concluida", "Concluida"],
  suspended: ["Suspensa"]
};
const statusNameToCode = {
  pendente: "pending",
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

async function isKitchenDesignDone(workId) {
  const stepName = processStepMap.kitchen_design;
  const rows = await query(
    "SELECT concluida FROM obra_etapas WHERE id_obra = ? AND nome_etapa = ? LIMIT 1",
    [workId, stepName]
  );
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

  const clientColumns = await query("SHOW COLUMNS FROM clientes");
  const clientNames = new Set(clientColumns.map((column) => String(column.Field)));
  const nifCandidates = ["nif", "numero_contribuinte"];
  schemaInfo.clientesNifColumn = nifCandidates.find((name) => clientNames.has(name)) || null;
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

async function getNextTableId(tableName) {
  const rows = await query(`SELECT COALESCE(MAX(id), 0) + 1 AS nextId FROM ${tableName}`);
  return Number(rows[0]?.nextId || 1);
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
    await query(
      `INSERT INTO audit_logs (user_id, username, user_role, action_type, entity_type, entity_id, work_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
     ORDER BY created_at DESC, id DESC
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
  const materialNames = Object.values(materialMap);
  const placeholdersObras = obraIds.map(() => "?").join(", ");
  const placeholdersMaterials = materialNames.map(() => "?").join(", ");
  let materials = [];
  let processSteps = [];
  try {
    materials = await query(
      `
        SELECT id_obra, nome_material, pdf_path, encomendado, chegou
        FROM materiais
        WHERE id_obra IN (${placeholdersObras})
          AND nome_material IN (${placeholdersMaterials})
        ORDER BY id DESC
      `,
      [...obraIds, ...materialNames]
    );
  } catch (error) {
    // Keep works visible even if materiais table/columns are inconsistent.
    // eslint-disable-next-line no-console
    console.error("Erro ao carregar materiais:", error.sqlMessage || error.message);
  }
  const stepNames = Object.values(processStepMap);
  const placeholdersSteps = stepNames.map(() => "?").join(", ");
  try {
    processSteps = await query(
      `
        SELECT id_obra, nome_etapa, concluida, pdf_path
        FROM obra_etapas
        WHERE id_obra IN (${placeholdersObras})
          AND nome_etapa IN (${placeholdersSteps})
      `,
      [...obraIds, ...stepNames]
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Erro ao carregar etapas:", error.sqlMessage || error.message);
  }

  const grouped = new Map();
  for (const material of materials) {
    if (!grouped.has(material.id_obra)) grouped.set(material.id_obra, new Map());
    const byName = grouped.get(material.id_obra);
    if (!byName.has(material.nome_material)) {
      byName.set(material.nome_material, material);
    }
  }
  const stepsGrouped = new Map();
  for (const step of processSteps) {
    if (!stepsGrouped.has(step.id_obra)) stepsGrouped.set(step.id_obra, new Map());
    stepsGrouped.get(step.id_obra).set(step.nome_etapa, step);
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
    const byName = grouped.get(obra.id) || new Map();
    for (const [key, materialName] of Object.entries(materialMap)) {
      const material = byName.get(materialName);
      item[`${key}_pdf_path`] = material?.pdf_path || null;
      item[`${key}_ordered`] = Number(Boolean(material?.encomendado));
      item[`${key}_arrived`] = Number(Boolean(material?.chegou));
    }
    const stepByName = stepsGrouped.get(obra.id) || new Map();
    for (const [key, stepName] of Object.entries(processStepMap)) {
      const step = stepByName.get(stepName);
      item[`${key}_done`] = Number(Boolean(step?.concluida));
      item[`${key}_pdf_path`] = step?.pdf_path || null;
    }
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

    const baseColumns = ["nome_obra", "descricao", "id_cliente", "id_estado"];
    const baseValues = [String(title).trim(), description ? String(description).trim() : null, parsedClientId, estadoId];
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

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === result.insertId);
    await createAuditLog(req, "create_work", "work", result.insertId, result.insertId, {
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
      const kitchenDesignDone = await isKitchenDesignDone(id);
      if (!kitchenDesignDone) {
        return res.status(400).json({ error: "A obra so pode passar para Em progresso depois do Desenho da cozinha estar concluido." });
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
      await query(
        `INSERT INTO materiais (id_obra, nome_material, encomendado, chegou, data_encomenda, data_chegada)
         VALUES (?, ?, ?, ?, IF(? = 1, CURDATE(), NULL), IF(? = 1, CURDATE(), NULL))`,
        [id, materialName, ordered, arrived, ordered, arrived]
      );
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

app.patch("/api/works/:id/process/:stepKey", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { stepKey } = req.params;
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID de obra invalido." });
    if (!processStepKeys.has(stepKey)) return res.status(400).json({ error: "Etapa invalida." });

    const done = req.body?.done === true || req.body?.done === "true" ? 1 : 0;
    const stepName = processStepMap[stepKey];
    const stepIndex = processStepOrder.indexOf(stepKey);
    if (stepIndex < 0) return res.status(400).json({ error: "Etapa invalida." });

    const allRows = await query(
      "SELECT nome_etapa, concluida FROM obra_etapas WHERE id_obra = ?",
      [id]
    );
    const doneByName = new Map();
    for (const row of allRows) {
      doneByName.set(row.nome_etapa, Number(Boolean(row.concluida)));
    }

    if (done === 1 && stepIndex > 0) {
      const previousKey = processStepOrder[stepIndex - 1];
      const previousName = processStepMap[previousKey];
      const previousDone = Number(Boolean(doneByName.get(previousName)));
      if (!previousDone) {
        return res.status(400).json({ error: "Conclui a etapa anterior antes de avancar." });
      }
    }

    if (done === 0) {
      for (let i = stepIndex + 1; i < processStepOrder.length; i += 1) {
        const nextKey = processStepOrder[i];
        const nextName = processStepMap[nextKey];
        const nextDone = Number(Boolean(doneByName.get(nextName)));
        if (nextDone) {
          return res.status(400).json({
            error: "Nao podes desmarcar esta etapa enquanto existirem etapas seguintes concluidas."
          });
        }
      }
    }

    const existing = await query(
      "SELECT id FROM obra_etapas WHERE id_obra = ? AND nome_etapa = ? LIMIT 1",
      [id, stepName]
    );

    if (existing[0]) {
      await query("UPDATE obra_etapas SET concluida = ? WHERE id = ?", [done, existing[0].id]);
    } else {
      await query(
        "INSERT INTO obra_etapas (id_obra, nome_etapa, concluida) VALUES (?, ?, ?)",
        [id, stepName, done]
      );
    }

    doneByName.set(stepName, done);
    const allProcessStepsDone = processStepOrder.every((key) => {
      const name = processStepMap[key];
      return Number(Boolean(doneByName.get(name))) === 1;
    });
    const kitchenDesignDone = Number(Boolean(doneByName.get(processStepMap.kitchen_design))) === 1;
    if (allProcessStepsDone) {
      const doneEstadoId = await getEstadoIdFromCode("done");
      if (doneEstadoId) {
        await query("UPDATE obras SET id_estado = ? WHERE id = ?", [doneEstadoId, id]);
      }
    } else if (kitchenDesignDone) {
      const inProgressEstadoId = await getEstadoIdFromCode("in_progress");
      if (inProgressEstadoId) {
        await query("UPDATE obras SET id_estado = ? WHERE id = ?", [inProgressEstadoId, id]);
      }
    } else {
      const pendingEstadoId = await getEstadoIdFromCode("pending");
      if (pendingEstadoId) {
        await query("UPDATE obras SET id_estado = ? WHERE id = ?", [pendingEstadoId, id]);
      }
    }

    const rows = await getWorks(null);
    const work = rows.find((item) => item.id === id);
    await createAuditLog(req, "update_process_step", "process_step", existing[0]?.id || null, id, {
      step_key: stepKey,
      done
    });
    return res.json(work || null);
  } catch (error) {
    return res.status(500).json({ error: error?.sqlMessage || error?.message || "Erro ao atualizar etapa." });
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
        await query(
          "INSERT INTO obra_etapas (id_obra, nome_etapa, concluida, pdf_path) VALUES (?, ?, 0, ?)",
          [id, stepName, publicPath]
        );
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
        await query("INSERT INTO materiais (id_obra, nome_material, pdf_path) VALUES (?, ?, ?)", [id, materialName, publicPath]);
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

app.get("/api/clients", requireAuth, async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, nome AS name, telefone AS phone, email, ${schemaInfo.clientesNifColumn ? `${schemaInfo.clientesNifColumn} AS nif,` : "NULL AS nif,"} NULL AS notes, created_at
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
    const { name, phone, email, nif } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "O nome do cliente e obrigatorio." });
    }
    const nifValue = String(nif || "").trim();
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

async function start() {
  try {
    if (!jwtSecret) {
      throw new Error("JWT_SECRET obrigatorio no ambiente.");
    }
    if (isProd && jwtSecret.length < 32) {
      throw new Error("JWT_SECRET demasiado curto para producao (minimo 32 caracteres).");
    }

    await initDb();
    await ensureProcessStepsTable();
    await ensureAuditLogsTable();
    await ensureWorksPriorityColumn();
    await ensureWorksObservationsColumn();
    await ensureClientsNifColumn();
    await loadSchemaInfo();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log("Server running on port " + port);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Falha ao ligar ao MySQL:", error.message);
    process.exit(1);
  }
}

start();
