#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const {
  bodyToParagraphs,
  hasFactualAnchor,
  isAbstractClosing,
  hasHardBannedClosing,
} = require("./lib/texto-editorial.cjs");
const DEFAULT_MIN_IMAGES = Number(process.env.THAIS_MIN_IMAGES || 3);
const DEFAULT_MIN_BODY_CHARS = Number(process.env.THAIS_MIN_BODY_CHARS || 800);
const DEFAULT_MIN_PARAGRAPHS = Number(process.env.THAIS_MIN_PARAGRAPHS || 3);

// Regra de evolucao do Regimento 03: bug objetivo e repetivel vira validacao aqui,
// nao paragrafo novo no regimento.

function parseArgs(argv) {
  const args = {
    dir: "",
    latest: false,
    staged: false,
    minImages: DEFAULT_MIN_IMAGES,
    minBodyChars: DEFAULT_MIN_BODY_CHARS,
    minParagraphs: DEFAULT_MIN_PARAGRAPHS,
    allowRemote: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--dir" && next) {
      args.dir = next;
      i += 1;
    } else if (current === "--latest") {
      args.latest = true;
    } else if (current === "--staged") {
      args.staged = true;
    } else if (current === "--min-images" && next) {
      args.minImages = Number(next);
      i += 1;
    } else if (current === "--min-body-chars" && next) {
      args.minBodyChars = Number(next);
      i += 1;
    } else if (current === "--min-paragraphs" && next) {
      args.minParagraphs = Number(next);
      i += 1;
    } else if (current === "--allow-remote") {
      args.allowRemote = true;
    }
  }

  return args;
}

function selectionDirs() {
  return fs.readdirSync(root)
    .filter((name) => /^selecao-\d{8}-\d{4}$/.test(name))
    .map((name) => path.join(root, name))
    .filter((dir) => fs.existsSync(path.join(dir, "index.html")));
}

function latestSelectionDir() {
  const dirs = selectionDirs();
  if (!dirs.length) throw new Error("Nenhuma pasta selecao-AAAAMMDD-HHMM encontrada.");
  return dirs.sort((left, right) => {
    return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
  })[0];
}

function stagedSelectionDirs() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Falha ao ler arquivos staged do git.");
  }

  const dirs = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^(selecao-\d{8}-\d{4})\//);
    if (match) dirs.add(path.join(root, match[1]));
  }
  return [...dirs];
}

function imageMagic(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) return "png";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "gif";
  return "";
}

function fail(errors, message) {
  errors.push(message);
}

function expectedOptionLabel(index) {
  return `Opcao ${index + 1}`;
}

function validateSelection(dir, args) {
  const errors = [];
  const indexPath = path.join(dir, "index.html");
  const dataPath = path.join(dir, "data.json");
  const label = path.relative(root, dir) || dir;

  if (!fs.existsSync(indexPath)) fail(errors, `${label}: falta index.html.`);
  if (!fs.existsSync(dataPath)) fail(errors, `${label}: falta data.json. Use o gerador oficial; HTML artesanal nao e aceito.`);
  if (errors.length) return { label, errors, summary: null };

  const html = fs.readFileSync(indexPath, "utf8");
  if (/const\s+(p|pautas)\s*=/.test(html)) {
    fail(errors, `${label}: HTML manual detectado (const p/const pautas). Rode o gerador oficial.`);
  }
  if (/src["']?\s*:\s*["']{2}/.test(html) || /imgs["']?\s*:\s*\[\s*\]/.test(html)) {
    fail(errors, `${label}: existem src vazio ou imgs: [] no HTML.`);
  }
  if (/Instagram via Apify|Verificar via Apify|pendente de imagem|Getty Images\/Emmys|src=['"]{2}/i.test(html)) {
    fail(errors, `${label}: HTML contem promessa de imagem sem miniatura real.`);
  }
  if (/crop-mobile\s+crop-cut/i.test(html)) {
    fail(errors, `${label}: preview mobile nao deve cortar; precisa manter a proporcao original da imagem.`);
  }
  if (/\.crop-(desktop|mobile)\{[^}]*aspect-ratio:/i.test(html)) {
    fail(errors, `${label}: proporcao de preview nao deve ser fixa no CSS; use aspect-ratio inline por imagem.`);
  }

  let data;
  try {
    data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  } catch (error) {
    fail(errors, `${label}: data.json invalido (${error.message}).`);
    return { label, errors, summary: null };
  }

  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) fail(errors, `${label}: data.json sem items.`);

  let totalImages = 0;
  for (const [index, item] of items.entries()) {
    const title = item.title || item.buzzpopTitle || `materia ${index + 1}`;
    const body = item.body || item.buzzpopBody || "";
    const paragraphs = bodyToParagraphs(body);
    if (String(body).length < args.minBodyChars || paragraphs.length < args.minParagraphs) {
      fail(
        errors,
        `${label}: texto curto em "${title}" (${String(body).length} caracteres, ${paragraphs.length} paragrafos).`,
      );
    }
    const lastParagraph = paragraphs[paragraphs.length - 1] || "";
    if (lastParagraph && hasHardBannedClosing(lastParagraph)) {
      fail(
        errors,
        `${label}: fechamento proibido em "${title}". O ultimo paragrafo usa formula ornamental banida pelo regimento.`,
      );
    } else if (lastParagraph && isAbstractClosing(lastParagraph) && !hasFactualAnchor(lastParagraph)) {
      fail(
        errors,
        `${label}: fechamento abstrato em "${title}". O ultimo paragrafo precisa encerrar com fato, estado atual, proximo passo ou fala verificavel.`,
      );
    }

    const images = Array.isArray(item.imageOptions) ? item.imageOptions : [];
    if (images.length < args.minImages) {
      fail(errors, `${label}: "${title}" tem ${images.length} imagem(ns); minimo ${args.minImages}.`);
    }
    totalImages += images.length;

    // Embeds oficiais do Instagram: opcionais, mas quando existem precisam
    // de URL real de post/perfil, credito de perfil e status "usar via embed".
    const EMBED_OK_RE = /^https:\/\/(www\.)?instagram\.com\/((p|reel|tv)\/[A-Za-z0-9_-]+\/?|[A-Za-z0-9_.]+\/?)$/;
    for (const [embedIndex, embed] of (Array.isArray(item.embedOptions) ? item.embedOptions : []).entries()) {
      const embedLabel = `${title} / embed ${embedIndex + 1}`;
      if (!EMBED_OK_RE.test(String(embed.embedUrl || ""))) {
        fail(errors, `${label}: ${embedLabel} sem URL real de post/perfil do Instagram (${embed.embedUrl || "vazio"}).`);
      }
      if (String(embed.status || "") !== "usar via embed") {
        fail(errors, `${label}: ${embedLabel} com status invalido ("${embed.status}"); embed oficial usa "usar via embed".`);
      }
      if (!/^Instagram\//.test(String(embed.credit || ""))) {
        fail(errors, `${label}: ${embedLabel} sem credito de perfil (esperado "Instagram/@perfil").`);
      }
      if (!html.includes(embed.embedUrl)) {
        fail(errors, `${label}: ${embedLabel} existe no data.json, mas nao aparece no HTML.`);
      }
    }

    for (const [imageIndex, image] of images.entries()) {
      const imageLabel = `${title} / imagem ${imageIndex + 1}`;
      const url = image.url || image.src || image.imageUrl || "";
      const expectedLabel = expectedOptionLabel(imageIndex);
      if (!url) {
        fail(errors, `${label}: ${imageLabel} sem url/src.`);
        continue;
      }
      if ((image.label || "") !== expectedLabel) {
        fail(errors, `${label}: ${imageLabel} com label invalido no data.json ("${image.label || ""}"; esperado "${expectedLabel}").`);
      }
      if (Number(image.optionNumber) !== imageIndex + 1) {
        fail(errors, `${label}: ${imageLabel} com optionNumber invalido no data.json (${image.optionNumber}; esperado ${imageIndex + 1}).`);
      }
      if (/^https?:\/\//i.test(url)) {
        if (!args.allowRemote) fail(errors, `${label}: ${imageLabel} ainda usa hotlink remoto (${url}).`);
        continue;
      }
      if (!image.credit && !image.credito) fail(errors, `${label}: ${imageLabel} sem credito.`);
      if (/^Foto:\s*arquivo\s*\(/i.test(image.credit || image.credito || "")) {
        fail(errors, `${label}: ${imageLabel} usa credito generico proibido ("${image.credit || image.credito}").`);
      }
      if (/^Credito nao confirmado - revisar pagina de origem/i.test(image.credit || image.credito || "")) {
        fail(errors, `${label}: ${imageLabel} esta com credito nao confirmado; revisar pagina de origem antes de publicar.`);
      }

      // --- Direito autoral da fotografia (Lei 9.610/98, arts. 24 II e 79 §1) ---
      // Crédito precisa identificar AUTOR (fotógrafo, agência ou licença nomeada).
      // Ver secao "Direito autoral da fotografia" no AGENTS.md.
      const creditoRaw = String(image.credit || image.credito || "").trim();
      const creditoTexto = creditoRaw.replace(/^\s*(foto|fotos|arte|grafico|gráfico|imagem|logo)s?\s*:\s*/i, "").trim();

      // 1. Generico puro: "Divulgacao", "Reproducao", "Internet", "Arquivo"
      const GENERICO_PURO = /^(divulga[cç][aã]o|reprodu[cç][aã]o|internet|arquivo|acervo|montagem)$/i;
      if (GENERICO_PURO.test(creditoTexto)) {
        fail(errors, `${label}: ${imageLabel} usa credito generico sem autoria ("${creditoRaw}"). Lei 9.610/98 exige identificacao do autor.`);
      }

      // 2. Generico + veiculo, sem fotografo: "Divulgacao/Globo", "Reproducao/Lionsgate"
      const GENERICO_COM_VEICULO = /^(divulga[cç][aã]o|reprodu[cç][aã]o)\s*[\/\-–|]\s*[\w\s.&]+$/i;
      const TEM_LICENCA = /(CC[ -]?(BY|0)|creative commons|dominio publico|domínio público|public domain)/i;
      if (GENERICO_COM_VEICULO.test(creditoTexto) && !TEM_LICENCA.test(creditoRaw)) {
        fail(errors, `${label}: ${imageLabel} credita veiculo, nao autor ("${creditoRaw}"). Emissora/portal nao e fotografo; usar nome do fotografo, agencia ou licenca.`);
      }

      // 3. Legenda/titulo colado no campo de credito
      const PARECE_LEGENDA = creditoTexto.length > 120
        || /[?!]/.test(creditoTexto)
        || /\b(far[aã]o|ser[aá]|comandam|celebra|re[uú]ne|apresenta|estreia|conta|mostra)\b/i.test(creditoTexto);
      if (PARECE_LEGENDA) {
        fail(errors, `${label}: ${imageLabel} tem legenda/titulo no lugar do credito ("${creditoRaw.slice(0, 70)}..."). Preencher com autoria real.`);
      }

      if (!image.status) fail(errors, `${label}: ${imageLabel} sem status de uso.`);

      // 4. Status permitidos e trava da imagem principal (Opcao 1)
      const STATUS_OK = ["licenciada", "autorizada", "usar com cautela", "nao usar"];
      const statusImg = String(image.status || "").trim().toLowerCase();
      if (statusImg && !STATUS_OK.includes(statusImg)) {
        fail(errors, `${label}: ${imageLabel} com status invalido ("${image.status}"). Permitidos: ${STATUS_OK.join(", ")}.`);
      }
      if (statusImg === "nao usar") {
        fail(errors, `${label}: ${imageLabel} marcada como "nao usar" e nao pode ir para a selecao.`);
      }
      if (imageIndex === 0 && statusImg && !["licenciada", "autorizada"].includes(statusImg)) {
        fail(errors, `${label}: ${imageLabel} e a imagem principal e esta como "${image.status}". Principal exige "licenciada" ou "autorizada".`);
      }
      const width = Number(image.width) || 0;
      const height = Number(image.height) || 0;
      if (width > 0 && height > 0) {
        const orientation = image.orientation || (width >= height ? "horizontal" : "vertical");
        const expectedDesktopClass = orientation === "vertical"
          ? 'crop-preview crop-desktop crop-cut" style="aspect-ratio:16/9"'
          : `crop-preview crop-desktop crop-original" style="aspect-ratio:${width}/${height}"`;
        const expectedMobileClass = `crop-preview crop-mobile crop-original" style="aspect-ratio:${width}/${height}"`;
        if (!html.includes(expectedDesktopClass)) {
          fail(errors, `${label}: ${imageLabel} nao segue a regra de corte desktop (${orientation}).`);
        }
        if (!html.includes(expectedMobileClass)) {
          fail(errors, `${label}: ${imageLabel} nao preserva a proporcao original no mobile.`);
        }
        // Corte desktop de foto vertical precisa de foco de saliencia
        // (rosto centralizado), nunca corte cego pelo centro.
        if (orientation === "vertical") {
          const foco = image.cropFocus;
          if (!foco || !Number.isFinite(Number(foco.y))) {
            fail(errors, `${label}: ${imageLabel} e vertical sem cropFocus calculado (corte desktop cairia cego no centro).`);
          } else if (!html.includes(`object-position:${foco.x}% ${foco.y}%`)) {
            fail(errors, `${label}: ${imageLabel} tem cropFocus no data.json, mas o HTML nao aplica o object-position correspondente.`);
          }
        }
      }

      const imagePath = path.resolve(dir, url);
      if (!imagePath.startsWith(`${dir}${path.sep}`)) {
        fail(errors, `${label}: ${imageLabel} aponta para fora da pasta da selecao (${url}).`);
        continue;
      }
      if (!fs.existsSync(imagePath)) {
        fail(errors, `${label}: ${imageLabel} aponta para arquivo inexistente (${url}).`);
        continue;
      }

      const stat = fs.statSync(imagePath);
      if (stat.size < 1024) {
        fail(errors, `${label}: ${imageLabel} parece vazio/erro (${stat.size} bytes).`);
      }
      const buffer = fs.readFileSync(imagePath);
      if (!imageMagic(buffer)) {
        fail(errors, `${label}: ${imageLabel} nao e imagem real (${url}).`);
      }
      if (!html.includes(url)) {
        fail(errors, `${label}: ${imageLabel} existe no data.json, mas nao aparece no HTML.`);
      }
      if (!html.includes(`${expectedLabel} - ${image.credit || image.credito || ""}`)) {
        fail(errors, `${label}: ${imageLabel} nao aparece no HTML com o label visual esperado (${expectedLabel}).`);
      }
    }
  }

  return {
    label,
    errors,
    summary: {
      items: items.length,
      images: totalImages,
      minImages: args.minImages,
    },
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let dirs = [];

  if (args.staged) {
    dirs = stagedSelectionDirs();
    if (!dirs.length) {
      console.log("Validador da selecao interativa: nenhum arquivo de selecao staged.");
      return;
    }
  } else if (args.dir) {
    dirs = [path.resolve(root, args.dir)];
  } else {
    dirs = [latestSelectionDir()];
  }

  const reports = dirs.map((dir) => validateSelection(dir, args));
  const errors = reports.flatMap((report) => report.errors);

  for (const report of reports) {
    if (report.summary) {
      console.log(
        `${report.label}: ${report.summary.items} materia(s), ` +
          `${report.summary.images} imagem(ns), minimo ${report.summary.minImages} por materia.`,
      );
    }
  }

  if (errors.length) {
    console.error("\nSelecao interativa invalida:");
    for (const error of errors) console.error(`- ${error}`);
    console.error("\nNao publicar. Corrija textos/imagens e rode o gerador oficial novamente.");
    process.exit(1);
  }

  console.log("Selecao interativa validada: zero imagens vazias, zero ausentes, zero HTML manual.");
}

main();
