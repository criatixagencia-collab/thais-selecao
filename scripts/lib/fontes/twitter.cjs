/**
 * X/Twitter oficial via twitter-cli local — terceira prioridade.
 * Handles vem declarados na materia (imagem.twitter) ou de
 * data/twitter-profiles.json. Passa por orcamento e cooldown.
 */

const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const {
  consumirOrcamento,
  perfilEmCooldown,
  registrarFalhaPerfil,
  limparFalhaPerfil,
} = require("../http.cjs");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../../..");
const TWITTER_TIMEOUT_MS = Number(process.env.THAIS_TWITTER_TIMEOUT_MS || 25000);

function normalizarHandle(perfil) {
  return String(perfil || "").trim().replace(/^@/, "").toLowerCase();
}

async function cli(args, maxBuffer = 1024 * 1024) {
  const { stdout } = await execFileAsync("twitter", args, {
    cwd: ROOT,
    timeout: TWITTER_TIMEOUT_MS,
    maxBuffer,
  });
  return JSON.parse(String(stdout || "").trim() || "{}");
}

function mediaParaResultados(perfil, tweets) {
  const resultados = [];
  for (const tweet of Array.isArray(tweets) ? tweets : []) {
    for (const item of Array.isArray(tweet?.media) ? tweet.media : []) {
      const mediaUrl = String(item?.url || "").trim();
      if (!mediaUrl || String(item?.type || "").toLowerCase() !== "photo") continue;
      resultados.push({
        urlOriginal: mediaUrl,
        fonte: `X/Twitter @${perfil}`,
        credito: `Foto: Reprodução/X/@${perfil}`,
        status: "usar com cautela",
        pagina: tweet?.id ? `https://x.com/${perfil}/status/${tweet.id}` : `https://x.com/${perfil}`,
        timestamp: tweet?.createdAtISO || new Date().toISOString(),
      });
      if (resultados.length >= 3) return resultados;
    }
  }
  return resultados;
}

async function buscarTwitter(perfilBruto) {
  const perfil = normalizarHandle(perfilBruto);
  if (!perfil) return { resultados: [], erro: "" };

  const chaveCooldown = `twitter:@${perfil}`;
  if (perfilEmCooldown(chaveCooldown)) {
    return { resultados: [], erro: `@${perfil} em cooldown por falha recente` };
  }
  if (!consumirOrcamento("twitter_cli")) {
    return { resultados: [], erro: "orcamento diario do twitter-cli esgotado" };
  }

  let profile;
  try {
    const parsed = await cli(["user", perfil, "--json"]);
    profile = parsed?.ok && parsed?.data?.screenName ? parsed.data : null;
  } catch {
    profile = null;
  }
  if (!profile) {
    registrarFalhaPerfil(chaveCooldown, "perfil nao validado via twitter-cli");
    return { resultados: [], erro: `perfil nao validado via twitter-cli: @${perfil}` };
  }

  try {
    const parsed = await cli(["user-posts", perfil, "-n", "6", "--json"], 2 * 1024 * 1024);
    const resultados = mediaParaResultados(perfil, Array.isArray(parsed?.data) ? parsed.data : []);
    if (resultados.length) {
      limparFalhaPerfil(chaveCooldown);
      return { resultados, erro: "" };
    }
  } catch (error) {
    registrarFalhaPerfil(chaveCooldown, error?.message);
  }

  const profileImageUrl = String(profile.profileImageUrl || "").trim();
  if (profileImageUrl) {
    return {
      resultados: [{
        urlOriginal: profileImageUrl,
        fonte: `X/Twitter @${perfil}`,
        credito: `Foto: Reprodução/X/@${perfil}`,
        status: "usar com cautela",
        pagina: `https://x.com/${perfil}`,
        timestamp: new Date().toISOString(),
      }],
      erro: "",
    };
  }
  return { resultados: [], erro: `X/Twitter sem media de imagem utilizavel: @${perfil}` };
}

module.exports = { buscarTwitter, normalizarHandle };
