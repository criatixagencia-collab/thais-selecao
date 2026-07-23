#!/usr/bin/env node
/**
 * Gerador oficial da selecao interativa da Thais.
 *
 * Este script copia o comportamento essencial do fluxo antigo do Caique:
 * - valida texto completo;
 * - exige varias imagens reais por materia;
 * - baixa/copia imagens para uma pasta local da selecao;
 * - gera HTML com cards, aprovacao, escolha de imagem e localStorage.
 *
 * Uso:
 *   npm run selection:interactive -- --input data/selecao-pronta.json
 *   node scripts/gerar-selecao-interativa.cjs --input data/selecao-pronta.json --slug selecao-20260619-1830
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const {
  bodyToParagraphs,
  hasFactualAnchor,
  isAbstractClosing,
  hasHardBannedClosing,
} = require("./lib/texto-editorial.cjs");
const { focoDoCorte } = require("./lib/crop.cjs");

const MIN_BODY_CHARS = Number(process.env.THAIS_MIN_BODY_CHARS || 800);
const MIN_PARAGRAPHS = Number(process.env.THAIS_MIN_PARAGRAPHS || 3);
const MIN_IMAGES_PER_ITEM = Number(process.env.THAIS_MIN_IMAGES || 3);
const MAX_IMAGES_PER_ITEM = Number(process.env.THAIS_MAX_IMAGES || 8);

function parseArgs(argv) {
  const args = {
    input: path.join(dataDir, "selecao-pronta.json"),
    slug: "",
    title: "Selecao Interativa - ENTRETEU",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--input" && next) {
      args.input = path.resolve(root, next);
      i += 1;
    } else if (current === "--slug" && next) {
      args.slug = next;
      i += 1;
    } else if (current === "--title" && next) {
      args.title = next;
      i += 1;
    }
  }

  if (!args.slug) args.slug = makeSelectionSlug();
  return args;
}

function makeSelectionSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    "selecao",
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("");
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de entrada nao encontrado: ${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value, fallback) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
  return slug || fallback || "materia";
}

function ensureEditorialClosing(title, paragraphs) {
  const lastParagraph = paragraphs[paragraphs.length - 1] || "";
  if (!lastParagraph) return;
  if (hasHardBannedClosing(lastParagraph)) {
    throw new Error(
      `Fechamento proibido para "${title}". ` +
        "O ultimo paragrafo usa formula ornamental ja banida pelo regimento e precisa ser reescrito ou cortado.",
    );
  }
  if (isAbstractClosing(lastParagraph) && !hasFactualAnchor(lastParagraph)) {
    throw new Error(
      `Fechamento abstrato demais para "${title}". ` +
        "O ultimo paragrafo precisa encerrar com fato, estado atual, proximo passo ou fala verificavel, " +
        "nao com linguagem ornamental sobre fase, conversa, estrategia ou contexto.",
    );
  }
  if (paragraphs.length >= 4) {
    const withoutLast = paragraphs.slice(0, -1);
    if (withoutLast.join(" ").length >= MIN_BODY_CHARS && hasHardBannedClosing(lastParagraph)) {
      throw new Error(
        `Fechamento-remendo para "${title}". ` +
          "Se a materia ja se sustenta sem o ultimo paragrafo, corte em vez de encerrar com recapitulacao.",
      );
    }
  }
}

function normalizeItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.pautas)) return payload.pautas;
  throw new Error("Entrada invalida. Use JSON com array direto ou objeto { items: [...] }.");
}

function itemTitle(item) {
  return item.buzzpopTitle || item.title || item.tit || "";
}

function itemLine(item) {
  return item.buzzpopLine || item.line || item.excerpt || item.resumo || "";
}

function itemBody(item) {
  const body = item.buzzpopBody || item.body || item.texto || "";
  return Array.isArray(body) ? body.join("\n\n") : String(body || "");
}

function itemCategory(item) {
  return item.categoryHint || item.category || item.cat_label || item.cat || "Entretenimento";
}

function itemSources(item) {
  const sources = item.evidenceSources || item.sources || item.fontes || [];
  return Array.isArray(sources) ? sources.filter(Boolean) : [sources].filter(Boolean);
}

function candidateUrl(candidate) {
  if (!candidate) return "";
  if (typeof candidate === "string") return candidate;
  return candidate.imageUrl || candidate.url || candidate.src || candidate.localPath || "";
}

function candidateCredit(candidate) {
  if (!candidate || typeof candidate === "string") return "Imagem pendente de credito";
  return candidate.credit || candidate.credito || candidate.source || candidate.fonte || candidate.title || candidate.label || "Imagem pendente de credito";
}

function candidateStatus(candidate) {
  if (!candidate || typeof candidate === "string") return "usar com cautela";
  return candidate.status || "usar com cautela";
}

function candidateSourceUrl(candidate) {
  if (!candidate || typeof candidate === "string") return "";
  return candidate.pagina || candidate.sourceUrl || candidate.source || candidate.originalUrl || candidate.urlOriginal || candidate.fonte || "";
}

function candidateLabel(candidate, index) {
  if (!candidate || typeof candidate === "string") return `Opcao ${index + 1}`;
  return candidate.label || candidate.title || candidate.alt || `Opcao ${index + 1}`;
}

function optionLabel(index) {
  return `Opcao ${index + 1}`;
}

function imageCandidates(item) {
  const raw = [];
  if (Array.isArray(item.imageCandidates)) raw.push(...item.imageCandidates);
  if (Array.isArray(item.images)) raw.push(...item.images);
  if (Array.isArray(item.imgs)) raw.push(...item.imgs);
  if (item.image || item.imageUrl || item.src) {
    raw.unshift({
      url: item.image || item.imageUrl || item.src,
      credit: item.imageCredit || item.credito || item.source,
      status: item.imageStatus || "usar com cautela",
    });
  }

  const seen = new Set();
  return raw
    .map((candidate) => ({ candidate, url: candidateUrl(candidate) }))
    .filter(({ url }) => Boolean(url))
    .filter(({ url }) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, MAX_IMAGES_PER_ITEM);
}

function validateText(item, index) {
  const title = itemTitle(item) || `Materia ${index + 1}`;
  const body = itemBody(item);
  const paragraphs = bodyToParagraphs(body);
  if (body.length < MIN_BODY_CHARS || paragraphs.length < MIN_PARAGRAPHS) {
    throw new Error(
      `Texto curto demais para "${title}". ` +
        `Encontrado: ${body.length} caracteres e ${paragraphs.length} paragrafos. ` +
        `Minimo: ${MIN_BODY_CHARS} caracteres e ${MIN_PARAGRAPHS} paragrafos. ` +
        "Na Etapa 2 a Thais deve escrever materia completa, nao resumo de cardapio.",
    );
  }
  ensureEditorialClosing(title, paragraphs);
  return { body, paragraphs };
}

function extensionFromContentType(contentType, url) {
  const type = String(contentType || "").toLowerCase();
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("gif")) return ".gif";
  if (type.includes("jpeg") || type.includes("jpg")) return ".jpg";
  const ext = path.extname(String(url || "").split("?")[0]).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  return ".jpg";
}

function jpegDimensions(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + length;
  }
  return null;
}

function imageDimensions(buffer) {
  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return jpegDimensions(buffer);
  }
  return null;
}

function imageShape(buffer) {
  const dimensions = imageDimensions(buffer);
  if (!dimensions) return {};
  return {
    width: dimensions.width,
    height: dimensions.height,
    orientation: dimensions.width >= dimensions.height ? "horizontal" : "vertical",
  };
}

function resolveLocalImage(url, inputDir) {
  const clean = String(url || "");
  if (/^https?:\/\//i.test(clean)) return "";
  const candidates = [
    path.resolve(inputDir, clean),
    path.resolve(root, clean),
    path.resolve(root, clean.replace(/^\/+/, "")),
  ];
  return candidates.find((filePath) => fs.existsSync(filePath)) || "";
}

async function copyOrDownloadImage({ url, inputDir, imagesDir, fileBase }) {
  const local = resolveLocalImage(url, inputDir);
  if (local) {
    const ext = extensionFromContentType("", local);
    const fileName = `${fileBase}${ext}`;
    const filePath = path.join(imagesDir, fileName);
    fs.copyFileSync(local, filePath);
    const buffer = fs.readFileSync(filePath);
    return { fileName, localUrl: `imagens/${fileName}`, bytes: buffer.length, ...imageShape(buffer) };
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`imagem local inexistente: ${url}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ThaisSelectionBot/1.0)",
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.toLowerCase().includes("image")) {
      throw new Error(`conteudo nao e imagem (${contentType})`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1024) throw new Error("imagem muito pequena ou vazia");
    const ext = extensionFromContentType(contentType, url);
    const fileName = `${fileBase}${ext}`;
    const filePath = path.join(imagesDir, fileName);
    fs.writeFileSync(filePath, buffer);
    return { fileName, localUrl: `imagens/${fileName}`, bytes: buffer.length, ...imageShape(buffer) };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildImageOptions(item, inputDir, imagesDir, slug) {
  const candidates = imageCandidates(item);
  const options = [];
  for (let index = 0; index < candidates.length; index += 1) {
    const { candidate, url } = candidates[index];
    const fileBase = `${slug}-img-${String(index + 1).padStart(2, "0")}`;
    try {
      const local = await copyOrDownloadImage({ url, inputDir, imagesDir, fileBase });
      const cropFocus = await focoDoCorte(path.join(imagesDir, local.fileName));
      options.push({
        cropFocus,
        url: local.localUrl,
        originalUrl: url,
        sourceUrl: candidateSourceUrl(candidate),
        label: optionLabel(index),
        sourceLabel: candidateLabel(candidate, index),
        optionNumber: index + 1,
        credit: candidateCredit(candidate),
        status: candidateStatus(candidate),
        bytes: local.bytes,
        width: local.width,
        height: local.height,
        orientation: local.orientation,
      });
    } catch (error) {
      console.warn(`Imagem ignorada para "${itemTitle(item)}": ${url} (${error.message})`);
    }
  }

  const title = itemTitle(item);
  if (options.length < MIN_IMAGES_PER_ITEM) {
    throw new Error(
      `Materia "${title}" tem apenas ${options.length} imagem(ns) renderizavel(is). ` +
        `Minimo exigido: ${MIN_IMAGES_PER_ITEM}. ` +
        "Busque mais imagens candidatas antes de publicar a selecao interativa.",
    );
  }
  return options;
}

const EMBED_URL_RE = /^https:\/\/(www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?/;
const EMBED_PERFIL_RE = /^https:\/\/(www\.)?instagram\.com\/[A-Za-z0-9_.]+\/?$/;

function buildEmbedOptions(item) {
  const raw = Array.isArray(item.visuaisEmbed) ? item.visuaisEmbed : [];
  const seen = new Set();
  const options = [];
  for (const cand of raw) {
    const embedUrl = String(cand?.embedUrl || "").trim();
    if (!embedUrl || seen.has(embedUrl)) continue;
    if (!EMBED_URL_RE.test(embedUrl) && !EMBED_PERFIL_RE.test(embedUrl)) continue;
    seen.add(embedUrl);
    options.push({
      type: "embed_instagram",
      embedUrl,
      credit: String(cand.credito || cand.credit || "").trim() || "Instagram",
      sourceUrl: String(cand.pagina || cand.sourceUrl || embedUrl).trim(),
      status: "usar via embed",
      legenda: String(cand.legenda || "").trim(),
      label: `Embed ${options.length + 1}`,
    });
    if (options.length >= 3) break;
  }
  return options;
}

function renderSources(sources) {
  if (!sources.length) return "Fontes pendentes";
  return sources.map((source) => {
    if (typeof source === "string") return escapeHtml(source);
    const label = source.label || source.title || source.name || source.url || "Fonte";
    const url = source.url || source.href || "";
    if (!url) return escapeHtml(label);
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
  }).join(" / ");
}

function renderEmbedOptions(item) {
  const base = item.imageOptions.length;
  return (item.embedOptions || []).map((embed, index) => {
    const id = `emb_${item.num}_${index}`;
    return (
      `<label class="img-option embed-option" for="${escapeHtml(id)}">` +
        `<input type="radio" name="img_${escapeHtml(item.num)}" id="${escapeHtml(id)}" value="embed-${escapeHtml(index)}" data-embed-index="${escapeHtml(index)}">` +
        '<span class="embed-box">' +
          '<span class="embed-tag">Embed oficial do Instagram</span>' +
          `<span class="embed-handle">${escapeHtml(embed.credit)}</span>` +
          (embed.legenda ? `<span class="embed-caption">${escapeHtml(embed.legenda)}</span>` : "") +
        '</span>' +
        `<span class="img-label">${escapeHtml(embed.label)} - ${escapeHtml(embed.credit)}</span>` +
        `<span class="img-status">${escapeHtml(embed.status)}</span>` +
        `<a href="${escapeHtml(embed.embedUrl)}" target="_blank" rel="noopener noreferrer" class="img-src">Abrir post original</a>` +
      "</label>"
    );
  }).join("");
}

function renderImageOptions(item) {
  return item.imageOptions.map((image, index) => {
    const id = `img_${item.num}_${index}`;
    const srcLink = image.pagina || image.sourceUrl || image.source || image.fonte || "";
    const label = image.label || optionLabel(index);
    const alt = `${item.title} - ${label}`;
    const width = Number(image.width) || 1;
    const height = Number(image.height) || 1;
    const originalAspect = `${width}/${height}`;
    const isVertical = image.orientation === "vertical" || height > width;
    const desktopClass = isVertical ? "crop-desktop crop-cut" : "crop-desktop crop-original";
    const desktopAspect = isVertical ? "16/9" : originalAspect;
    // Foco de corte por saliencia (rosto/sujeito): aplica no thumbnail
    // principal (cover 142px) e no preview desktop cortado.
    const foco = image.cropFocus && Number.isFinite(image.cropFocus.y)
      ? `object-position:${image.cropFocus.x}% ${image.cropFocus.y}%`
      : "";
    const estiloFoco = foco ? ` style="${escapeHtml(foco)}"` : "";
    return (
      `<label class="img-option" for="${escapeHtml(id)}">` +
        `<input type="radio" name="img_${escapeHtml(item.num)}" id="${escapeHtml(id)}" value="${escapeHtml(index)}" data-image-index="${escapeHtml(index)}">` +
        `<img class="img-main" src="${escapeHtml(image.url)}" alt="${escapeHtml(alt)}" loading="lazy"${estiloFoco}>` +
        '<span class="crop-previews" aria-hidden="true">' +
          `<span class="crop-preview ${desktopClass}" style="aspect-ratio:${escapeHtml(desktopAspect)}">` +
            `<img src="${escapeHtml(image.url)}" alt="" loading="lazy"${isVertical ? estiloFoco : ""}>` +
            '<span>desktop</span>' +
          '</span>' +
          `<span class="crop-preview crop-mobile crop-original" style="aspect-ratio:${escapeHtml(originalAspect)}">` +
            `<img src="${escapeHtml(image.url)}" alt="" loading="lazy">` +
            '<span>mobile</span>' +
          '</span>' +
        '</span>' +
        `<span class="img-label">${escapeHtml(label)} - ${escapeHtml(image.credit)}</span>` +
        `<span class="img-status">${escapeHtml(image.status)}</span>` +
        (srcLink ? `<a href="${escapeHtml(srcLink)}" target="_blank" rel="noopener noreferrer" class="img-src">Ver origem</a>` : "") +
      "</label>"
    );
  }).join("");
}

function renderHtml(items, generatedAt, title) {
  const cards = items.map((item) => {
    const bodyHtml = item.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
    return (
      `<article class="card" data-num="${escapeHtml(item.num)}" data-slug="${escapeHtml(item.slug)}" data-title="${escapeHtml(item.title)}">` +
        '<div class="card-top">' +
          `<span class="num">Materia ${escapeHtml(String(item.num).padStart(2, "0"))}</span>` +
          `<button type="button" class="copy-num" data-action="copy-num">Copiar numero</button>` +
          `<span class="badge">${escapeHtml(item.category)}</span>` +
          '<span class="status-pill" data-role="status-pill">Nao aprovada</span>' +
        '</div>' +
        `<h2>${escapeHtml(item.title)}</h2>` +
        `<p class="line">${escapeHtml(item.line)}</p>` +
        `<div class="body-text">${bodyHtml}</div>` +
        `<p class="sources"><strong>Fontes:</strong> ${renderSources(item.sources)}</p>` +
        '<section class="image-block">' +
          '<h3>Escolha a imagem</h3>' +
          `<div class="img-grid">${renderImageOptions(item)}${renderEmbedOptions(item)}</div>` +
        '</section>' +
        '<div class="decision-bar">' +
          '<button type="button" class="decision-btn approve" data-action="approved">Aprovar materia</button>' +
          '<button type="button" class="decision-btn clear" data-action="pending">Desfazer aprovacao</button>' +
          '<p class="decision-status" data-role="decision-status">Status: nao aprovada</p>' +
        '</div>' +
      '</article>'
    );
  }).join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
*,::after,::before{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#0d0b0b;--panel:#171313;--panel-2:#211b1b;--text:#f4eeee;--muted:#b8aaa7;--line:#342a29;--red:#c12222;--yellow:#f0c646;--green:#1f8f55;--green-bg:#13231a}
body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text);line-height:1.55}
a{color:#f0c646}
.container{width:100%;max-width:980px;margin:0 auto;padding:1.4rem 1rem 2.5rem}
.top{border-bottom:1px solid var(--line);margin-bottom:1rem;padding-bottom:1rem}
h1{font-size:clamp(1.7rem,5vw,2.7rem);font-weight:950;text-transform:uppercase;line-height:1}
.sub{color:var(--muted);font-size:.9rem;margin-top:.5rem}
.notice{background:#181313;border:1px solid var(--line);border-radius:8px;color:#e8dddd;margin-top:.9rem;padding:.85rem;font-size:.88rem}
.approval-board{align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:8px;display:flex;gap:.75rem;justify-content:space-between;margin:1rem 0;padding:.75rem;position:sticky;top:.5rem;z-index:10}
.summary{font-size:.86rem;font-weight:850;color:var(--yellow)}
.tool-btn{background:#2a2221;border:1px solid #4a3b38;border-radius:6px;color:var(--text);cursor:pointer;font-size:.74rem;font-weight:850;padding:.45rem .6rem;text-transform:uppercase;letter-spacing:.04em}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin-bottom:1rem;padding:1rem;transition:border-color .18s,background .18s}
.card.is-approved{background:var(--green-bg);border-color:var(--green)}
.card-top{display:flex;flex-wrap:wrap;gap:.45rem;align-items:center;margin-bottom:.75rem}
.num{background:var(--red);border-radius:6px;color:#fff;font-size:.72rem;font-weight:900;letter-spacing:.08em;padding:.28rem .55rem;text-transform:uppercase}
.copy-num{background:#2a2221;border:1px solid #4a3b38;border-radius:6px;color:#fff;cursor:pointer;font-size:.68rem;font-weight:850;padding:.26rem .48rem;text-transform:uppercase}
.badge,.status-pill{background:#241e1d;border:1px solid #3d3230;border-radius:999px;color:var(--yellow);font-size:.68rem;font-weight:850;letter-spacing:.06em;padding:.22rem .52rem;text-transform:uppercase}
.status-pill{margin-left:auto;color:var(--muted)}.is-approved .status-pill{background:#14351f;border-color:#2b7c4a;color:#9df0bc}
h2{font-size:1.35rem;font-weight:900;line-height:1.2;margin-bottom:.45rem;word-break:break-word;overflow-wrap:break-word}
.line{background:#211918;border:1px solid #352928;border-radius:8px;color:#d8cfcc;font-size:.92rem;margin-bottom:.85rem;padding:.65rem .75rem}
.body-text{background:var(--panel-2);border-radius:8px;color:#eee5e2;font-size:.96rem;margin:.75rem 0;padding:1rem}
.body-text p{margin:0 0 1rem}.body-text p:last-child{margin-bottom:0}
.sources{color:var(--muted);font-size:.78rem;margin:.7rem 0 1rem;word-break:break-word;overflow-wrap:break-word}
.image-block h3{color:var(--yellow);font-size:.9rem;margin-bottom:.65rem;text-transform:uppercase;letter-spacing:.07em}
.img-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:.65rem}
.img-option{background:#100d0d;border:2px solid #332827;border-radius:8px;cursor:pointer;display:block;overflow:hidden;transition:border-color .18s,box-shadow .18s,transform .18s}
.img-option:hover{transform:translateY(-1px)}
.img-option input{height:0;opacity:0;position:absolute;width:0}
.img-option:has(input:checked){border-color:var(--yellow);box-shadow:0 0 0 2px rgba(240,198,70,.25)}
.img-option .img-main{background:#050505;display:block;height:142px;object-fit:cover;width:100%}
.crop-previews{display:grid;gap:4px;grid-template-columns:1fr 1fr;padding:5px 5px 0}
.crop-preview{background:#050505;border:1px solid #302625;border-radius:5px;display:block;overflow:hidden;position:relative}
.crop-preview img{display:block;height:100%;object-fit:contain;width:100%}
.crop-cut img{object-fit:cover}
.crop-preview span{background:rgba(0,0,0,.68);bottom:0;color:#d8cfcc;font-size:.55rem;font-weight:850;left:0;letter-spacing:.05em;line-height:1;padding:.18rem .28rem;position:absolute;text-transform:uppercase}
.embed-option .embed-box{background:linear-gradient(135deg,#2a1a2e,#1a1420);display:flex;flex-direction:column;gap:.35rem;justify-content:center;min-height:142px;padding:.7rem}
.embed-tag{color:#e1a0ff;font-size:.6rem;font-weight:900;letter-spacing:.08em;text-transform:uppercase}
.embed-handle{color:#f4eeee;font-size:.85rem;font-weight:850;word-break:break-all}
.embed-caption{color:#b8aaa7;font-size:.68rem;line-height:1.3}
.img-src{color:var(--text-dim);display:inline-block;font-size:.65rem;margin-top:.25rem;padding:0 .25rem;text-decoration:underline}
.img-label{color:#c7bbb8;display:block;font-size:.7rem;line-height:1.25;padding:.45rem .45rem .1rem}
.img-status{color:#8f8582;display:block;font-size:.66rem;line-height:1.2;padding:0 .45rem .45rem;text-transform:uppercase}
.decision-bar{align-items:center;border-top:1px solid var(--line);display:flex;gap:.75rem;justify-content:space-between;margin-top:1rem;padding-top:.9rem}
.decision-btn{border:1px solid transparent;border-radius:6px;color:#fff;cursor:pointer;font-size:.78rem;font-weight:900;letter-spacing:.05em;padding:.55rem .72rem;text-transform:uppercase}
.decision-btn.approve{background:var(--green)}.decision-btn.clear{background:#312827;border-color:#4d403d;color:#d8cfcc}
.decision-status{color:#d8cfcc;font-size:.82rem;font-weight:750;text-align:right}
.footer{color:#666;font-size:.72rem;letter-spacing:.08em;margin-top:2rem;text-align:center;text-transform:uppercase}
@media(max-width:680px){.approval-board,.decision-bar{align-items:stretch;flex-direction:column}.tool-btn,.decision-btn{width:100%}.decision-status{text-align:left}}
@media(max-width:560px){.container{padding-inline:.75rem}.img-grid{grid-template-columns:1fr 1fr}.img-option .img-main{height:120px}.status-pill{margin-left:0}}
</style>
</head>
<body>
<main class="container">
<header class="top">
<h1>Selecao Interativa</h1>
<p class="sub">${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(generatedAt)))} - ${escapeHtml(items.length)} materias com textos completos e imagens locais</p>
<p class="notice">Etapa 2: revisar textos completos, escolher imagem e aprovar. Materias nao aprovadas ficam rejeitadas automaticamente.</p>
</header>
<section class="approval-board">
<strong class="summary" data-role="summary">0 aprovadas - ${escapeHtml(items.length)} rejeitadas automaticamente</strong>
<button type="button" class="tool-btn" data-action="copy-approved">Copiar aprovadas</button>
<button type="button" class="tool-btn" data-action="clear-all">Limpar</button>
</section>
${cards}
<div class="footer">ENTRETEU - selecao editorial</div>
</main>
<script>
(function(){
  var storageKey = "thais-selecao-interativa:" + location.pathname;
  var cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
  var state = {};
  try { state = JSON.parse(localStorage.getItem(storageKey) || "{}") || {}; } catch (error) { state = {}; }
  function key(card){ return card.dataset.slug || card.dataset.num; }
  function persist(){ localStorage.setItem(storageKey, JSON.stringify(state)); }
  function selectedLabel(decision){
    if (decision.embedIndex !== undefined && decision.embedIndex !== null) return "embed " + (Number(decision.embedIndex) + 1);
    return decision.imageIndex === undefined || decision.imageIndex === null ? "sem imagem" : "opcao " + (Number(decision.imageIndex) + 1);
  }
  function updateCard(card){
    var decision = state[key(card)] || { status: "pending" };
    if (decision.status !== "approved") decision.status = "pending";
    card.classList.toggle("is-approved", decision.status === "approved");
    var input = decision.embedIndex !== undefined && decision.embedIndex !== null
      ? card.querySelector('input[data-embed-index="' + decision.embedIndex + '"]')
      : card.querySelector('input[data-image-index="' + decision.imageIndex + '"]');
    if (input) input.checked = true;
    var pill = card.querySelector('[data-role="status-pill"]');
    var status = card.querySelector('[data-role="decision-status"]');
    if (pill) pill.textContent = decision.status === "approved" ? "Aprovada" : "Nao aprovada";
    if (status) status.textContent = "Status: " + (decision.status === "approved" ? "aprovada" : "nao aprovada") + " - Imagem: " + selectedLabel(decision);
  }
  function updateSummary(){
    var approved = cards.filter(function(card){ return (state[key(card)] || {}).status === "approved"; }).length;
    var summary = document.querySelector('[data-role="summary"]');
    if (summary) summary.textContent = approved + " aprovadas - " + (cards.length - approved) + " rejeitadas automaticamente";
  }
  function setStatus(card, status){
    var current = state[key(card)] || {};
    state[key(card)] = { status: status, imageIndex: current.imageIndex, title: card.dataset.title, num: card.dataset.num, updatedAt: new Date().toISOString() };
    persist(); updateCard(card); updateSummary();
  }
  function setImage(card, imageIndex){
    var current = state[key(card)] || { status: "pending" };
    state[key(card)] = { status: current.status === "approved" ? "approved" : "pending", imageIndex: Number(imageIndex), title: card.dataset.title, num: card.dataset.num, updatedAt: new Date().toISOString() };
    persist(); updateCard(card); updateSummary();
  }
  function setEmbed(card, embedIndex){
    var current = state[key(card)] || { status: "pending" };
    state[key(card)] = { status: current.status === "approved" ? "approved" : "pending", embedIndex: Number(embedIndex), title: card.dataset.title, num: card.dataset.num, updatedAt: new Date().toISOString() };
    persist(); updateCard(card); updateSummary();
  }
  cards.forEach(function(card){
    updateCard(card);
    card.addEventListener("click", function(event){
      if (event.target.dataset.action === "approved") setStatus(card, "approved");
      if (event.target.dataset.action === "pending") setStatus(card, "pending");
      if (event.target.dataset.action === "copy-num") {
        navigator.clipboard.writeText(String(card.dataset.num || ""));
        event.target.textContent = "Copiado";
        setTimeout(function(){ event.target.textContent = "Copiar numero"; }, 1200);
      }
    });
    card.addEventListener("change", function(event){
      if (event.target.matches('input[data-image-index]')) setImage(card, event.target.dataset.imageIndex);
      if (event.target.matches('input[data-embed-index]')) setEmbed(card, event.target.dataset.embedIndex);
    });
  });
  document.querySelector('[data-action="clear-all"]').addEventListener("click", function(){ state = {}; persist(); cards.forEach(updateCard); updateSummary(); });
  document.querySelector('[data-action="copy-approved"]').addEventListener("click", function(event){
    var text = "APROVADAS - " + location.pathname + "\\n\\n";
    cards.forEach(function(card){
      var decision = state[key(card)] || {};
      if (decision.status === "approved") text += String(card.dataset.num).padStart(2, "0") + " - " + card.dataset.title + "\\nVisual: " + selectedLabel(decision) + "\\n\\n";
    });
    navigator.clipboard.writeText(text);
    event.target.textContent = "Copiado";
    setTimeout(function(){ event.target.textContent = "Copiar aprovadas"; }, 1500);
  });
  updateSummary();
})();
</script>
</body>
</html>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const payload = readJson(args.input);
  const inputDir = path.dirname(args.input);
  const sourceItems = normalizeItems(payload);
  if (!sourceItems.length) throw new Error("Nenhuma materia encontrada no arquivo de entrada.");

  const outputDir = path.join(root, args.slug);
  const imagesDir = path.join(outputDir, "imagens");
  fs.mkdirSync(imagesDir, { recursive: true });

  const outputItems = [];
  for (let index = 0; index < sourceItems.length; index += 1) {
    const source = sourceItems[index];
    const title = itemTitle(source);
    if (!title) throw new Error(`Materia ${index + 1} sem titulo.`);
    const text = validateText(source, index);
    const slug = slugify(source.slug || title, `materia-${index + 1}`);
    const itemNumber = Number(source.num || source.numero || index + 1);
    const imageOptions = await buildImageOptions(source, inputDir, imagesDir, `${String(index + 1).padStart(2, "0")}-${slug}`);
    outputItems.push({
      num: Number.isFinite(itemNumber) && itemNumber > 0 ? itemNumber : index + 1,
      slug,
      title,
      line: itemLine(source),
      category: itemCategory(source),
      body: text.body,
      paragraphs: text.paragraphs,
      sources: itemSources(source),
      editorialAlert: source.editorialAlert || source.alertaEditorial || source.observacoesEditoriais || "",
      pendenciasImagem: Array.isArray(source.pendenciasImagem) ? source.pendenciasImagem : [],
      imageOptions,
      embedOptions: buildEmbedOptions(source),
    });
  }

  const generatedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDir, "data.json"), JSON.stringify({ generatedAt, items: outputItems }, null, 2), "utf8");
  fs.writeFileSync(path.join(outputDir, "index.html"), renderHtml(outputItems, generatedAt, args.title), "utf8");

  console.log(`Selecao interativa gerada: ${path.relative(root, outputDir)}/index.html`);
  console.log(`Materias: ${outputItems.length}`);
  console.log(`Imagens locais: ${outputItems.reduce((total, item) => total + item.imageOptions.length, 0)}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
