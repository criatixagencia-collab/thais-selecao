/**
 * Orquestrador da Etapa 3 — busca de imagens por materia.
 *
 * Ordem de prioridade do Regimento 03 (seguranca juridica, nao conveniencia):
 *   1. Wikimedia Commons / licenca aberta
 *   2. Instagram oficial via Apify (handles declarados pela Thais)
 *   3. X/Twitter oficial
 *   4. DuckDuckGo — ULTIMO recurso, so se faltar para o minimo
 *
 * A busca e guiada pelo bloco `imagem` que a Thais preenche na Etapa 2:
 *   "imagem": {
 *     "tipo": "pessoa" | "obra" | "evento" | "grupo",
 *     "entidades": ["Kevin Sussman", "Stuart Nao Consegue Salvar o Universo"],
 *     "instagram": ["@perfil_oficial"],
 *     "twitter": ["@perfil"],
 *     "plataformaOficial": "HBO Max"
 *   }
 * Buscar pela ENTIDADE verificada (e nao pelo titulo da materia) e o que
 * evita imagem fora de contexto (bug Big Bang Theory / Hemerocallis).
 * Sem o bloco, cai no comportamento legado (titulo + mapas de perfil por
 * substring) e registra pendencia.
 */

const fs = require("fs");
const path = require("path");
const { hostDe } = require("./http.cjs");
const { ehDivulgacao } = require("./credito.cjs");
const { buscarWikimedia } = require("./fontes/wikimedia.cjs");
const { buscarInstagram, normalizarHandle } = require("./fontes/instagram.cjs");
const { buscarTwitter } = require("./fontes/twitter.cjs");
const { buscarDuckDuckGo } = require("./fontes/duckduckgo.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ALVO_PADRAO = Number(process.env.THAIS_ALVO_IMAGENS || 6);
const MINIMO_PADRAO = Number(process.env.THAIS_MIN_IMAGES || 3);
const MAX_CANDIDATAS = 9;

function lerMapa(nomeArquivo) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, "data", nomeArquivo), "utf8"));
  } catch {
    return {};
  }
}

// Legado: casar nome da pauta contra chaves do mapa por substring.
function perfisPorSubstring(nome, mapa) {
  const texto = String(nome || "").toLowerCase().trim();
  return Object.keys(mapa)
    .map((chave) => ({ chave, perfil: String(mapa[chave] || "").trim(), index: texto.indexOf(chave) }))
    .filter((item) => item.perfil && item.index >= 0)
    .sort((a, b) => (a.index - b.index) || (b.chave.length - a.chave.length))
    .map((item) => item.perfil)
    .filter((perfil, i, arr) => arr.indexOf(perfil) === i);
}

function planoVisual(artigo) {
  const titulo = artigo.title || artigo.tit || "";
  const bloco = artigo.imagem && typeof artigo.imagem === "object" ? artigo.imagem : null;
  const plano = {
    declarado: Boolean(bloco && Array.isArray(bloco.entidades) && bloco.entidades.length),
    titulo,
    tipo: bloco?.tipo || "",
    entidades: (bloco?.entidades || []).map((e) => String(e).trim()).filter(Boolean).slice(0, 4),
    instagram: (bloco?.instagram || []).map(normalizarHandle).filter(Boolean).slice(0, 2),
    twitter: (bloco?.twitter || []).map(normalizarHandle).filter(Boolean).slice(0, 2),
    plataformaOficial: String(bloco?.plataformaOficial || "").trim(),
  };
  if (!plano.entidades.length) plano.entidades = [titulo];
  return plano;
}

function dominiosDasFontes(artigo) {
  const dominios = new Set();
  const fontes = [
    ...(Array.isArray(artigo.fontes) ? artigo.fontes : []),
    ...(Array.isArray(artigo.sources) ? artigo.sources : []),
    ...(Array.isArray(artigo.evidenceSources) ? artigo.evidenceSources : []),
    ...(Array.isArray(artigo.evidencia) ? artigo.evidencia : []),
  ];
  for (const f of fontes) {
    const url = typeof f === "string" ? f : f?.url;
    if (typeof url === "string" && url.startsWith("http")) {
      const dominio = hostDe(url);
      if (dominio) dominios.add(dominio);
    }
  }
  return dominios;
}

function mesmoDominio(dominioImagem, dominios) {
  if (!dominioImagem) return false;
  return [...dominios].some((d) => (
    dominioImagem === d || dominioImagem.endsWith(`.${d}`) || d.endsWith(`.${dominioImagem}`)
  ));
}

/**
 * Regra "imagem nao sai da mesma pagina da fonte textual", com a excecao
 * de Divulgacao (REARQUITETURA-BRIEFING, bug 2): material de divulgacao
 * hospedado na fonte textual NAO e descartado — entra marcado com
 * pendencia de conferir fonte alternativa oficial.
 */
function aplicarBloqueioFonteOriginal(candidatas, artigo) {
  const dominios = dominiosDasFontes(artigo);
  if (!dominios.size) return candidatas;
  const aceitas = [];
  for (const c of candidatas) {
    const bate = mesmoDominio(hostDe(c.urlOriginal), dominios) || mesmoDominio(hostDe(c.pagina), dominios);
    if (!bate) {
      aceitas.push(c);
    } else if (ehDivulgacao(c.credito)) {
      aceitas.push({
        ...c,
        observacao: "Divulgacao hospedada na fonte textual da materia; conferir fonte alternativa oficial (site/newsroom da plataforma) antes de usar como principal.",
      });
    }
    // caso contrario: descartada (regra padrao do Regimento)
  }
  return aceitas;
}

function dedupe(candidatas) {
  const seen = new Set();
  return candidatas.filter((c) => {
    const chave = c.urlOriginal || c.embedUrl;
    if (!chave || seen.has(chave)) return false;
    seen.add(chave);
    return true;
  });
}

function intercalar(grupos) {
  const resultado = [];
  const maxLen = Math.max(0, ...grupos.map((g) => g.length));
  for (let i = 0; i < maxLen; i += 1) {
    for (const grupo of grupos) {
      if (i < grupo.length) resultado.push(grupo[i]);
    }
  }
  return resultado;
}

/**
 * Busca candidatas de imagem para a materia seguindo a escada do Regimento.
 * Retorna { opcoes, embeds, pendencias } — nunca lanca por falta de imagem;
 * falta vira pendencia para a Thais reportar ao Rafael.
 */
async function buscarMultiOpcoes(artigo, { alvo = ALVO_PADRAO, minimo = MINIMO_PADRAO } = {}) {
  const plano = planoVisual(artigo);
  const pendencias = [];
  if (!plano.declarado) {
    pendencias.push("materia sem bloco `imagem` (entidades/handles) da Etapa 2; busca caiu no modo legado por titulo");
  }

  // Nenhuma fonte pode derrubar a materia inteira: falha vira pendencia.
  async function tentar(nomeFonte, fn) {
    try {
      return await fn();
    } catch (error) {
      pendencias.push(`${nomeFonte}: ${error?.message || "falha inesperada"}`);
      return null;
    }
  }

  // 1. Wikimedia Commons — sempre, uma query por entidade.
  const wiki = [];
  for (const entidade of plano.entidades) {
    const r = await tentar(`Wikimedia "${entidade}"`, () => buscarWikimedia(entidade, { limite: 4 }));
    if (r) wiki.push(...r);
    if (wiki.length >= alvo) break;
  }

  // 2. Instagram oficial: handles declarados sempre tentados (sujeito a
  //    orcamento/cooldown); handles do mapa legado so se faltar pro minimo.
  const instaHandles = plano.instagram.length
    ? plano.instagram
    : (wiki.length < minimo ? perfisPorSubstring(plano.titulo, lerMapa("instagram-profiles.json")).slice(0, 1) : []);
  const insta = [];
  const embeds = [];
  for (const handle of instaHandles) {
    const r = await tentar(`Instagram @${handle}`, () => buscarInstagram(handle));
    if (!r) continue;
    insta.push(...r.resultados);
    embeds.push(...r.embeds);
    if (r.erro) pendencias.push(`Instagram @${handle}: ${r.erro}`);
  }

  // 3. X/Twitter: mesma logica.
  const twitterHandles = plano.twitter.length
    ? plano.twitter
    : ((wiki.length + insta.length) < minimo ? perfisPorSubstring(plano.titulo, lerMapa("twitter-profiles.json")).slice(0, 1) : []);
  const twitter = [];
  for (const handle of twitterHandles) {
    const r = await tentar(`X/Twitter @${handle}`, () => buscarTwitter(handle));
    if (!r) continue;
    twitter.push(...r.resultados);
    if (r.erro) pendencias.push(`X/Twitter @${handle}: ${r.erro}`);
  }

  // 4. DuckDuckGo — ultimo recurso, so se ainda faltar pro minimo.
  const ddg = [];
  if (wiki.length + insta.length + twitter.length < minimo) {
    const entidadePrincipal = plano.entidades[0] || plano.titulo;
    const query = plano.plataformaOficial
      ? `${entidadePrincipal} ${plano.plataformaOficial} divulgação foto`
      : `${entidadePrincipal} foto`;
    const r = await tentar("DuckDuckGo", () => buscarDuckDuckGo(query, { entidadeRelevancia: entidadePrincipal, limite: 4 }));
    if (r) ddg.push(...r);
  }

  let opcoes = dedupe(intercalar([wiki.slice(0, 4), insta.slice(0, 3), twitter.slice(0, 2), ddg.slice(0, 4)]));
  opcoes = aplicarBloqueioFonteOriginal(opcoes, artigo).slice(0, MAX_CANDIDATAS);

  if (opcoes.length < minimo) {
    pendencias.push(`apenas ${opcoes.length} candidata(s) de imagem encontrada(s); minimo operacional e ${minimo}`);
  }

  return { opcoes, embeds: dedupe(embeds).slice(0, 3), pendencias };
}

module.exports = { buscarMultiOpcoes, planoVisual };
