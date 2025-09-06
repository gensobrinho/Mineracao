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

const csvPath = "repositorios_acessibilidade.csv";

function writeHeader() {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, "Nome do Repositório,Número de Estrelas,Se há AXE em workflow,Se há AXE em Dependências,Se há Pa11y em Workflow,Se há Pa11y em Dependencias,Se há WAVE em Dependências,Se há WAVE em Workflow\n");
  }
}

function appendToCSV(row) {
  const line = `${row.repo},${row.stars},${row.hasAxeWorkflow},${row.hasAxeDeps},${row.hasPa11yWorkflow},${row.hasPa11yDeps},${row.hasWaveDeps},${row.hasWaveWorkflow}\n`;
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

// Query para buscar arquivos de workflow
const workflowFilesQuery = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    object(expression: "HEAD:.github/workflows") {
      ... on Tree {
        entries {
          name
          object {
            ... on Blob {
              text
            }
          }
        }
      }
    }
  }
}
`;

// Query para buscar arquivos de dependências (package.json, requirements.txt, etc.)
const dependenciesFilesQuery = `
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    packageJson: object(expression: "HEAD:package.json") {
      ... on Blob {
        text
      }
    }
    requirementsTxt: object(expression: "HEAD:requirements.txt") {
      ... on Blob {
        text
      }
    }
    composerJson: object(expression: "HEAD:composer.json") {
      ... on Blob {
        text
      }
    }
    gemfile: object(expression: "HEAD:Gemfile") {
      ... on Blob {
        text
      }
    }
  }
}
`;

async function checkToolInWorkflows(owner, repoName) {
  try {
    const variables = { owner, name: repoName };
    const data = await graphqlRequest(workflowFilesQuery, variables);
    
    if (!data.repository?.object?.entries) {
      return { hasAxe: false, hasPa11y: false, hasWave: false };
    }

    let hasAxe = false;
    let hasPa11y = false;
    let hasWave = false;

    for (const entry of data.repository.object.entries) {
      const content = entry.object?.text || "";
      const lowerContent = content.toLowerCase();
      
      if (lowerContent.includes("axe") || lowerContent.includes("axe-core")) {
        hasAxe = true;
      }
      if (lowerContent.includes("pa11y")) {
        hasPa11y = true;
      }
      if (lowerContent.includes("wave") || lowerContent.includes("webaim")) {
        hasWave = true;
      }
    }

    return { hasAxe, hasPa11y, hasWave };
  } catch (error) {
    console.log(`Erro ao verificar workflows para ${owner}/${repoName}: ${error.message}`);
    return { hasAxe: false, hasPa11y: false, hasWave: false };
  }
}

async function checkToolInDependencies(owner, repoName) {
  try {
    const variables = { owner, name: repoName };
    const data = await graphqlRequest(dependenciesFilesQuery, variables);
    
    let hasAxe = false;
    let hasPa11y = false;
    let hasWave = false;

    const files = [
      data.repository?.packageJson?.text,
      data.repository?.requirementsTxt?.text,
      data.repository?.composerJson?.text,
      data.repository?.gemfile?.text
    ].filter(Boolean);

    for (const content of files) {
      const lowerContent = content.toLowerCase();
      
      if (lowerContent.includes("axe") || lowerContent.includes("axe-core")) {
        hasAxe = true;
      }
      if (lowerContent.includes("pa11y")) {
        hasPa11y = true;
      }
      if (lowerContent.includes("wave") || lowerContent.includes("webaim")) {
        hasWave = true;
      }
    }

    return { hasAxe, hasPa11y, hasWave };
  } catch (error) {
    console.log(`Erro ao verificar dependências para ${owner}/${repoName}: ${error.message}`);
    return { hasAxe: false, hasPa11y: false, hasWave: false };
  }
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

// Busca focada em projetos frontend e acessibilidade web
function buildQueries() {
  const queries = [];
  
  // 1. Busca específica pelas ferramentas de acessibilidade
  queries.push("axe-core in:name,description,readme sort:stars-desc");
  queries.push("axe in:name,description,readme sort:stars-desc");
  queries.push("pa11y in:name,description,readme sort:stars-desc");
  queries.push("WAVE in:name,description,readme sort:stars-desc");
  queries.push("wave-web-aim in:name,description,readme sort:stars-desc");
  queries.push("webaim-wave in:name,description,readme sort:stars-desc");
  
  // // 2. Linguagens frontend
  // queries.push("language:javascript in:name,description sort:stars-desc");
  // queries.push("language:typescript in:name,description sort:stars-desc");
  // queries.push("language:html in:name,description sort:stars-desc");
  // queries.push("language:css in:name,description sort:stars-desc");
  
  // // 3. Frameworks e bibliotecas frontend
  // queries.push("react in:name,description sort:stars-desc");
  // queries.push("vue in:name,description sort:stars-desc");
  // queries.push("angular in:name,description sort:stars-desc");
  // queries.push("nextjs in:name,description sort:stars-desc");
  // queries.push("nuxt in:name,description sort:stars-desc");
  // queries.push("svelte in:name,description sort:stars-desc");
  // queries.push("gatsby in:name,description sort:stars-desc");
  // queries.push("astro in:name,description sort:stars-desc");
  
  // 4. Termos relacionados a desenvolvimento frontend/web
  queries.push("web-app in:name,description sort:stars-desc");
  queries.push("website in:name,description sort:stars-desc");
  queries.push("frontend in:name,description sort:stars-desc");
  queries.push("spa in:name,description sort:stars-desc");
  queries.push("pwa in:name,description sort:stars-desc");
  queries.push("cms in:name,description sort:stars-desc");
  queries.push("landing-page in:name,description sort:stars-desc");
  
  // 5. Termos de acessibilidade e UX/UI
  queries.push("accessibility in:name,description sort:stars-desc");
  queries.push("a11y in:name,description sort:stars-desc");
  queries.push("wcag in:name,description sort:stars-desc");
  queries.push("aria in:name,description sort:stars-desc");
  queries.push("ux in:name,description sort:stars-desc");
  queries.push("ui in:name,description sort:stars-desc");
  
  // 6. Ferramentas de teste e qualidade frontend
  queries.push("testing in:name,description sort:stars-desc");
  
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

      console.log(`🔍 Verificando ferramentas em: ${nameWithOwner}`);
      
      // Verificar ferramentas em workflows e dependências
      const [workflowCheck, depsCheck] = await Promise.all([
        checkToolInWorkflows(repo.owner.login, repo.name),
        checkToolInDependencies(repo.owner.login, repo.name)
      ]);

      appendToCSV({
        repo: nameWithOwner,
        stars: repo.stargazerCount,
        hasAxeWorkflow: workflowCheck.hasAxe ? "Sim" : "Não",
        hasAxeDeps: depsCheck.hasAxe ? "Sim" : "Não",
        hasPa11yWorkflow: workflowCheck.hasPa11y ? "Sim" : "Não",
        hasPa11yDeps: depsCheck.hasPa11y ? "Sim" : "Não",
        hasWaveDeps: depsCheck.hasWave ? "Sim" : "Não",
        hasWaveWorkflow: workflowCheck.hasWave ? "Sim" : "Não",
      });
      processedSet.add(nameWithOwner);
      saved++;
      
      console.log(`✅ REPOSITÓRIO ADICIONADO: ${nameWithOwner} (${repo.stargazerCount} ⭐)`);
      
      // Pequena pausa para evitar rate limiting
      await new Promise((r) => setTimeout(r, 100));
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
    "🚀 Iniciando coleta focada em projetos frontend e acessibilidade web..."
  );
  console.log(`📋 Total de queries: ${queries.length}`);
  console.log("🔍 Escopo: Frontend, frameworks web, acessibilidade e ferramentas de teste");

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
