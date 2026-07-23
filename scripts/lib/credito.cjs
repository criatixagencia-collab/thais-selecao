/**
 * Extracao e normalizacao de credito de imagem.
 * Regra legal por tras (Lei 9.610/98): credito precisa identificar autor.
 */

const { fetchCache } = require("./http.cjs");

const ENTIDADES_HTML = {
  amp: "&", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", Aacute: "Á", agrave: "à", Agrave: "À", acirc: "â", Acirc: "Â",
  atilde: "ã", Atilde: "Ã", eacute: "é", Eacute: "É", ecirc: "ê", Ecirc: "Ê",
  iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", ocirc: "ô", Ocirc: "Ô",
  otilde: "õ", Otilde: "Õ", uacute: "ú", Uacute: "Ú", ccedil: "ç", Ccedil: "Ç",
};

function limparTextoHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => ENTIDADES_HTML[name] || full)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizarCredito(value) {
  const text = limparTextoHtml(value);
  if (!text) return "";
  if (/^(foto|cr[eé]dito|imagem)\s*:/i.test(text)) return text;
  return `Foto: ${text}`;
}

function escolherCredito(candidatos) {
  for (const candidato of candidatos) {
    const texto = normalizarCredito(candidato);
    if (!texto) continue;
    if (/^(foto|cr[eé]dito|imagem)\s*:\s*(facebook|instagram|x|linkedin|youtube)\b/i.test(texto)) continue;
    if (/caption\.chunk|min\.css|min\.js|role="img"|fetchpriority|srcset|class=|style=/i.test(texto)) continue;
    if (texto.length < 8 || texto.length > 140) continue;
    return texto;
  }
  return "";
}

function basenameFromUrl(value) {
  try {
    return new URL(value).pathname.split("/").pop() || "";
  } catch {
    return "";
  }
}

/**
 * Material de divulgacao/assessoria? (para a excecao da regra de mesma
 * fonte textual — ver REARQUITETURA-BRIEFING, bug 2 de 2026-07-23.)
 */
function ehDivulgacao(credito) {
  const texto = String(credito || "");
  return /divulga[cç][aã]o|press\s?kit|assessoria|material de imprensa|handout/i.test(texto);
}

async function extrairCreditoDaPagina(paginaUrl, imageUrl) {
  if (!/^https?:\/\//i.test(String(paginaUrl || ""))) return "";

  const res = await fetchCache(paginaUrl, { tipo: "pagina", timeoutMs: 15000 });
  if (!res || res.status !== 200) return "";
  const html = res.buffer.toString("utf8");
  const imageBase = basenameFromUrl(imageUrl);
  const recortes = [];

  if (imageBase) {
    let pos = html.indexOf(imageBase);
    while (pos >= 0 && recortes.length < 12) {
      recortes.push(html.slice(Math.max(0, pos - 2500), Math.min(html.length, pos + 2500)));
      pos = html.indexOf(imageBase, pos + imageBase.length);
    }
  }
  recortes.push(html);

  const padroes = [
    /(?:Foto|Cr[eé]dito|Credito|Imagem)\s*:\s*([^<"\n]{2,140})/gi,
    /<figcaption[^>]*>([\s\S]{0,220}?)<\/figcaption>/gi,
    /<[^>]+class=["'][^"']*(?:caption|credit|rights-holder)[^"']*["'][^>]*>([\s\S]{0,220}?)<\/[^>]+>/gi,
  ];

  let fallback = "";
  for (const recorte of recortes) {
    const candidatos = [];
    for (const padrao of padroes) {
      padrao.lastIndex = 0;
      let match;
      while ((match = padrao.exec(recorte))) {
        candidatos.push(match[1] || match[0]);
        if (candidatos.length >= 20) break;
      }
    }
    const credito = escolherCredito(candidatos);
    if (credito && /(copyrightHolder|figcaption|caption)/i.test(recorte)) return credito;
    if (credito && !fallback) fallback = credito;
  }
  return fallback;
}

module.exports = {
  limparTextoHtml,
  normalizarCredito,
  escolherCredito,
  ehDivulgacao,
  extrairCreditoDaPagina,
};
