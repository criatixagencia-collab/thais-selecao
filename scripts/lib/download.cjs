/**
 * Download de imagem com validacao de conteudo real (content-type + tamanho),
 * cache em disco e orcamento diario de downloads.
 */

const fs = require("fs");
const path = require("path");
const { fetchCache, consumirOrcamento } = require("./http.cjs");

function extensaoDe(contentType) {
  const ct = String(contentType || "").toLowerCase();
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

/**
 * Baixa (ou serve do cache) a imagem em url para pastaDestino/nomeBase.ext.
 * Retorna { srcLocal, bytes, deCache } ou null (nao-imagem, pequena demais,
 * erro de rede ou orcamento de downloads estourado).
 * srcLocal e relativo a rootRelativo quando informado (senao, so o nome).
 */
async function baixarImagem(url, pastaDestino, nomeBase, { rootRelativo = "" } = {}) {
  if (!/^https?:\/\//i.test(String(url || ""))) return null;
  if (!consumirOrcamento("downloads")) return null;

  const res = await fetchCache(url, { tipo: "imagem", timeoutMs: 15000 });
  if (!res || res.status !== 200) return null;
  if (!String(res.contentType).startsWith("image/")) return null;
  if (res.buffer.length < 1024) return null;

  const nomeBaseLimpo = String(nomeBase)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "imagem";
  const fileName = `${nomeBaseLimpo}${extensaoDe(res.contentType)}`;
  fs.mkdirSync(pastaDestino, { recursive: true });
  const filePath = path.join(pastaDestino, fileName);
  fs.writeFileSync(filePath, res.buffer);

  const srcLocal = rootRelativo
    ? path.join(rootRelativo, fileName).split(path.sep).join("/")
    : fileName;
  return { srcLocal, bytes: res.buffer.length, deCache: Boolean(res.deCache) };
}

module.exports = { baixarImagem };
