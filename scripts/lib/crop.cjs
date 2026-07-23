/**
 * Foco de corte com rosto centralizado.
 *
 * Problema que resolve (REARQUITETURA-BRIEFING, bug 1 de 2026-07-23):
 * o preview desktop 16:9 de foto vertical cortava pelo centro geometrico e
 * decapitava o rosto.
 *
 * Cadeia de decisao, da melhor para a pior informacao:
 *  1. Deteccao de rosto real (Apple Vision, binario scripts/bin/detecta-rosto,
 *     compilado sob demanda a partir de detecta-rosto.swift). Com rosto(s),
 *     o foco e o centro da uniao das caixas de rosto.
 *  2. Sem rosto detectavel em foto vertical: terco superior (y=33%) — em
 *     retrato editorial o rosto fica acima do centro; melhor chute que o
 *     centro cego. (A estrategia "attention" do sharp foi testada e mira
 *     em regiao de contraste, ex. roupa neon, nao no rosto — descartada.)
 *  3. Foto horizontal sem rosto: centro (50/50), corte horizontal quase
 *     nunca decapita.
 */

const fs = require("fs");
const path = require("path");
const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const BIN_DIR = path.join(__dirname, "..", "bin");
const BIN = path.join(BIN_DIR, "detecta-rosto");
const FONTE_SWIFT = path.join(BIN_DIR, "detecta-rosto.swift");

let binarioDisponivel = null; // cache: true/false apos primeira checagem

function garantirBinario() {
  if (binarioDisponivel !== null) return binarioDisponivel;
  if (fs.existsSync(BIN)) {
    binarioDisponivel = true;
    return true;
  }
  try {
    execFileSync("swiftc", ["-O", "-o", BIN, FONTE_SWIFT], { timeout: 120000 });
    binarioDisponivel = fs.existsSync(BIN);
  } catch {
    binarioDisponivel = false;
  }
  return binarioDisponivel;
}

async function detectarRostos(filePath) {
  if (!garantirBinario()) return [];
  try {
    const { stdout } = await execFileAsync(BIN, [filePath], { timeout: 20000 });
    const parsed = JSON.parse(String(stdout || "").trim() || "{}");
    return Array.isArray(parsed.faces) ? parsed.faces : [];
  } catch {
    return [];
  }
}

async function dimensoes(filePath) {
  try {
    const sharp = require("sharp");
    const meta = await sharp(filePath).metadata();
    return { largura: meta.width || 0, altura: meta.height || 0 };
  } catch {
    return { largura: 0, altura: 0 };
  }
}

/**
 * Calcula o foco do corte para a imagem local.
 * Retorna { x, y, origem } com x/y em percentual (0-100) para
 * object-position, ou null se a imagem nao puder ser lida.
 * origem: "rosto" | "terco-superior" | "centro".
 */
async function focoDoCorte(filePath) {
  const { largura, altura } = await dimensoes(filePath);
  if (!largura || !altura) return null;
  const vertical = altura > largura;

  const rostos = await detectarRostos(filePath);
  if (rostos.length) {
    // Uniao das caixas (Vision usa coordenadas normalizadas com origem
    // no canto inferior esquerdo; y precisa ser invertido).
    let minX = 1, maxX = 0, minYV = 1, maxYV = 0;
    for (const r of rostos) {
      minX = Math.min(minX, r.x);
      maxX = Math.max(maxX, r.x + r.w);
      minYV = Math.min(minYV, r.y);
      maxYV = Math.max(maxYV, r.y + r.h);
    }
    const centroX = ((minX + maxX) / 2) * 100;
    const centroY = (1 - (minYV + maxYV) / 2) * 100;
    return {
      x: Math.round(Math.min(100, Math.max(0, centroX))),
      y: Math.round(Math.min(100, Math.max(0, centroY))),
      origem: "rosto",
    };
  }

  if (vertical) return { x: 50, y: 33, origem: "terco-superior" };
  return { x: 50, y: 50, origem: "centro" };
}

module.exports = { focoDoCorte };
