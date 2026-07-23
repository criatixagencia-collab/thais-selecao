#!/usr/bin/env node
/**
 * `npm run status` — onde o pipeline do dia esta.
 * Mostra etapa atual, pasta da selecao, orcamento consumido e cooldowns.
 */

const fs = require("node:fs");
const path = require("node:path");
const { estadoDoDia } = require("./lib/estado.cjs");
const { lerJson, CACHE_DIR, orcamentoRestante } = require("./lib/http.cjs");

const NOMES_ETAPA = {
  1: "Etapa 1 - cardapio",
  2: "Etapa 2 - apuracao",
  3: "Etapa 3 - imagens",
  4: "Etapa 4 - selecao interativa",
  4.5: "Etapa 4.5 - revisao de portugues",
  5: "Etapa 5 - pacote/publicacao",
};

function main() {
  const estado = estadoDoDia();
  console.log(`\n📍 Pipeline da Thais — ${estado.dia}`);
  if (!estado.etapa) {
    console.log("  Nenhuma etapa registrada hoje. Comece pelo cardapio (Etapa 1).");
  } else {
    console.log(`  Ultima etapa concluida: ${NOMES_ETAPA[estado.etapa] || estado.etapa}`);
    if (estado.selecaoDir) console.log(`  Selecao do dia: ${estado.selecaoDir}`);
    if (estado.workdir) console.log(`  Workdir de imagens: ${estado.workdir}`);
    if (estado.pacote) console.log(`  Pacote gerado: ${estado.pacote}`);
    if (Array.isArray(estado.publicadas) && estado.publicadas.length) {
      console.log(`  Publicadas hoje: ${estado.publicadas.length}`);
      for (const u of estado.publicadas) console.log(`    - ${u}`);
    }
  }

  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  const orcArq = path.join(CACHE_DIR, `orcamento-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`);
  const orc = lerJson(orcArq, {});
  console.log("\n💸 Orcamento de requisicoes de hoje (usado / restante):");
  for (const fonte of ["wikimedia_api", "apify_runs", "twitter_cli", "ddg_buscas", "downloads"]) {
    console.log(`  ${fonte}: ${orc[fonte] || 0} usado, ${orcamentoRestante(fonte)} restante`);
  }

  const falhas = lerJson(path.join(CACHE_DIR, "perfis-falha.json"), {});
  const chaves = Object.keys(falhas);
  if (chaves.length) {
    console.log("\n🧊 Perfis com falha registrada (cooldown progressivo):");
    for (const chave of chaves) {
      console.log(`  ${chave}: ${falhas[chave].falhas} falha(s), ultima ${falhas[chave].ultimaFalha} (${falhas[chave].motivo})`);
    }
  }
  console.log("");
}

main();
