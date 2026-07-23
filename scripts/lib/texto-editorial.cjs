/**
 * Regras editoriais de texto compartilhadas entre o gerador e o validador
 * da selecao interativa (e pelo builder de pacote da Etapa 5).
 *
 * Fonte da verdade unica: qualquer regra de fechamento, paragrafo minimo,
 * nota interna de apuracao ou acentuacao vive AQUI, nunca duplicada nos
 * scripts. Regra de evolucao do Regimento 03: bug objetivo e repetivel vira
 * validacao neste modulo, nao paragrafo novo no regimento.
 */

function bodyToParagraphs(body) {
  function stripPTags(text) {
    return String(text).replace(/<\/?p\s*\/?>/gi, "").trim();
  }
  if (Array.isArray(body)) return body.map((part) => stripPTags(part)).filter(Boolean);
  return String(body || "")
    .split(/\n{2,}/)
    .map((part) => stripPTags(part))
    .filter(Boolean);
}

function normalizeForCheck(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasFactualAnchor(paragraph) {
  const text = normalizeForCheck(paragraph);
  const factualPatterns = [
    /\b(nesta|neste|naquela|naquele|agora|hoje|amanha|ontem)\b/,
    /\b(segundo|de acordo com|conforme|afirmou|disse|contou|informou|anunciou|confirmou|revelou)\b/,
    /\b(sera|foi|acontece|acontecera|comeca|comecou|termina|terminou|estreia|estreou|volta|retorna|chega|lanca|lancou)\b/,
    /\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
    /\b\d{4}\b/,
    /\b(instagram|youtube|globoplay|netflix|max|disney\+|prime video|record|globo|sbt|uol|cnn)\b/,
    /\b(praia|hospital|tribunal|palco|turne|show|festival|cerimonia|gravidez|gestacao|licenca-maternidade|licenca maternidade)\b/,
  ];
  return factualPatterns.some((pattern) => pattern.test(text));
}

function isAbstractClosing(paragraph) {
  const text = normalizeForCheck(paragraph);
  const abstractPatterns = [
    /centro da conversa/,
    /movimenta a conversa/,
    /movimenta o debate/,
    /contexto pessoal importante/,
    /novo momento/,
    /nova fase/,
    /fase atual/,
    /fase artistica/,
    /funciona como vitrine/,
    /vitrine para/,
    /dialogo com o publico/,
    /dialoga com o publico/,
    /estrategic/,
    /circulacao ampla/,
    /reposicionamento/,
    /ganha forca nas redes/,
    /reacende a atencao/,
    /recoloca .* no centro/,
    /ajuda a dimensionar/,
    /ajuda a ampliar/,
    /protagonista/,
  ];
  return abstractPatterns.some((pattern) => pattern.test(text));
}

function hasHardBannedClosing(paragraph) {
  const text = normalizeForCheck(paragraph);
  const hardBannedPatterns = [
    /centro da conversa/,
    /contexto pessoal importante/,
    /viver esse novo momento/,
    /recoloca .* no centro/,
    /funciona como vitrine/,
    /compromisso pontual, mas estrategic/,
    /ajuda a ampliar o dialogo/,
    /ajuda a dimensionar/,
    /^por enquanto\b/,
    /^ate aqui\b/,
    /^o que esta confirmado\b/,
    /^o que fica confirmado\b/,
    /^neste momento,? o que esta confirmado\b/,
    /^os registros .* circularam/,
    /^com o .* (liberado|divulgado|oficializado|definido)/,
  ];
  return hardBannedPatterns.some((pattern) => pattern.test(text));
}

// Frases de nota interna de apuracao que NUNCA podem aparecer em texto que
// vai ao ar (ja vazou ao vivo em 22/07/2026). Comparar contra texto
// normalizado por normalizeForCheck.
const FRASES_NOTA_INTERNA = [
  "vale checar se",
  "vale checar",
  "vale a pena checar",
  "antes de publicacao",
  "antes da publicacao",
  "antes de publicar",
  "apuracao inicial",
  "na apuracao",
  "resta confirmar",
  "falta confirmar",
  "precisa confirmar",
  "ainda precisa ser confirmado",
];

function encontrarNotaInterna(texto) {
  const normalizado = normalizeForCheck(texto).replace(/\s+/g, " ");
  return FRASES_NOTA_INTERNA.find((frase) => normalizado.includes(frase)) || "";
}

// Mojibake classico de UTF-8 lido como Latin-1 ("Ã©", "Ã§", "Ã£"...).
// Se aparecer, a cadeia de publicacao corrompeu o encoding — falha tecnica.
function temMojibake(texto) {
  return /Ã[©§£µ¡¢³´ºªí­]|Ã‰|Ã‡|Âº|Â°|â€œ|â€|â€™/.test(String(texto || ""));
}

// Heuristica de texto sem acento: portugues real tem acento com frequencia.
// Um corpo de materia (800+ chars) com ZERO caracteres acentuados quase
// certamente foi escrito sem acentuacao (erro de 19/07/2026).
function pareceSemAcento(texto) {
  const t = String(texto || "");
  if (t.length < 400) return false;
  return !/[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/.test(t);
}

module.exports = {
  bodyToParagraphs,
  normalizeForCheck,
  hasFactualAnchor,
  isAbstractClosing,
  hasHardBannedClosing,
  FRASES_NOTA_INTERNA,
  encontrarNotaInterna,
  temMojibake,
  pareceSemAcento,
};
