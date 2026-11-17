// Reescreve a lista de contribuições open source do README, entre os
// marcadores OSS:START e OSS:END, a partir dos PRs mergeados em
// repositórios que não são do dono do perfil.
//
// Uso: OWNER=TrindadeThiago node scripts/oss-contributions.mjs
// Precisa do `gh` autenticado (GH_TOKEN no Actions).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const owner = process.env.OWNER;
if (!owner) throw new Error("defina OWNER");

const README = "README.md";
const OVERRIDES = "oss-descriptions.json";
const START = "<!-- OSS:START -->";
const END = "<!-- OSS:END -->";

const gh = (args) => execFileSync("gh", args, { encoding: "utf8" });

const prs = JSON.parse(
  gh([
    "search", "prs",
    "--author", owner,
    "--merged",
    "--limit", "200",
    "--json", "repository,number,title,url,closedAt",
    "--", `-user:${owner}`,
  ]),
);

// `descriptions`: texto escrito à mão, que ganha da descrição do repositório.
// `ignore`: repositórios ("dono/nome") que não entram na lista.
const config = existsSync(OVERRIDES)
  ? JSON.parse(readFileSync(OVERRIDES, "utf8"))
  : {};
const overrides = config.descriptions ?? {};
const ignore = new Set(config.ignore ?? []);

const byRepo = new Map();
for (const pr of prs) {
  const name = pr.repository.nameWithOwner;
  if (ignore.has(name)) continue;
  if (!byRepo.has(name)) byRepo.set(name, []);
  byRepo.get(name).push(pr);
}

const repos = [...byRepo.entries()]
  .map(([name, list]) => {
    list.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    return { name, list, latest: list[0].closedAt };
  })
  .sort((a, b) => b.latest.localeCompare(a.latest));

const describe = (name) => {
  if (overrides[name]) return overrides[name];
  try {
    return gh(["api", `repos/${name}`, "--jq", ".description // \"\""]).trim();
  } catch {
    return "";
  }
};

// Evita que um título de PR quebre o Markdown.
const escape = (s) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");

const lines = [];
for (const { name, list } of repos) {
  const short = name.split("/")[1];
  const desc = describe(name);
  lines.push(`- **[${short}](https://github.com/${name})**${desc ? `: ${desc}` : ""}`);
  for (const pr of list) {
    lines.push(`  - [#${pr.number}](${pr.url}): ${escape(pr.title)}`);
  }
}
if (lines.length === 0) lines.push("- Em breve.");

const readme = readFileSync(README, "utf8");
const i = readme.indexOf(START);
const j = readme.indexOf(END);
if (i < 0 || j < i) throw new Error(`marcadores ${START} / ${END} não encontrados`);

const next =
  readme.slice(0, i + START.length) + "\n" + lines.join("\n") + "\n" + readme.slice(j);

if (next === readme) {
  console.log("Sem mudanças.");
} else {
  writeFileSync(README, next);
  console.log(`Atualizado: ${repos.reduce((n, r) => n + r.list.length, 0)} PR(s) em ${repos.length} repositório(s).`);
}
