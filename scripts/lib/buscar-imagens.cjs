const fs = require("fs");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");

const ROOT = path.resolve(__dirname, "../..");
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
// Wikimedia exige User-Agent identificado (https://meta.wikimedia.org/wiki/User-Agent_policy);
// UAs de navegador levam throttling mais agressivo. Usado só para hosts *.wikimedia.org.
const UA_WIKIMEDIA = "ThaisSelecaoBot/1.0 (uso editorial - selecao de imagens para materias; contato: criatixagencia@gmail.com)";

function isWikimediaHost(url) {
  try {
    const host = new URL(url).hostname;
    return host === "wikimedia.org" || host.endsWith(".wikimedia.org");
  } catch {
    return false;
  }
}
const execFileAsync = promisify(execFile);

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

function limparTextoHtml(value) {
  const entidades = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    aacute: "á",
    Aacute: "Á",
    agrave: "à",
    Agrave: "À",
    acirc: "â",
    Acirc: "Â",
    atilde: "ã",
    Atilde: "Ã",
    eacute: "é",
    Eacute: "É",
    ecirc: "ê",
    Ecirc: "Ê",
    iacute: "í",
    Iacute: "Í",
    oacute: "ó",
    Oacute: "Ó",
    ocirc: "ô",
    Ocirc: "Ô",
    otilde: "õ",
    Otilde: "Õ",
    uacute: "ú",
    Uacute: "Ú",
    ccedil: "ç",
    Ccedil: "Ç",
  };
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (full, name) => entidades[name] || full)
    .replace(/\s+/g, " ")
    .trim();
}

function basenameFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").pop() || "";
  } catch {
    return "";
  }
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
    if (/caption\.chunk|min\.css|min\.js|role=\"img\"|fetchpriority|srcset|class=|style=/i.test(texto)) continue;
    if (texto.length < 8 || texto.length > 140) continue;
    return texto;
  }
  return "";
}

async function extrairCreditoDaPagina(paginaUrl, imageUrl) {
  if (!/^https?:\/\//i.test(String(paginaUrl || ""))) return "";

  try {
    const res = await fetch(paginaUrl, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return "";
    const html = await res.text();
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

    for (const recorte of recortes) {
      const candidatos = [];
      for (const padrao of padroes) {
        let match;
        while ((match = padrao.exec(recorte))) {
          candidatos.push(match[1] || match[0]);
          if (candidatos.length >= 20) break;
        }
      }
      const credito = escolherCredito(candidatos);
      if (credito && /(copyrightHolder|figcaption|caption)/i.test(recorte)) return credito;
      if (credito && !recortes._fallback) recortes._fallback = credito;
    }
    if (recortes._fallback) return recortes._fallback;
  } catch {
    return "";
  }

  return "";
}

carregarEnvLocal();

const INSTAGRAM_PROFILE_TIMEOUT_MS = Number(process.env.THAIS_INSTAGRAM_PROFILE_TIMEOUT_MS || 45000);
const OPENCLI_TIMEOUT_MS = Number(process.env.THAIS_OPENCLI_TIMEOUT_MS || 25000);
const TWITTER_TIMEOUT_MS = Number(process.env.THAIS_TWITTER_TIMEOUT_MS || 25000);

// ─── Instagram via OpenCLI + Apify ─────────────────────────────────
function resolverPerfisInstagram(nome, perfis) {
  const texto = String(nome || "").toLowerCase().trim();
  const matches = Object.keys(perfis)
    .map((chave) => ({
      chave,
      perfil: String(perfis[chave] || "").trim(),
      index: texto.indexOf(chave),
    }))
    .filter((item) => item.perfil && item.index >= 0)
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return b.chave.length - a.chave.length;
    });

  const perfisOrdenados = [];
  for (const item of matches) {
    if (!perfisOrdenados.includes(item.perfil)) perfisOrdenados.push(item.perfil);
  }

  return {
    orderedProfiles: perfisOrdenados,
    requiredProfiles: perfisOrdenados.slice(0, 1),
  };
}

function resolverPerfisTwitter(nome, perfis) {
  const texto = String(nome || "").toLowerCase().trim();
  const matches = Object.keys(perfis)
    .map((chave) => ({
      chave,
      perfil: String(perfis[chave] || "").trim(),
      index: texto.indexOf(chave),
    }))
    .filter((item) => item.perfil && item.index >= 0)
    .sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return b.chave.length - a.chave.length;
    });

  const perfisOrdenados = [];
  for (const item of matches) {
    if (!perfisOrdenados.includes(item.perfil)) perfisOrdenados.push(item.perfil);
  }

  return {
    orderedProfiles: perfisOrdenados,
  };
}

async function validarPerfilInstagramOpenCli(perfil) {
  if (!perfil || !perfil.trim()) return null;

  try {
    const { stdout } = await execFileAsync(
      "opencli",
      ["instagram", "profile", perfil, "-f", "json"],
      {
        cwd: ROOT,
        timeout: OPENCLI_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      }
    );
    const parsed = JSON.parse(String(stdout || "").trim() || "[]");
    const profile = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!profile || !profile.username) return null;
    return {
      username: String(profile.username || "").trim(),
      url: String(profile.url || "").trim(),
      name: String(profile.name || "").trim(),
      verified: String(profile.verified || "").trim(),
    };
  } catch {
    return null;
  }
}

async function buscarInstagram(perfil) {
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

async function buscarInstagramPerfilFallback(perfil) {
  if (!perfil || !perfil.trim()) return [];
  try {
    const res = await fetch(`https://www.instagram.com/${perfil}/`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const ogImage = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1] || "";
    if (!ogImage) return [];
    return [{
      urlOriginal: ogImage.replace(/&amp;/g, "&"),
      fonte: `Instagram @${perfil}`,
      credito: `Foto: Reprodução/Instagram/@${perfil}`,
      status: "usar com cautela",
      pagina: `https://www.instagram.com/${perfil}/`,
      timestamp: new Date().toISOString(),
    }];
  } catch {
    return [];
  }
}

async function buscarInstagramComLimite(perfil) {
  const perfilValidado = await validarPerfilInstagramOpenCli(perfil);
  const paginaOficial = perfilValidado?.url || `https://www.instagram.com/${perfil}/`;

  try {
    const resultado = await Promise.race([
      buscarInstagram(perfil),
      (async () => {
        await sleep(INSTAGRAM_PROFILE_TIMEOUT_MS);
        throw new Error(`timeout ao buscar Instagram @${perfil}`);
      })(),
    ]);
    const resultados = (Array.isArray(resultado) ? resultado : []).map((item) => ({
      ...item,
      pagina: item.pagina || paginaOficial,
    }));
    if (resultados.length > 0) return { perfil, resultados, erro: "" };
    const fallback = (await buscarInstagramPerfilFallback(perfil)).map((item) => ({
      ...item,
      pagina: item.pagina || paginaOficial,
    }));
    const erro = perfilValidado
      ? "Instagram sem posts utilizaveis e sem fallback de perfil"
      : "perfil nao validado via OpenCLI e sem fallback de perfil";
    return { perfil, resultados: fallback, erro: fallback.length ? "" : erro };
  } catch (error) {
    const fallback = (await buscarInstagramPerfilFallback(perfil)).map((item) => ({
      ...item,
      pagina: item.pagina || paginaOficial,
    }));
    const baseError = error?.message || `falha ao buscar Instagram @${perfil}`;
    const erro = perfilValidado ? baseError : `perfil nao validado via OpenCLI; ${baseError}`;
    return {
      perfil,
      resultados: fallback,
      erro: fallback.length ? "" : erro,
    };
  }
}

async function validarPerfilTwitterCli(perfil) {
  if (!perfil || !perfil.trim()) return null;

  try {
    const { stdout } = await execFileAsync(
      "twitter",
      ["user", perfil, "--json"],
      {
        cwd: ROOT,
        timeout: TWITTER_TIMEOUT_MS,
        maxBuffer: 1024 * 1024,
      }
    );
    const parsed = JSON.parse(String(stdout || "").trim() || "{}");
    if (!parsed?.ok || !parsed?.data?.screenName) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function twitterMediaToResultados(perfil, tweets) {
  const resultados = [];
  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    const media = Array.isArray(tweet?.media) ? tweet.media : [];
    for (const item of media) {
      const mediaUrl = String(item?.url || "").trim();
      if (!mediaUrl) continue;
      if (String(item?.type || "").toLowerCase() !== "photo") continue;
      resultados.push({
        urlOriginal: mediaUrl,
        fonte: `X/Twitter @${perfil}`,
        credito: `Foto: Reprodução/X/@${perfil}`,
        status: "usar com cautela",
        pagina: tweet?.id ? `https://x.com/${perfil}/status/${tweet.id}` : `https://x.com/${perfil}`,
        timestamp: tweet?.createdAtISO || new Date().toISOString(),
      });
      if (resultados.length >= 3) return resultados;
    }
  }
  return resultados;
}

async function buscarTwitterOficial(perfil) {
  const profile = await validarPerfilTwitterCli(perfil);
  if (!profile) return { perfil, resultados: [], erro: `perfil nao validado via twitter-cli: @${perfil}` };

  try {
    const { stdout } = await execFileAsync(
      "twitter",
      ["user-posts", perfil, "-n", "6", "--json"],
      {
        cwd: ROOT,
        timeout: TWITTER_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
      }
    );
    const parsed = JSON.parse(String(stdout || "").trim() || "{}");
    const tweets = Array.isArray(parsed?.data) ? parsed.data : [];
    const resultados = twitterMediaToResultados(perfil, tweets);
    if (resultados.length > 0) return { perfil, resultados, erro: "" };

    const profileImageUrl = String(profile.profileImageUrl || "").trim();
    if (profileImageUrl) {
      return {
        perfil,
        resultados: [{
          urlOriginal: profileImageUrl,
          fonte: `X/Twitter @${perfil}`,
          credito: `Foto: Reprodução/X/@${perfil}`,
          status: "usar com cautela",
          pagina: `https://x.com/${perfil}`,
          timestamp: new Date().toISOString(),
        }],
        erro: "",
      };
    }

    return { perfil, resultados: [], erro: `X/Twitter sem media de imagem utilizavel: @${perfil}` };
  } catch (error) {
    const profileImageUrl = String(profile.profileImageUrl || "").trim();
    if (profileImageUrl) {
      return {
        perfil,
        resultados: [{
          urlOriginal: profileImageUrl,
          fonte: `X/Twitter @${perfil}`,
          credito: `Foto: Reprodução/X/@${perfil}`,
          status: "usar com cautela",
          pagina: `https://x.com/${perfil}`,
          timestamp: new Date().toISOString(),
        }],
        erro: "",
      };
    }
    return {
      perfil,
      resultados: [],
      erro: error?.message || `falha ao buscar X/Twitter @${perfil}`,
    };
  }
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
        const pagina = r.url || "";
        const creditoReal = await extrairCreditoDaPagina(pagina, r.image);
        results.push({
          urlOriginal: r.image,
          fonte: `DuckDuckGo - ${dominio}`,
          credito: creditoReal || `Credito nao confirmado - revisar pagina de origem (${dominio})`,
          status: "usar com cautela",
          pagina,
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
      { headers: { "User-Agent": UA_WIKIMEDIA }, signal: AbortSignal.timeout(10000) }
    );
    if (!searchRes.ok) return [];
    const searchData = await searchRes.json();
    const pages = searchData?.query?.search || [];
    if (!pages.length) return [];

    for (const page of pages) {
      if (results.length >= 2) break;
      const infoRes = await fetch(
        `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(page.title)}&prop=imageinfo&iiprop=url|extmetadata&format=json`,
        { headers: { "User-Agent": UA_WIKIMEDIA }, signal: AbortSignal.timeout(10000) }
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
  const userAgent = isWikimediaHost(url) ? UA_WIKIMEDIA : UA;
  const MAX_TENTATIVAS_429 = 3;
  const BACKOFF_PADRAO_MS = 2000;

  try {
    let res;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_429; tentativa++) {
      res = await fetch(url, {
        headers: { "User-Agent": userAgent },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status !== 429) break;
      if (tentativa === MAX_TENTATIVAS_429) return null;
      const retryAfterHeader = Number(res.headers.get("retry-after"));
      const esperaMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
        ? retryAfterHeader * 1000
        : BACKOFF_PADRAO_MS * tentativa;
      await sleep(esperaMs);
    }
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

  let perfisInstagram = {};
  try {
    perfisInstagram = JSON.parse(fs.readFileSync(path.join(ROOT, "data/instagram-profiles.json"), "utf8"));
  } catch { perfisInstagram = {}; }

  let perfisTwitter = {};
  try {
    perfisTwitter = JSON.parse(fs.readFileSync(path.join(ROOT, "data/twitter-profiles.json"), "utf8"));
  } catch { perfisTwitter = {}; }

  const { orderedProfiles: instagramProfiles, requiredProfiles } = resolverPerfisInstagram(nome, perfisInstagram);
  const { orderedProfiles: twitterProfiles } = resolverPerfisTwitter(nome, perfisTwitter);

  const instaResults = await Promise.all(instagramProfiles.map((perfil) => buscarInstagramComLimite(perfil)));
  const twitterResults = await Promise.all(twitterProfiles.map((perfil) => buscarTwitterOficial(perfil)));
  const [ddgRes, wikiRes] = await Promise.allSettled([
    buscarDuckDuckGo(query),
    buscarWikimedia(nome),
  ]);

  let resultados = [
    ...instaResults.flatMap((resultado) => resultado.resultados || []),
    ...twitterResults.flatMap((resultado) => resultado.resultados || []),
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

  // Limitar por fonte, preservando pelo menos uma opcao do perfil principal
  const instaTodas = resultados.filter(r => r.fonte.startsWith("Instagram"));
  const instaObrigatorias = [];
  for (const perfil of requiredProfiles) {
    const item = instaTodas.find((r) => String(r.fonte || "") === `Instagram @${perfil}`);
    if (item) instaObrigatorias.push(item);
  }
  const instaExtras = instaTodas.filter((r) => !instaObrigatorias.includes(r));
  const insta = [...instaObrigatorias, ...instaExtras].slice(0, 3);
  const twitter = resultados.filter(r => r.fonte.startsWith("X/Twitter")).slice(0, 2);
  const ddg = resultados.filter(r => r.fonte.startsWith("DuckDuckGo")).slice(0, 4);
  const wiki = resultados.filter(r => r.fonte.startsWith("Wikimedia")).slice(0, 2);

  // Misturar
  const misturado = [];
  const maxLen = Math.max(insta.length, twitter.length, ddg.length, wiki.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < insta.length) misturado.push(insta[i]);
    if (i < twitter.length) misturado.push(twitter[i]);
    if (i < ddg.length) misturado.push(ddg[i]);
    if (i < wiki.length) misturado.push(wiki[i]);
  }

  const errosInstagram = instaResults
    .filter((resultado) => resultado.erro)
    .reduce((acc, resultado) => {
      acc[resultado.perfil] = resultado.erro;
      return acc;
    }, {});

  for (const perfil of requiredProfiles) {
    const temPerfil = resultados.some((r) => String(r.fonte || "") === `Instagram @${perfil}`);
    if (!temPerfil && misturado.length < 3) {
      const detalhe = errosInstagram[perfil] ? ` (${errosInstagram[perfil]})` : "";
      throw new Error(`perfil oficial do Instagram obrigatorio sem imagem encontrada: @${perfil}${detalhe}`);
    }
  }

  return misturado.slice(0, 9);
}

module.exports = { buscarMultiOpcoes, baixarImagem };
