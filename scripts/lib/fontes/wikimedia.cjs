/**
 * Wikimedia Commons — fonte prioritaria (licenca aberta, Regimento 03).
 *
 * Uma unica requisicao por query: generator=search em namespace 6 (File:)
 * ja trazendo imageinfo com url e extmetadata. O codigo antigo fazia
 * 1 busca + 1 requisicao por resultado (ate 11 requisicoes por query) e
 * buscava fora do namespace de arquivos — por isso "Eagle-Eye Cherry"
 * retornava pagina de flores.
 */

const { fetchJsonCache, consumirOrcamento } = require("../http.cjs");
const { limparTextoHtml } = require("../credito.cjs");

const MIME_ACEITOS = new Set(["image/jpeg", "image/png", "image/webp"]);

function tokensRelevancia(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * O titulo do arquivo bate com a entidade buscada?
 * Exige pelo menos metade dos tokens da entidade presentes no titulo —
 * gate contra resultado fora de contexto.
 */
function tituloRelevante(tituloArquivo, entidade) {
  const tokensEntidade = tokensRelevancia(entidade);
  if (!tokensEntidade.length) return true;
  const tituloNorm = tokensRelevancia(tituloArquivo).join(" ");
  const presentes = tokensEntidade.filter((t) => tituloNorm.includes(t)).length;
  return presentes >= Math.ceil(tokensEntidade.length / 2);
}

/**
 * Busca imagens no Commons para uma entidade (pessoa/obra/evento).
 * Retorna candidatas { urlOriginal, fonte, credito, status, pagina, largura, altura }.
 */
async function buscarWikimedia(entidade, { limite = 4 } = {}) {
  if (!String(entidade || "").trim()) return [];
  if (!consumirOrcamento("wikimedia_api")) return [];

  const url = "https://commons.wikimedia.org/w/api.php?action=query" +
    `&generator=search&gsrsearch=${encodeURIComponent(entidade)}` +
    "&gsrnamespace=6&gsrlimit=10" +
    "&prop=imageinfo&iiprop=url|extmetadata|mime|size&format=json";

  const data = await fetchJsonCache(url, { tipo: "busca", timeoutMs: 12000 });
  const pages = Object.values(data?.query?.pages || {});
  const results = [];

  for (const page of pages) {
    if (results.length >= limite) break;
    const info = page?.imageinfo?.[0];
    if (!info?.url) continue;
    if (info.mime && !MIME_ACEITOS.has(info.mime)) continue;
    if ((info.width || 0) < 400 || (info.height || 0) < 300) continue;
    if (!tituloRelevante(page.title, entidade)) continue;

    const meta = info.extmetadata || {};
    const autor = limparTextoHtml(meta.Artist?.value || "");
    const licenca = limparTextoHtml(meta.LicenseShortName?.value || "");
    const partesCredito = [autor, licenca].filter(Boolean).join(" / ");

    results.push({
      urlOriginal: info.url,
      fonte: "Wikimedia Commons",
      credito: partesCredito ? `Foto: ${partesCredito}` : "Foto: Wikimedia Commons",
      // Licenciada exige licenca E autor nomeados; na duvida, rebaixar.
      status: autor && licenca ? "licenciada" : "usar com cautela",
      pagina: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title || "")}`,
      largura: info.width || 0,
      altura: info.height || 0,
    });
  }
  return results;
}

module.exports = { buscarWikimedia, tituloRelevante };
