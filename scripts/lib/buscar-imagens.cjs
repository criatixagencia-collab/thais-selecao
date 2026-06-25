const fs = require("fs");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");

const ROOT = path.resolve(__dirname, "../..");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

function carregarEnvLocal() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function hostnameSemWww(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

carregarEnvLocal();

// ─── Instagram via Apify ───────────────────────────────────────────
async function buscarInstagram(nome, perfis) {
  const texto = nome.toLowerCase().trim();
  const chave = Object.keys(perfis).find((k) => texto.includes(k));
  const perfil = chave ? perfis[chave] : "";
  if (!perfil || !perfil.trim()) return [];

  const tokens = [
    process.env.APIFY_TOKEN_1,
    process.env.APIFY_TOKEN_2,
    process.env.APIFY_TOKEN_3,
    process.env.APIFY_TOKEN,
  ].filter(t => t && t !== "***" && t !== "cole_o_token_aqui");

  if (tokens.length === 0) return [];

  for (const token of tokens) {
    try {
      const postBody = JSON.stringify({
      addParentData: true,
      directUrls: [`https://www.instagram.com/${perfil}/`],
      resultsLimit: 6,
      resultsType: "posts",
    });

    const runRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${token}&waitForFinish=180`,
      { method: "POST", body: postBody, headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000) }
    );
    if (!runRes.ok) continue;
    const runData = await runRes.json();
    const datasetId = runData?.data?.defaultDatasetId;
    if (!datasetId) continue;

    await sleep(5000);

    const itemsRes = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&clean=true&format=json&limit=3`,
      { signal: AbortSignal.timeout(30000) }
    );
    if (!itemsRes.ok) continue;
    const items = await itemsRes.json();
    if (!Array.isArray(items)) continue;

    const resultados = items.filter(p => p.displayUrl).slice(0, 3).map(p => ({
      urlOriginal: p.displayUrl,
      fonte: `Instagram @${perfil}`,
      credito: `Foto: Reprodução/Instagram/@${perfil}`,
      status: "usar com cautela",
      pagina: `https://www.instagram.com/${perfil}/`,
      timestamp: p.takenAt || new Date().toISOString(),
    }));
    
    if (resultados.length > 0) return resultados;
    continue;
  } catch {
    continue;
  }
  }

  return [];
}

// ─── DuckDuckGo Images ────────────────────────────────────────────
async function buscarDuckDuckGo(query) {
  const results = [];
  try {
    const htmlRes = await fetch(
      `https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }
    );
    if (!htmlRes.ok) return [];
    const html = await htmlRes.text();
    const vqd = html.match(/vqd=["']?([^"'&]+)["']?/)?.[1];
    if (!vqd) return [];

    const jsonRes = await fetch(
      `https://duckduckgo.com/i.js?l=br-pt&o=json&q=${encodeURIComponent(query)}&vqd=${vqd}&f=,,,&p=1`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }
    );
    if (!jsonRes.ok) return [];
    const data = await jsonRes.json();
    if (!Array.isArray(data.results)) return [];

    for (const r of data.results) {
      if (results.length >= 4) break;
      const w = r.width || 0;
      const h = r.height || 0;
      if (w < 300 || h < 180) continue;
      if (!r.image) continue;
      try {
        const dominio = new URL(r.url || r.image).hostname;
        results.push({
          urlOriginal: r.image,
          fonte: `DuckDuckGo - ${dominio}`,
          credito: `Foto: arquivo (${dominio})`,
          status: "usar com cautela",
          pagina: r.url || "",
          largura: w,
          altura: h,
        });
      } catch { /* skip */ }
    }
    return results;
  } catch {
    return [];
  }
}

// ─── Wikimedia Commons API ────────────────────────────────────────
async function buscarWikimedia(query) {
  const results = [];
  try {
    const searchRes = await fetch(
      `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=10`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const pages = searchData?.query?.search || [];
    if (!pages.length) return [];

    for (const page of pages) {
      if (results.length >= 2) break;
      const infoRes = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(page.title)}&prop=imageinfo&iiprop=url|extmetadata&format=json`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(10000) }
      );
      if (!infoRes.ok) continue;
      const infoData = await infoRes.json();
      const imgPages = infoData?.query?.pages || {};
      for (const id of Object.keys(imgPages)) {
        const imgInfo = imgPages[id]?.imageinfo?.[0];
        if (!imgInfo?.url) continue;
        const autor = imgInfo.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, "") || "";
        results.push({
          urlOriginal: imgInfo.url,
          fonte: "Wikimedia Commons",
          credito: autor ? `Foto: Wikimedia Commons / ${autor}` : "Foto: Wikimedia Commons",
          status: "segura para uso",
          pagina: `https://commons.wikimedia.org${imgPages[id].title ? "/wiki/" + encodeURIComponent(imgPages[id].title) : ""}`,
          largura: imgInfo.width || 0,
          altura: imgInfo.height || 0,
        });
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ─── Bloquear mesma fonte ─────────────────────────────────────────
function bloquearFonteOriginal(artigo, urlImagem) {
  const dominiosBloqueados = new Set();
  const fontes = [
    ...(Array.isArray(artigo.fontes) ? artigo.fontes : []),
    ...(Array.isArray(artigo.sources) ? artigo.sources : []),
    ...(Array.isArray(artigo.evidenceSources) ? artigo.evidenceSources : []),
    ...(Array.isArray(artigo.evidencia) ? artigo.evidencia : []),
  ];
  for (const f of fontes) {
    if (typeof f === "string" && f.startsWith("http")) {
      const dominio = hostnameSemWww(f);
      if (dominio) dominiosBloqueados.add(dominio);
    }
    if (typeof f?.url === "string" && f.url.startsWith("http")) {
      const dominio = hostnameSemWww(f.url);
      if (dominio) dominiosBloqueados.add(dominio);
    }
  }
  if (!dominiosBloqueados.size) return false;

  const dominioImagem = hostnameSemWww(urlImagem);
  if (!dominioImagem) return false;

  return [...dominiosBloqueados].some((dominioFonte) => (
    dominioImagem === dominioFonte ||
    dominioImagem.endsWith(`.${dominioFonte}`) ||
    dominioFonte.endsWith(`.${dominioImagem}`)
  ));
}

// ─── Baixar imagem local ──────────────────────────────────────────
async function baixarImagem(url, pastaDestino, nomeBase) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 1024) return null;

    let ext = ".jpg";
    if (ct.includes("png")) ext = ".png";
    else if (ct.includes("webp")) ext = ".webp";
    else if (ct.includes("gif")) ext = ".gif";

    const nomeBaseLimpo = nomeBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
    const fileName = `${nomeBaseLimpo}${ext}`;
    const filePath = path.join(pastaDestino, fileName);
    fs.writeFileSync(filePath, buffer);

    const pastaRelativa = path.basename(path.dirname(pastaDestino));
    return {
      srcLocal: `${pastaRelativa}/imagens/${fileName}`,
      bytes: buffer.length,
    };
  } catch {
    return null;
  }
}

// ─── Orquestrador ─────────────────────────────────────────────────
async function buscarMultiOpcoes(artigo) {
  const nome = artigo.title || artigo.tit || "";
  const query = `${nome} foto arquivo`;

  let perfis = {};
  try {
    perfis = JSON.parse(fs.readFileSync(path.join(ROOT, "data/instagram-profiles.json"), "utf8"));
  } catch { perfis = {}; }

  const [instaRes, ddgRes, wikiRes] = await Promise.allSettled([
    buscarInstagram(nome, perfis),
    buscarDuckDuckGo(query),
    buscarWikimedia(nome),
  ]);

  let resultados = [
    ...(instaRes.status === "fulfilled" ? instaRes.value : []),
    ...(ddgRes.status === "fulfilled" ? ddgRes.value : []),
    ...(wikiRes.status === "fulfilled" ? wikiRes.value : []),
  ];

  // Remover duplicatas por URL
  const seen = new Set();
  resultados = resultados.filter(r => {
    if (!r.urlOriginal || seen.has(r.urlOriginal)) return false;
    seen.add(r.urlOriginal);
    return true;
  });

  // Bloquear mesma fonte original
  resultados = resultados.filter(r => !bloquearFonteOriginal(artigo, r.urlOriginal));

  // Limitar por fonte
  const insta = resultados.filter(r => r.fonte.startsWith("Instagram")).slice(0, 3);
  const ddg = resultados.filter(r => r.fonte.startsWith("DuckDuckGo")).slice(0, 4);
  const wiki = resultados.filter(r => r.fonte.startsWith("Wikimedia")).slice(0, 2);

  // Misturar
  const misturado = [];
  const maxLen = Math.max(insta.length, ddg.length, wiki.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < insta.length) misturado.push(insta[i]);
    if (i < ddg.length) misturado.push(ddg[i]);
    if (i < wiki.length) misturado.push(wiki[i]);
  }

  return misturado.slice(0, 9);
}

module.exports = { buscarMultiOpcoes, baixarImagem };
