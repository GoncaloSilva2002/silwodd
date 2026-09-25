const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");

const targetHost = "192.168.1.112";
const targetPort = 80;

function createAspiracaoRouter(requireAuth, jwtSecret) {
  const router = express.Router();
  router.get("/ticket", requireAuth, (req, res) => {
    const ticket = jwt.sign({ scope: "aspiracao", user: req.user.id }, jwtSecret, { expiresIn: "10m" });
    res.set("Set-Cookie", `aspiracao_ticket=${encodeURIComponent(ticket)}; Path=/aspiracao-proxy; HttpOnly; SameSite=Lax; Max-Age=600`);
    res.json({ ticket });
  });

  const proxy = (req, res) => {
    let payload;
    const cookieTicket = String(req.headers.cookie || "").match(/(?:^|;\s*)aspiracao_ticket=([^;]+)/)?.[1] || "";
    try { payload = jwt.verify(String(req.query.ticket || decodeURIComponent(cookieTicket)), jwtSecret); }
    catch (_error) { return res.status(401).send("Sessão do painel expirada. Fecha e abre a aba Aspiração novamente."); }
    if (payload.scope !== "aspiracao") return res.status(403).send("Acesso inválido.");
    const path = req.originalUrl.replace(/^\/aspiracao-proxy/, "") || "/";
    const request = http.request({ hostname: targetHost, port: targetPort, method: req.method, path, headers: { ...req.headers, host: `${targetHost}:${targetPort}`, connection: "close" } }, (upstream) => {
      const headers = { ...upstream.headers };
      delete headers["x-frame-options"];
      delete headers["content-security-policy"];
      const contentType = String(headers["content-type"] || "");
      if (contentType.includes("text/html")) {
        const chunks = [];
        upstream.on("data", (chunk) => chunks.push(chunk));
        upstream.on("end", () => {
          const ticketQuery = `?ticket=${encodeURIComponent(req.query.ticket)}`;
          let html = Buffer.concat(chunks).toString("utf8");
          html = html.replace(/<head([^>]*)>/i, `<head$1><base href="/aspiracao-proxy/${ticketQuery}">`);
          html = html.replace(/(src|href|action)=(['"])\/(?!\/)/gi, `$1=$2/aspiracao-proxy/`);
          headers["content-length"] = Buffer.byteLength(html);
          delete headers["transfer-encoding"];
          res.writeHead(upstream.statusCode || 200, headers);
          res.end(html);
        });
      } else {
        res.writeHead(upstream.statusCode || 200, headers);
        upstream.pipe(res);
      }
    });
    request.on("error", () => res.status(502).send("Não foi possível ligar ao equipamento de aspiração."));
    req.pipe(request);
  };
  router.use("/", proxy);
  return router;
}

module.exports = { createAspiracaoRouter };
