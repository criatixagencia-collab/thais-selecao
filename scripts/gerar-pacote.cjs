#!/usr/bin/env node
/**
 * Etapa 5 (preparacao) — builder oficial do pacote de publicacao.
 *
 * Substitui o node inline que a Thais improvisava na conversa: converte a
 * selecao aprovada (data.json da pasta da selecao) no pacote JSON que o
 * workspace-entreteu/blogger publica, de forma deterministica e com todas
 * as travas do Regimento 03 aplicadas ANTES de salvar.
 *
 * Uso:
 *   npm run etapa5 -- --dir selecao20260723-0910 --aprovadas "1:1,2:3,3:embed1"
 *
 * "materia:escolha" onde escolha e o numero da opcao de imagem (1-based)
 * ou "embedN" para publicar com embed oficial do Instagram.
 *
 * O pacote sai em workspace-entreteu/blogger/data/ e ja passa pelo
 * posts:validate-package --live. Publicar continua sendo um passo separado
 * (posts:publish:live), como manda o Regimento.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { atualizarEstado } = require("./lib/estado.cjs");
const {
  bodyToParagraphs,
  encontrarNotaInterna,
  temMojibake,
  pareceSemAcento,
} = require("./lib/texto-editorial.cjs");

const root = path.resolve(__dirname, "..");
const BLOGGER_ROOT = "/Volumes/PortableSSD/openclaw-state/workspace-entreteu/blogger";
const PAGES_BASE = "https://criatixagencia-collab.github.io/thais-selecao";
const STATUS_PRINCIPAL_OK = new Set(["licenciada", "autorizada"]);

function parseArgs(argv) {
  const args = { dir: "", aprovadas: "", out: "", skipValidate: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--dir" && next) { args.dir = next; i += 1; }
    else if (current === "--aprovadas" && next) { args.aprovadas = next; i += 1; }
    else if (current === "--out" && next) { args.out = next; i += 1; }
    else if (current === "--skip-validate") { args.skipValidate = true; }
  }
  if (!args.dir || !args.aprovadas) {
    console.error('Uso: npm run etapa5 -- --dir selecaoAAAAMMDD-HHMM --aprovadas "1:1,2:3,3:embed1"');
    process.exit(1);
  }
  return args;
}

function parseAprovadas(spec) {
  const escolhas = [];
  for (const parte of String(spec).split(",")) {
    const m = parte.trim().match(/^(\d+)\s*:\s*(embed)?(\d+)$/i);
    if (!m) throw new Error(`Aprovacao invalida: "${parte}". Use materia:opcao (ex. 2:3) ou materia:embedN (ex. 3:embed1).`);
    escolhas.push({ num: Number(m[1]), embed: Boolean(m[2]), opcao: Number(m[3]) });
  }
  if (!escolhas.length) throw new Error("Nenhuma aprovacao informada.");
  return escolhas;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function categoriaLimpa(category) {
  return String(category || "Entretenimento").replace(/^\[|\]$/g, "").trim();
}

function checarPortugues(item, campos, errors) {
  for (const [campo, valor] of Object.entries(campos)) {
    const nota = encontrarNotaInterna(valor);
    if (nota) errors.push(`"${item.title}": ${campo} contem nota interna de apuracao ("${nota}").`);
    if (temMojibake(valor)) errors.push(`"${item.title}": ${campo} contem mojibake (encoding quebrado).`);
  }
  if (pareceSemAcento(campos.body)) {
    errors.push(`"${item.title}": corpo sem NENHUM acento — reprovado pela Etapa 4.5 (revisao de portugues).`);
  }
}

function urlPublica(dirName, localUrl) {
  return `${PAGES_BASE}/${dirName}/${String(localUrl).replace(/^\/+/, "")}`;
}

function montarHtmlImagem(item, imagem, dirName) {
  const src = urlPublica(dirName, imagem.url);
  return (
    `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(item.title)}" />` +
    `<figcaption>${escapeHtml(imagem.credit)}</figcaption></figure>`
  );
}

function montarHtmlEmbed(embed) {
  const url = escapeHtml(embed.embedUrl);
  return (
    `<blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14">` +
    `<a href="${url}">Ver post no Instagram (${escapeHtml(embed.credit)})</a></blockquote>` +
    '<script async src="https://www.instagram.com/embed.js"></script>'
  );
}

function montarPost(item, escolha, dirName, avisos, errors) {
  const paragraphs = Array.isArray(item.paragraphs) && item.paragraphs.length
    ? item.paragraphs
    : bodyToParagraphs(item.body);
  const line = String(item.line || "").trim();
  if (!line) errors.push(`"${item.title}": sem linha de apoio.`);

  checarPortugues(item, { title: item.title, line, body: paragraphs.join("\n\n") }, errors);

  let visualHtml = "";
  const post = {
    slug: item.slug,
    title: item.title,
    approvedStatus: "aprovado_para_live_regimento_03",
    lineOfSupport: line,
    subtitle: line,
    labels: ["Home", categoriaLimpa(item.category), "Thais", "Aprovado"],
    category: categoriaLimpa(item.category),
    sources: item.sources || [],
    sourceSelection: dirName,
    editorialAlert: item.editorialAlert || "",
  };

  if (escolha.embed) {
    const embed = (item.embedOptions || [])[escolha.opcao - 1];
    if (!embed) {
      errors.push(`"${item.title}": embed ${escolha.opcao} nao existe (ha ${(item.embedOptions || []).length}).`);
      return null;
    }
    const temLicenciada = (item.imageOptions || []).some((img) => STATUS_PRINCIPAL_OK.has(String(img.status || "").toLowerCase()));
    if (temLicenciada) {
      avisos.push(`"${item.title}": publicando com embed, mas ha imagem licenciada/autorizada disponivel — Regimento prefere imagem direta; confirme que a escolha e intencional.`);
    }
    visualHtml = montarHtmlEmbed(embed);
    post.selectedVisual = {
      type: "embed_instagram",
      embedUrl: embed.embedUrl,
      credit: embed.credit,
      sourceUrl: embed.sourceUrl || embed.embedUrl,
      status: "usar via embed",
    };
    post.imageCredit = embed.credit;
    post.imageStatus = "usar via embed";
    post.imageSourceUrl = embed.sourceUrl || embed.embedUrl;
  } else {
    const imagem = (item.imageOptions || [])[escolha.opcao - 1];
    if (!imagem) {
      errors.push(`"${item.title}": opcao de imagem ${escolha.opcao} nao existe (ha ${(item.imageOptions || []).length}).`);
      return null;
    }
    const status = String(imagem.status || "").toLowerCase();
    if (!STATUS_PRINCIPAL_OK.has(status)) {
      errors.push(
        `"${item.title}": opcao ${escolha.opcao} esta como "${imagem.status}" e nao pode ser imagem principal ` +
        `(Regimento exige licenciada/autorizada). Escolha outra opcao ou publique via embed oficial.`,
      );
      return null;
    }
    visualHtml = montarHtmlImagem(item, imagem, dirName);
    post.selectedImage = {
      option: escolha.opcao,
      url: urlPublica(dirName, imagem.url),
      credit: imagem.credit,
      status: imagem.status,
      sourceUrl: imagem.sourceUrl || "",
    };
    post.imageCredit = imagem.credit;
    post.imageStatus = imagem.status;
    post.imageSourceUrl = imagem.sourceUrl || "";
  }

  post.imageCandidates = (item.imageOptions || []).map((img, i) => ({
    option: i + 1,
    url: urlPublica(dirName, img.url),
    credit: img.credit,
    status: img.status,
    sourceUrl: img.sourceUrl || "",
  }));

  const corpoHtml = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  post.contentHtml = `${visualHtml}<p><strong>${escapeHtml(line)}</strong></p>${corpoHtml}`;
  return post;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dirName = path.basename(args.dir);
  const dataPath = path.join(root, dirName, "data.json");
  if (!fs.existsSync(dataPath)) {
    console.error(`Selecao nao encontrada: ${dirName}/data.json`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const items = Array.isArray(data.items) ? data.items : [];
  const escolhas = parseAprovadas(args.aprovadas);

  const errors = [];
  const avisos = [];
  const posts = [];
  for (const escolha of escolhas) {
    const item = items.find((i) => Number(i.num) === escolha.num);
    if (!item) {
      errors.push(`Materia ${escolha.num} nao existe na selecao ${dirName}.`);
      continue;
    }
    const post = montarPost(item, escolha, dirName, avisos, errors);
    if (post) posts.push(post);
  }

  for (const aviso of avisos) console.warn(`⚠ ${aviso}`);
  if (errors.length) {
    console.error("\nPacote NAO gerado. Corrija antes:");
    for (const e of errors) console.error(`- ${e}`);
    process.exit(1);
  }

  const agora = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const stamp = `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}`;
  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(BLOGGER_ROOT, "data", `pacote-thais-${stamp}-${dirName.replace(/^selecao-?/, "selecao")}-live.json`);

  const pacote = {
    packageStatus: "aprovado_para_live_regimento_03",
    approvedStatus: "aprovado_por_rafael",
    sourceSelection: dirName,
    approvedAt: agora.toISOString(),
    count: posts.length,
    posts,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(pacote, null, 2), "utf8");
  console.log(`Pacote gerado: ${outPath}`);
  console.log(`Posts: ${posts.length}`);
  atualizarEstado({ etapa: 5, pacote: outPath });

  if (!args.skipValidate) {
    console.log("\nValidando com posts:validate-package --live...");
    const result = spawnSync("npm", ["run", "posts:validate-package", "--", `--input=${outPath}`, "--live"], {
      cwd: BLOGGER_ROOT,
      encoding: "utf8",
    });
    process.stdout.write(result.stdout || "");
    process.stderr.write(result.stderr || "");
    if (result.status !== 0) {
      console.error("\nValidacao do pacote FALHOU. Nao publicar.");
      process.exit(1);
    }
  }

  console.log("\nProximo passo (publicacao ao vivo, conferir antes):");
  console.log(`  cd ${BLOGGER_ROOT} && npm run posts:publish:live -- --input=${outPath}`);
}

main();
