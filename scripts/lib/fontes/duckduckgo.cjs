/**
 * DuckDuckGo Images — ULTIMO recurso pelo Regimento 03.
 *
 * Regras desta fonte:
 *  - so roda quando as fontes prioritarias nao atingiram o minimo;
 *  - resultado sem credito extraivel da pagina de origem e DESCARTADO aqui
 *    (o validador barraria "Credito nao confirmado" de qualquer forma —
 *    melhor nem gastar download);
 *  - gate de relevancia: o titulo da pagina de origem precisa bater com a
 *    entidade buscada.
 */

const { fetchCache, consumirOrcamento } = require("../http.cjs");
const { extrairCreditoDaPagina } = require("../credito.cjs");
const { tituloRelevante } = require("./wikimedia.cjs");

async function buscarDuckDuckGo(query, { entidadeRelevancia = "", limite = 4 } = {}) {
  if (!String(query || "").trim()) return [];
  if (!consumirOrcamento("ddg_buscas")) return [];

  const htmlRes = await fetchCache(
    `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
    { tipo: "busca", timeoutMs: 10000 },
  );
  if (!htmlRes || htmlRes.status !== 200) return [];
  const vqd = htmlRes.buffer.toString("utf8").match(/vqd=["']?([^"'&]+)["']?/)?.[1];
  if (!vqd) return [];

  const jsonRes = await fetchCache(
    `https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
    { tipo: "busca", timeoutMs: 10000 },
  );
  if (!jsonRes || jsonRes.status !== 200) return [];
  let data;
  try {
    data = JSON.parse(jsonRes.buffer.toString("utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(data.results)) return [];

  const results = [];
  for (const r of data.results) {
    if (results.length >= limite) break;
    const w = r.width || 0;
    const h = r.height || 0;
    if (w < 300 || h < 180 || !r.image) continue;
    if (entidadeRelevancia && !tituloRelevante(`${r.title || ""} ${r.url || ""}`, entidadeRelevancia)) continue;
    let dominio;
    try {
      dominio = new URL(r.url || r.image).hostname;
    } catch {
      continue;
    }
    const pagina = r.url || "";
    const creditoReal = await extrairCreditoDaPagina(pagina, r.image);
    if (!creditoReal) continue; // sem credito identificavel, nem entra
    results.push({
      urlOriginal: r.image,
      fonte: `DuckDuckGo - ${dominio}`,
      credito: creditoReal,
      status: "usar com cautela",
      pagina,
      largura: w,
      altura: h,
    });
  }
  return results;
}

module.exports = { buscarDuckDuckGo };
