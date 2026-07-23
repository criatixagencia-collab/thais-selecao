#!/usr/bin/env node
/**
 * Etapa 3 — busca e download de imagens candidatas por materia.
 *
 * Le data/selecao-pronta.json, busca candidatas via orquestrador (escada de
 * prioridade do Regimento 03, cache e orcamento na camada HTTP) e baixa os
 * arquivos para imagens-workdir/AAAAMMDD/ (pasta unica do dia, reutilizada
 * em re-runs). NAO cria pasta de selecao: isso e papel do gerador da
 * Etapa 4, que copia dali para a pasta final.
 *
 * Escreve de volta em cada materia:
 *   imagens[]        candidatas baixadas (com credito/status/pagina)
 *   visuaisEmbed[]   candidatos de embed oficial (Instagram), sem download
 *   pendenciasImagem[] o que faltou/falhou, para a Thais reportar ao Rafael
 *
 * Uso: npm run etapa3  (alias: imagens:multi)
 */

const fs = require("fs");
const path = require("path");
const { setTimeout: sleep } = require("timers/promises");
const { carregarEnvLocal } = require("./lib/http.cjs");
const { buscarMultiOpcoes } = require("./lib/orquestrador-imagens.cjs");
const { baixarImagem } = require("./lib/download.cjs");

carregarEnvLocal();

const PAUSA_ENTRE_DOWNLOADS_MS = 400;
const ROOT = path.resolve(__dirname, "..");
const DATA_PATH = path.join(ROOT, "data", "selecao-pronta.json");

function pastaDoDia() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

async function main() {
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

  const dia = pastaDoDia();
  const workdirRel = path.join("imagens-workdir", dia);
  const workdir = path.join(ROOT, workdirRel);
  fs.mkdirSync(workdir, { recursive: true });

  console.log(`\n📸 Buscando imagens para ${items.length} materia(s)`);
  console.log(`📁 Workdir do dia: ${workdirRel}/\n`);

  let totalOpcoes = 0;
  let totalEmbeds = 0;
  let totalPendentes = 0;

  for (let idx = 0; idx < items.length; idx += 1) {
    const artigo = items[idx];
    const titulo = artigo.title || artigo.tit || `Materia ${idx + 1}`;
    process.stdout.write(`  🔍 ${titulo.slice(0, 55)}... `);

    try {
      const { opcoes, embeds, pendencias } = await buscarMultiOpcoes(artigo);

      const imagensBaixadas = [];
      for (let oi = 0; oi < opcoes.length; oi += 1) {
        if (oi > 0) await sleep(PAUSA_ENTRE_DOWNLOADS_MS);
        const op = opcoes[oi];
        const nomeBase = `m${String(artigo.num || idx + 1).padStart(2, "0")}-${titulo.slice(0, 24)}-${oi}`;
        const result = await baixarImagem(op.urlOriginal, workdir, nomeBase, { rootRelativo: workdirRel });
        if (!result) continue;
        imagensBaixadas.push({
          url: result.srcLocal,
          srcLocal: result.srcLocal,
          urlOriginal: op.urlOriginal || "",
          fonte: op.fonte || "",
          credito: op.credito || "",
          status: op.status || "usar com cautela",
          pagina: op.pagina || "",
          observacao: op.observacao || "",
          label: `Opcao ${imagensBaixadas.length + 1}`,
        });
      }

      artigo.imagens = imagensBaixadas;
      artigo.imgs = imagensBaixadas;
      artigo.visuaisEmbed = embeds;
      artigo.pendenciasImagem = pendencias;
      if (!imagensBaixadas.length) {
        artigo.statusImagem = "pendente - nenhuma imagem baixada";
        totalPendentes += 1;
      } else {
        delete artigo.statusImagem;
      }
      totalOpcoes += imagensBaixadas.length;
      totalEmbeds += embeds.length;

      const porFonte = (prefixo) => imagensBaixadas.filter((i) => i.fonte.startsWith(prefixo)).length;
      console.log(
        `${imagensBaixadas.length ? "✅" : "❌"} ${imagensBaixadas.length} ` +
        `(Wiki:${porFonte("Wikimedia")} Insta:${porFonte("Instagram")} X:${porFonte("X/Twitter")} DDG:${porFonte("DuckDuckGo")}` +
        `${embeds.length ? ` +${embeds.length} embed` : ""})` +
        `${pendencias.length ? ` ⚠ ${pendencias.length} pendencia(s)` : ""}`,
      );
      for (const p of pendencias) console.log(`     ⚠ ${p}`);
    } catch (err) {
      artigo.imagens = [];
      artigo.statusImagem = "pendente - erro na busca";
      artigo.pendenciasImagem = [err.message];
      totalPendentes += 1;
      console.log(`❌ erro: ${err.message}`);
    }
  }

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");

  console.log(`\n📊 RESUMO:`);
  console.log(`  Materias: ${items.length}`);
  console.log(`  Imagens baixadas: ${totalOpcoes}`);
  console.log(`  Candidatos a embed: ${totalEmbeds}`);
  console.log(`  Materias sem imagem: ${totalPendentes}`);
  console.log(`  Workdir: ${workdirRel}/`);
  console.log(`  JSON atualizado: data/selecao-pronta.json`);
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
