const fetch = require("node-fetch");
const fs = require("fs");
require("dotenv").config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error(
    "Erro: O token do GitHub não foi encontrado. Certifique-se de que o arquivo .env contém a variável GITHUB_TOKEN."
  );
  process.exit(1);
}

const csvPath = "bibliotecas_acessibilidade.csv";

function writeHeader() {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, "Repositorio,Autor,Estrelas,UltimoCommit\n");
  }
}

function appendToCSV(row) {
  const line = `${row.repo},${row.author},${row.stars},${row.lastCommit}\n`;
  fs.appendFileSync(csvPath, line);
}

async function graphqlRequest(query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Erro na solicitação GraphQL: ${response.statusText}`);
  }

  const data = await response.json();
  return data.data;
}

const searchRepositoriesQuery = `
query($queryString: String!, $first: Int!, $after: String) {
  search(query: $queryString, type: REPOSITORY, first: $first, after: $after) {
    repositoryCount
    edges {
      node {
        ... on Repository {
          name
          owner { login }
          stargazerCount
          pushedAt
          defaultBranchRef {
            name
            target {
              ... on Commit { committedDate oid }
            }
          }
          isFork
          isArchived
          url
        }
      }
    }
    pageInfo { endCursor hasNextPage }
  }
}
`;

// Abordagem generalizada (sem lista fixa):
// Combina termos base de acessibilidade com termos de papel (biblioteca/ferramenta)
const BASE_TERMS = [
  "accessibility",
  "a11y",
  "wcag",
  "aria",
  "inclusive design",
  "acessibilidade",
];

const ROLE_TERMS = [
  "cli",
  "checker",
  "validator",
  "validation",
  "lint",
  "linter",
  "rules",
  "rule",
  "plugin",
  "addon",
  "extension",
  "tool",
  "tooling",
  "toolkit",
  "library",
  "framework",
  "engine",
  "testing",
  "audit",
  "scanner",
];

function buildQueries() {
  const queries = [];
  for (const b of BASE_TERMS) {
    for (const r of ROLE_TERMS) {
      queries.push(`${b} ${r} in:name,description,readme sort:stars-desc`);
    }
  }
  // Pequeno seed para não perder libs amplamente conhecidas (opcional e curto)
  const SEEDED = [
    "axe-core",
    "pa11y",
    "lighthouse",
    "html-codesniffer",
    "webhint",
    "html-validate",
  ];
  for (const s of SEEDED) {
    queries.push(`${s} in:name,description,readme sort:stars-desc`);
  }
  return queries;
}

async function processQuery(queryString, processedSet) {
  let after = null;
  const first = 100; // máximo da API
  let saved = 0;
  let scanned = 0;

  while (true) {
    const variables = { queryString, first, after };
    const data = await graphqlRequest(searchRepositoriesQuery, variables);
    const edges = data.search.edges || [];
    if (edges.length === 0) break;

    for (const edge of edges) {
      const repo = edge.node;
      scanned++;
      const nameWithOwner = `${repo.owner.login}/${repo.name}`;
      if (processedSet.has(nameWithOwner)) continue;

      // Preferir committedDate do default branch; caso contrário usar pushedAt
      let lastCommit = repo.pushedAt || "";
      const target = repo.defaultBranchRef && repo.defaultBranchRef.target;
      if (target && target.committedDate) {
        lastCommit = target.committedDate;
      }

      appendToCSV({
        repo: nameWithOwner,
        author: repo.owner.login,
        stars: repo.stargazerCount,
        lastCommit: lastCommit,
      });
      processedSet.add(nameWithOwner);
      saved++;
    }

    if (!data.search.pageInfo.hasNextPage) break;
    after = data.search.pageInfo.endCursor;
  }

  return { saved, scanned };
}

async function main() {
  writeHeader();
  const queries = buildQueries();
  const processed = new Set();

  let totalSaved = 0;
  let totalScanned = 0;

  console.log(
    "🚀 Iniciando coleta de bibliotecas de ferramentas de acessibilidade..."
  );
  console.log(`📋 Total de termos: ${queries.length}`);

  for (const q of queries) {
    console.log(`\n🔎 Query: ${q}`);
    try {
      const { saved, scanned } = await processQuery(q, processed);
      totalSaved += saved;
      totalScanned += scanned;
      console.log(
        `✅ Salvos nesta query: ${saved} | 🔍 Analisados: ${scanned}`
      );
      await new Promise((r) => setTimeout(r, 750));
    } catch (e) {
      console.error(`❌ Erro na query: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  console.log("\n🎉 Concluído!");
  console.log(`📁 CSV gerado: ${csvPath}`);
  console.log(`📦 Repositórios únicos salvos: ${totalSaved}`);
  console.log(
    `🔍 Total analisado (com duplicatas entre queries): ${totalScanned}`
  );
}

main().catch((err) => {
  console.error("Erro fatal:", err);
  process.exit(1);
});
