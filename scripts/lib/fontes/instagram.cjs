/**
 * Instagram oficial via Apify — segunda prioridade do Regimento 03.
 *
 * So roda para handles DECLARADOS na materia (imagem.instagram, verificados
 * pela Thais na Etapa 2) ou mapeados em data/instagram-profiles.json.
 * Cada run do ator Apify e paga: passa por orcamento diario (apify_runs) e
 * por cooldown de perfil que falhou recentemente.
 *
 * Cada post encontrado gera DOIS candidatos:
 *  - download da imagem, status "usar com cautela" (nunca principal);
 *  - embed oficial do post (permalink), status "usar via embed" — caminho
 *    seguro quando nao ha licenca para publicar o arquivo.
 */

const { setTimeout: sleep } = require("timers/promises");
const {
  fetchComPolitica,
  consumirOrcamento,
  orcamentoRestante,
  perfilEmCooldown,
  registrarFalhaPerfil,
  limparFalhaPerfil,
} = require("../http.cjs");

function normalizarHandle(perfil) {
  return String(perfil || "").trim().replace(/^@/, "").toLowerCase();
}

function tokensApify() {
  return [
    process.env.APIFY_TOKEN_1,
    process.env.APIFY_TOKEN_2,
    process.env.APIFY_TOKEN_3,
    process.env.APIFY_TOKEN,
  ].filter((t) => t && t !== "***" && t !== "cole_o_token_aqui");
}

async function rodarAtorApify(perfil, token) {
  const postBody = JSON.stringify({
    addParentData: true,
    directUrls: [`https://www.instagram.com/${perfil}/`],
    resultsLimit: 6,
    resultsType: "posts",
  });

  const runRes = await fetchComPolitica(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${token}&waitForFinish=180`,
    { method: "POST", body: postBody, headers: { "Content-Type": "application/json" }, timeoutMs: 60000 },
  );
  if (!runRes.ok) return null;
  const runData = await runRes.json();
  const datasetId = runData?.data?.defaultDatasetId;
  if (!datasetId) return null;

  await sleep(5000);

  const itemsRes = await fetchComPolitica(
    `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json&limit=3`,
    { timeoutMs: 30000 },
  );
  if (!itemsRes.ok) return null;
  const items = await itemsRes.json();
  return Array.isArray(items) ? items : null;
}

function permalinkDe(post, perfil) {
  const direto = String(post?.url || "").trim();
  if (/^https?:\/\/(www\.)?instagram\.com\//i.test(direto)) return direto;
  const shortCode = String(post?.shortCode || post?.shortcode || "").trim();
  if (shortCode) return `https://www.instagram.com/p/${shortCode}/`;
  return `https://www.instagram.com/${perfil}/`;
}

/**
 * Busca posts do perfil oficial. Retorna { resultados, embeds, erro }.
 */
async function buscarInstagram(perfilBruto) {
  const perfil = normalizarHandle(perfilBruto);
  if (!perfil) return { resultados: [], embeds: [], erro: "" };

  const chaveCooldown = `instagram:@${perfil}`;
  if (perfilEmCooldown(chaveCooldown)) {
    return { resultados: [], embeds: [], erro: `@${perfil} em cooldown por falha recente` };
  }

  const tokens = tokensApify();
  if (!tokens.length) return { resultados: [], embeds: [], erro: "sem token Apify configurado" };
  if (orcamentoRestante("apify_runs") <= 0) {
    return { resultados: [], embeds: [], erro: "orcamento diario de runs Apify esgotado" };
  }

  const paginaPerfil = `https://www.instagram.com/${perfil}/`;
  let ultimoErro = "";

  for (const token of tokens) {
    if (!consumirOrcamento("apify_runs")) {
      return { resultados: [], embeds: [], erro: "orcamento diario de runs Apify esgotado" };
    }
    let items;
    try {
      items = await rodarAtorApify(perfil, token);
    } catch (error) {
      ultimoErro = error?.message || "falha na run Apify";
      continue;
    }
    if (!items) {
      ultimoErro = "run Apify sem dataset utilizavel";
      continue;
    }

    const posts = items.filter((p) => p.displayUrl).slice(0, 3);
    if (!posts.length) {
      ultimoErro = "perfil sem posts com imagem";
      continue;
    }

    limparFalhaPerfil(chaveCooldown);
    const resultados = posts.map((p) => ({
      urlOriginal: p.displayUrl,
      fonte: `Instagram @${perfil}`,
      credito: `Foto: Reprodução/Instagram/@${perfil}`,
      status: "usar com cautela",
      pagina: permalinkDe(p, perfil) || paginaPerfil,
      timestamp: p.takenAt || new Date().toISOString(),
    }));
    const embeds = posts.map((p) => ({
      type: "embed_instagram",
      embedUrl: permalinkDe(p, perfil),
      fonte: `Instagram @${perfil}`,
      credito: `Instagram/@${perfil}`,
      status: "usar via embed",
      pagina: paginaPerfil,
      legenda: String(p.caption || "").slice(0, 140),
    }));
    return { resultados, embeds, erro: "" };
  }

  registrarFalhaPerfil(chaveCooldown, ultimoErro);
  return { resultados: [], embeds: [], erro: ultimoErro || `falha ao buscar @${perfil}` };
}

module.exports = { buscarInstagram, normalizarHandle };
