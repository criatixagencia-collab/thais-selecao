/**
 * Estado do pipeline do dia (data/pipeline-estado.json).
 *
 * Cada etapa registra onde o dia esta, para:
 *  - re-runs reutilizarem a mesma pasta de selecao (fim das orfas
 *    0905/0907/0910 do mesmo run logico);
 *  - `npm run status` mostrar em que etapa a selecao do dia parou;
 *  - a Thais nao depender de memoria de conversa para saber o proximo passo.
 */

const path = require("path");
const { lerJson, gravarJson } = require("./http.cjs");

const ROOT = path.resolve(__dirname, "../..");
const ARQ_ESTADO = path.join(ROOT, "data", "pipeline-estado.json");

function diaHoje() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lerEstado() {
  return lerJson(ARQ_ESTADO, {});
}

/** Estado do dia corrente (zera automaticamente quando o dia vira). */
function estadoDoDia() {
  const estado = lerEstado();
  if (estado.dia !== diaHoje()) return { dia: diaHoje() };
  return estado;
}

function atualizarEstado(mudancas) {
  const estado = estadoDoDia();
  const novo = { ...estado, ...mudancas, dia: diaHoje(), atualizadoEm: new Date().toISOString() };
  gravarJson(ARQ_ESTADO, novo);
  return novo;
}

module.exports = { lerEstado, estadoDoDia, atualizarEstado, diaHoje };
