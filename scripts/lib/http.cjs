/**
 * Camada unica de requisicao HTTP da Thais.
 *
 * Tudo que sai para a rede (busca de imagem, download, API) passa por aqui.
 * O que ela garante, e que nenhum modulo de fonte deve reimplementar:
 *
 * 1. User-Agent por politica: hosts *.wikimedia.org recebem UA identificado
 *    (exigencia da User-Agent policy deles; UA de navegador leva throttling).
 * 2. Espacamento minimo entre requisicoes ao MESMO host (anti-rajada).
 * 3. Retry de 429 respeitando Retry-After.
 * 4. Cache em disco (cache/http/) com TTL — buscas repetidas no mesmo dia
 *    ou entre execucoes nao gastam requisicao nova.
 * 5. Orcamento diario por fonte (cache/orcamento-AAAAMMDD.json) — quando o
 *    teto do dia estoura, a fonte responde "sem orcamento" em vez de
 *    continuar batendo na API.
 * 6. Memoria de falha por perfil (cache/perfis-falha.json) — perfil que
 *    falhou entra em cooldown e nao e retentado a cada materia.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { setTimeout: sleep } = require("timers/promises");

const ROOT = path.resolve(__dirname, "../..");
const CACHE_DIR = path.join(ROOT, "cache");
const HTTP_CACHE_DIR = path.join(CACHE_DIR, "http");

const UA_NAVEGADOR = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const UA_WIKIMEDIA = "ThaisSelecaoBot/1.0 (uso editorial - selecao de imagens para materias; contato: criatixagencia@gmail.com)";

// Espacamento minimo entre requisicoes ao mesmo host, em ms.
const ESPACO_POR_HOST_MS = { padrao: 150, "wikimedia.org": 450, "duckduckgo.com": 400 };

// Tetos diarios por fonte. Ajustaveis por env THAIS_TETO_<FONTE>.
const TETOS_PADRAO = {
  wikimedia_api: 300,
  apify_runs: 12,
  ddg_buscas: 40,
  twitter_cli: 40,
  downloads: 300,
};

// TTL de cache por tipo de conteudo.
const TTL_PADRAO_MS = {
  busca: 24 * 3600 * 1000,      // resultado de busca (Wikimedia/DDG) vale 24h
  imagem: 7 * 24 * 3600 * 1000, // bytes de imagem valem 7 dias
  pagina: 12 * 3600 * 1000,     // HTML de pagina (extracao de credito)
};

function carregarEnvLocal() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function hoje() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function garantirDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function lerJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function gravarJson(filePath, data) {
  garantirDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function hostDe(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isWikimediaHost(url) {
  const host = hostDe(url);
  return host === "wikimedia.org" || host.endsWith(".wikimedia.org");
}

function userAgentPara(url) {
  return isWikimediaHost(url) ? UA_WIKIMEDIA : UA_NAVEGADOR;
}

// ─── Espacamento por host ─────────────────────────────────────────
const ultimaRequisicaoPorHost = new Map();

async function respeitarEspacamento(url) {
  const host = hostDe(url);
  const dominioBase = host.split(".").slice(-2).join(".");
  const gap = ESPACO_POR_HOST_MS[dominioBase] || ESPACO_POR_HOST_MS.padrao;
  const ultima = ultimaRequisicaoPorHost.get(dominioBase) || 0;
  const espera = ultima + gap - Date.now();
  if (espera > 0) await sleep(espera);
  ultimaRequisicaoPorHost.set(dominioBase, Date.now());
}

// ─── Orcamento diario ─────────────────────────────────────────────
function arquivoOrcamento() {
  return path.join(CACHE_DIR, `orcamento-${hoje()}.json`);
}

function tetoDe(fonte) {
  const env = process.env[`THAIS_TETO_${fonte.toUpperCase()}`];
  const teto = Number(env);
  if (Number.isFinite(teto) && teto >= 0) return teto;
  return TETOS_PADRAO[fonte] ?? 100;
}

/**
 * Tenta consumir 1 unidade do orcamento diario da fonte.
 * Retorna true se havia orcamento; false se o teto do dia estourou.
 */
function consumirOrcamento(fonte, unidades = 1) {
  const arq = arquivoOrcamento();
  const orc = lerJson(arq, {});
  const usado = Number(orc[fonte] || 0);
  const teto = tetoDe(fonte);
  if (usado + unidades > teto) return false;
  orc[fonte] = usado + unidades;
  gravarJson(arq, orc);
  return true;
}

function orcamentoRestante(fonte) {
  const orc = lerJson(arquivoOrcamento(), {});
  return Math.max(0, tetoDe(fonte) - Number(orc[fonte] || 0));
}

// ─── Memoria de falha por perfil ──────────────────────────────────
const ARQ_PERFIS_FALHA = path.join(CACHE_DIR, "perfis-falha.json");
const COOLDOWN_BASE_MS = 6 * 3600 * 1000;   // 6h por falha...
const COOLDOWN_MAX_MS = 48 * 3600 * 1000;   // ...ate no maximo 48h

/**
 * Perfil em cooldown? chave ex.: "instagram:@fulano", "twitter:@fulano".
 */
function perfilEmCooldown(chave) {
  const dados = lerJson(ARQ_PERFIS_FALHA, {});
  const registro = dados[chave];
  if (!registro) return false;
  const cooldown = Math.min(COOLDOWN_BASE_MS * registro.falhas, COOLDOWN_MAX_MS);
  return Date.now() - new Date(registro.ultimaFalha).getTime() < cooldown;
}

function registrarFalhaPerfil(chave, motivo) {
  const dados = lerJson(ARQ_PERFIS_FALHA, {});
  const registro = dados[chave] || { falhas: 0 };
  dados[chave] = {
    falhas: registro.falhas + 1,
    ultimaFalha: new Date().toISOString(),
    motivo: String(motivo || "").slice(0, 200),
  };
  gravarJson(ARQ_PERFIS_FALHA, dados);
}

function limparFalhaPerfil(chave) {
  const dados = lerJson(ARQ_PERFIS_FALHA, {});
  if (dados[chave]) {
    delete dados[chave];
    gravarJson(ARQ_PERFIS_FALHA, dados);
  }
}

// ─── Fetch com politica (sem cache) ───────────────────────────────
const MAX_TENTATIVAS_429 = 3;
const BACKOFF_PADRAO_MS = 2000;

async function fetchComPolitica(url, { timeoutMs = 15000, headers = {}, method = "GET", body } = {}) {
  await respeitarEspacamento(url);
  let res;
  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_429; tentativa += 1) {
    res = await fetch(url, {
      method,
      body,
      headers: { "User-Agent": userAgentPara(url), ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 429) break;
    if (tentativa === MAX_TENTATIVAS_429) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const esperaMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : BACKOFF_PADRAO_MS * tentativa;
    await sleep(esperaMs);
  }
  return res;
}

// ─── Fetch com cache em disco ─────────────────────────────────────
function caminhoCache(url, sufixo) {
  const hash = crypto.createHash("sha1").update(url).digest("hex");
  return path.join(HTTP_CACHE_DIR, `${hash}${sufixo}`);
}

/**
 * GET com cache em disco. tipo: "busca" | "imagem" | "pagina".
 * Retorna { deCache, status, buffer, contentType } ou null em falha de rede.
 * So cacheia respostas 200.
 */
async function fetchCache(url, { tipo = "busca", timeoutMs = 15000, headers = {} } = {}) {
  const ttl = TTL_PADRAO_MS[tipo] || TTL_PADRAO_MS.busca;
  const metaPath = caminhoCache(url, ".meta.json");
  const bodyPath = caminhoCache(url, ".bin");

  const meta = lerJson(metaPath, null);
  if (meta && Date.now() - new Date(meta.fetchedAt).getTime() < ttl && fs.existsSync(bodyPath)) {
    return {
      deCache: true,
      status: meta.status,
      contentType: meta.contentType,
      buffer: fs.readFileSync(bodyPath),
    };
  }

  let res;
  let contentType;
  let buffer;
  try {
    res = await fetchComPolitica(url, { timeoutMs, headers });
    contentType = res.headers.get("content-type") || "";
    buffer = Buffer.from(await res.arrayBuffer());
  } catch {
    // Rede falhou (na conexao ou no meio do corpo): se ha cache vencido,
    // melhor servir velho que nada.
    if (meta && fs.existsSync(bodyPath)) {
      return { deCache: true, vencido: true, status: meta.status, contentType: meta.contentType, buffer: fs.readFileSync(bodyPath) };
    }
    return null;
  }
  if (res.status === 200) {
    garantirDir(HTTP_CACHE_DIR);
    fs.writeFileSync(bodyPath, buffer);
    gravarJson(metaPath, { url, status: res.status, contentType, fetchedAt: new Date().toISOString(), tipo });
  }
  return { deCache: false, status: res.status, contentType, buffer };
}

/** Igual a fetchCache mas ja parseia JSON (ou retorna null). */
async function fetchJsonCache(url, opts = {}) {
  const res = await fetchCache(url, opts);
  if (!res || res.status !== 200) return null;
  try {
    return JSON.parse(res.buffer.toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = {
  carregarEnvLocal,
  UA_NAVEGADOR,
  UA_WIKIMEDIA,
  CACHE_DIR,
  isWikimediaHost,
  userAgentPara,
  hostDe,
  fetchComPolitica,
  fetchCache,
  fetchJsonCache,
  consumirOrcamento,
  orcamentoRestante,
  perfilEmCooldown,
  registrarFalhaPerfil,
  limparFalhaPerfil,
  lerJson,
  gravarJson,
};
