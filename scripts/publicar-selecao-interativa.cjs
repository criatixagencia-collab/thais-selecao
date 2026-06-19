#!/usr/bin/env node
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");

function parseArgs(argv) {
  const args = {
    generatorArgs: [],
    slug: "",
    noCommit: false,
    noPush: false,
    message: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--slug" && next) {
      args.slug = next;
      args.generatorArgs.push(current, next);
      i += 1;
    } else if (current === "--no-commit") {
      args.noCommit = true;
    } else if (current === "--no-push") {
      args.noPush = true;
    } else if (current === "--message" && next) {
      args.message = next;
      i += 1;
    } else {
      args.generatorArgs.push(current);
    }
  }

  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
  return result;
}

function parseOutputDir(output, slug) {
  if (slug) return slug;
  const match = output.match(/Selecao interativa gerada:\s+(.+?)\/index\.html/);
  if (!match) {
    console.error("Nao consegui identificar a pasta gerada. Use --slug selecao-AAAAMMDD-HHMM.");
    process.exit(1);
  }
  return match[1];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const generator = path.join("scripts", "gerar-selecao-interativa.cjs");
  const validator = path.join("scripts", "validar-selecao-interativa.cjs");

  console.log("1/4 Gerando selecao interativa pelo gerador oficial...");
  const generated = run(process.execPath, [generator, ...args.generatorArgs]);
  const outputDir = parseOutputDir(`${generated.stdout || ""}\n${generated.stderr || ""}`, args.slug);

  console.log("\n2/4 Validando selecao gerada...");
  run(process.execPath, [validator, "--dir", outputDir]);

  if (args.noCommit) {
    console.log("\nValidada sem commit por --no-commit.");
    return;
  }

  console.log("\n3/4 Preparando commit apenas da pasta gerada...");
  run("git", ["add", "--", outputDir]);

  const status = spawnSync("git", ["status", "--short", "--", outputDir], {
    cwd: root,
    encoding: "utf8",
  });
  if (status.status !== 0) {
    process.stderr.write(status.stderr || "");
    process.exit(status.status || 1);
  }
  if (!status.stdout.trim()) {
    console.log("Nada novo para commitar na pasta gerada.");
  } else {
    const message = args.message || `Publica selecao interativa ${outputDir}`;
    run("git", ["commit", "-m", message]);
  }

  if (args.noPush) {
    console.log("\nCommit local pronto; push pulado por --no-push.");
    return;
  }

  console.log("\n4/4 Publicando no GitHub Pages...");
  run("git", ["push", "origin", "main"]);
  console.log(`Selecao publicada: https://criatixagencia-collab.github.io/thais-selecao/${outputDir}/index.html`);
}

main();
