#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const DEFAULT_MIN_IMAGES = Number(process.env.THAIS_MIN_IMAGES || 3);
const DEFAULT_MIN_BODY_CHARS = Number(process.env.THAIS_MIN_BODY_CHARS || 800);
const DEFAULT_MIN_PARAGRAPHS = Number(process.env.THAIS_MIN_PARAGRAPHS || 3);

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

function bodyToParagraphs(body) {
  return String(body || "")
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
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

    const images = Array.isArray(item.imageOptions) ? item.imageOptions : [];
    if (images.length < args.minImages) {
      fail(errors, `${label}: "${title}" tem ${images.length} imagem(ns); minimo ${args.minImages}.`);
    }
    totalImages += images.length;

    for (const [imageIndex, image] of images.entries()) {
      const imageLabel = `${title} / imagem ${imageIndex + 1}`;
      const url = image.url || image.src || image.imageUrl || "";
      if (!url) {
        fail(errors, `${label}: ${imageLabel} sem url/src.`);
        continue;
      }
      if (/^https?:\/\//i.test(url)) {
        if (!args.allowRemote) fail(errors, `${label}: ${imageLabel} ainda usa hotlink remoto (${url}).`);
        continue;
      }
      if (!image.credit && !image.credito) fail(errors, `${label}: ${imageLabel} sem credito.`);
      if (!image.status) fail(errors, `${label}: ${imageLabel} sem status de uso.`);

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
