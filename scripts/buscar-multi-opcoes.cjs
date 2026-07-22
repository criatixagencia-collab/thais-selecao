const fs = require("fs");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");
const { buscarMultiOpcoes, baixarImagem } = require("./lib/buscar-imagens.cjs");

// Espaçamento entre downloads para não gerar rajada de requisições
// (o Wikimedia, entre outras fontes, limita taxa de pedidos por IP).
const PAUSA_ENTRE_DOWNLOADS_MS = 400;

const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "selecao-pronta.json");

function pad(v) { return String(v).padStart(2, "0"); }
function makeSlug(date) {
  return `selecao-${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

async function main() {
  // 1. Ler JSON de entrada
  if (!fs.existsSync(DATA_PATH)) {
    console.error("❌ data/selecao-pronta.json nao encontrado");
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];

  if (!items.length) {
    console.error("❌ Nenhuma materia encontrada no JSON");
    process.exit(1);
  }

  const agora = new Date();
  const slug = makeSlug(agora);
  const dir = path.join(ROOT, slug);
  const imgDir = path.join(dir, "imagens");
  fs.mkdirSync(imgDir, { recursive: true });

  console.log(`\n📸 Buscando imagens para ${items.length} materia(s)`);
  console.log(`📁 Pasta: ${slug}\n`);

  let totalOpcoes = 0;
  let totalPendentes = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const artigo = items[idx];
    const titulo = artigo.title || artigo.tit || `Materia ${idx + 1}`;
    const nomeBase = titulo.slice(0, 40);

    process.stdout.write(`  🔍 ${titulo.slice(0, 50)}... `);

    try {
      const opcoes = await buscarMultiOpcoes(artigo);

      if (!opcoes.length) {
        artigo.imagens = [];
        artigo.statusImagem = "pendente - nenhuma imagem encontrada";
        totalPendentes++;
        console.log(`❌ 0 opcoes`);
        continue;
      }

      // Baixar cada opcao
      const imagensBaixadas = [];
      for (let oi = 0; oi < opcoes.length; oi++) {
        if (oi > 0) await sleep(PAUSA_ENTRE_DOWNLOADS_MS);
        const op = opcoes[oi];
        const result = await baixarImagem(op.urlOriginal, imgDir, `${nomeBase.slice(0, 20)}-${oi}`);
        if (result) {
          imagensBaixadas.push({
            url: result.srcLocal,
            srcLocal: result.srcLocal,
            urlOriginal: op.urlOriginal || "",
            fonte: op.fonte || "",
            credito: op.credito || "",
            status: op.status || "usar com cautela",
            pagina: op.pagina || "",
            label: `Opcao ${oi + 1}`,
          });
        }
      }

      artigo.imagens = imagensBaixadas;
      artigo.imgs = imagensBaixadas;
      // Garantir que 'pagina' e 'urlOriginal' sejam salvos mesmo quando imagem ja existia
      for (const img of artigo.imagens) {
        if (!img.pagina && !img.source && !img.sourceUrl) img.pagina = "";
        if (!img.urlOriginal) img.urlOriginal = img.url || img.src || "";
      }
      if (imagensBaixadas.length === 0) {
        artigo.statusImagem = "pendente - downloads falharam";
        totalPendentes++;
      }
      totalOpcoes += imagensBaixadas.length;

      // Log resumido
      const insta = imagensBaixadas.filter(i => i.fonte.startsWith("Instagram")).length;
      const twitter = imagensBaixadas.filter(i => i.fonte.startsWith("X/Twitter")).length;
      const ddg = imagensBaixadas.filter(i => i.fonte.startsWith("DuckDuckGo")).length;
      const wiki = imagensBaixadas.filter(i => i.fonte.startsWith("Wikimedia")).length;
      const status = imagensBaixadas.length > 0 ? `✅ ${imagensBaixadas.length} (Insta:${insta} X:${twitter} DDG:${ddg} Wiki:${wiki})` : "❌ 0";
      console.log(status);
    } catch (err) {
      artigo.imagens = [];
      artigo.statusImagem = "pendente - erro na busca";
      totalPendentes++;
      console.log(`❌ erro: ${err.message}`);
    }
  }

  // Salvar JSON atualizado
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");

  // Criar data.json para a pasta
  fs.writeFileSync(
    path.join(dir, "data.json"),
    JSON.stringify({ items, generatedAt: agora.toISOString() }, null, 2),
    "utf8"
  );

  // Copiar imagens para o local esperado pelo gerador
  const rootImgDir = path.join(ROOT, "imagens");
  fs.mkdirSync(rootImgDir, { recursive: true });
  if (fs.existsSync(imgDir)) {
    const files = fs.readdirSync(imgDir);
    for (const f of files) {
      const src = path.join(imgDir, f);
      const dst = path.join(rootImgDir, f);
      if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
  }

  console.log(`\n📊 RESUMO:`);
  console.log(`  Total de materias: ${items.length}`);
  console.log(`  Total de imagens baixadas: ${totalOpcoes}`);
  console.log(`  Materias sem imagem: ${totalPendentes}`);
  console.log(`  Pasta da selecao: ${slug}/`);
  console.log(`  JSON atualizado: data/selecao-pronta.json`);
  console.log(`  Data JSON da selecao: ${slug}/data.json`);
}

main().catch(err => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
