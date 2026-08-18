/**
 * Proxy mTLS para a API Cora (ambiente Stage).
 *
 * Por que existe:
 *  - A Cora exige mutual TLS (certificado do cliente) no endpoint /token.
 *  - O runtime das backend functions do Base44 não suporta mTLS nativo.
 *  - Este proxy detém certificate.pem + private-key.key no próprio filesystem
 *    e repassa as requisições para https://matls-clients.api.stage.cora.com.br
 *    apresentando o certificado do cliente.
 *
 * Deploy: Render / Railway / Fly.io / qualquer host Node.
 * Variáveis de ambiente:
 *  - PORT (default 3000)
 *  - CERT_PATH (default ./certificate.pem)
 *  - KEY_PATH  (default ./private-key.key)
 *  - CORA_BASE (default https://matls-clients.api.stage.cora.com.br)
 *
 * Coloque os arquivos certificate.pem e private-key.key na raiz do projeto
 * (ou ajuste CERT_PATH / KEY_PATH). NÃO faça commit deles — veja .gitignore.
 */

const express = require("express");
const https = require("https");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

const CERT_PATH = process.env.CERT_PATH || "./certificate.pem";
const KEY_PATH = process.env.KEY_PATH || "./private-key.key";
const CORA_BASE = process.env.CORA_BASE || "https://matls-clients.api.stage.cora.com.br";
const PROXY_API_KEY = process.env.PROXY_API_KEY;

// Comparação em tempo constante para evitar timing attacks.
function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Lê o certificado e a chave uma vez na inicialização.
// Falha cedo (crash) se os arquivos não existirem — mais fácil de diagnosticar.
const cert = fs.readFileSync(CERT_PATH);
const key = fs.readFileSync(KEY_PATH);

const agent = new https.Agent({
  cert,
  key,
  rejectUnauthorized: true,
});

// Body raw — repassamos o corpo original byte a byte.
app.use(express.raw({ type: "*/*", limit: "2mb" }));

// Healthcheck simples (não repassa para a Cora, não exige API key).
app.get("/_health", (req, res) => {
  res.json({ status: "ok", cora_base: CORA_BASE });
});

// Middleware de autenticação: toda requisição (exceto /_health) deve trazer
// o header X-Proxy-Key igual à env var PROXY_API_KEY. Sem isso o proxy é um
// relé aberto — qualquer um que descobrir a URL poderia usá-lo.
app.use((req, res, next) => {
  if (req.path === "/_health") return next();
  if (!PROXY_API_KEY) {
    return res.status(500).json({ error: "proxy_not_configured", message: "PROXY_API_KEY não definida no proxy." });
  }
  const provided = req.headers["x-proxy-key"];
  if (!provided || !timingSafeEqual(provided, PROXY_API_KEY)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

// Forwarder genérico de qualquer path/method para a Cora.
app.all("*", (req, res) => {
  const targetUrl = new URL(CORA_BASE + req.originalUrl);

  // Repassa os headers originais, ajustando o Host para o destino.
  // Remove o X-Proxy-Key para não vazar a chave de autenticação do proxy
  // para a API Cora (a chave é apenas para o hop Base44↔Proxy).
  const headers = { ...req.headers, host: targetUrl.host };
  delete headers["x-proxy-key"];
  delete headers["content-length"]; // https.request recalcula

  const proxyReq = https.request(
    {
      hostname: targetUrl.hostname,
      port: 443,
      path: targetUrl.pathname + targetUrl.search,
      method: req.method,
      headers,
      agent,
    },
    (upstream) => {
      // Remove headers de transporte que não devem ser repassados ao cliente.
      const respHeaders = { ...upstream.headers };
      delete respHeaders["transfer-encoding"];
      res.writeHead(upstream.statusCode, respHeaders);
      upstream.pipe(res);
    }
  );

  proxyReq.on("error", (e) => {
    res.status(502).json({ error: "proxy_error", message: e.message });
  });

  // Envia o corpo da requisição original (se houver).
  if (req.body && req.body.length) {
    proxyReq.write(req.body);
  }
  proxyReq.end();
});

app.listen(PORT, () => {
  console.log(`Cora mTLS proxy listening on :${PORT} → ${CORA_BASE}`);
});