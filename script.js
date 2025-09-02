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
const writeHeader = () => {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(
      csvPath,
      "Repositório,Estrelas,AXE em Workflow,Pa11y em Workflow,Lighthouse em Workflow,Wave em Workflow,AXE em Dependência,Pa11y em Dependência,Lighthouse em Dependência,Wave em Dependência\n"
    );
  }
};

const appendToCSV = (row) => {
  const line = `${row.nameWithOwner},${row.stars},${row.axe_wf},${row.pa11y_wf},${row.lighthouse_wf},${row.wave_wf},${row.axe_dep},${row.pa11y_dep},${row.lighthouse_dep},${row.wave_dep}\n`;
  fs.appendFileSync(csvPath, line);
};

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

async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

async function checkWorkflows(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`;
  let axe = false,
    pa11y = false,
    lighthouse = false,
    wave = false;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    if (response.status === 404) return { axe, pa11y, lighthouse, wave };
    if (!response.ok)
      throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

    const files = await response.json();
    if (!Array.isArray(files)) return { axe, pa11y, lighthouse, wave };

    for (const file of files) {
      if (file.name.endsWith(".yml") || file.name.endsWith(".yaml")) {
        const workflowUrl = file.download_url;
        try {
          const workflowResponse = await fetchWithTimeout(
            workflowUrl,
            {},
            30000
          );
          if (!workflowResponse.ok) continue;
          const workflowContent = (await workflowResponse.text()).toLowerCase();
          if (workflowContent.includes("axe")) axe = true;
          if (workflowContent.includes("pa11y")) pa11y = true;
          if (workflowContent.includes("lighthouse")) lighthouse = true;
          if (workflowContent.includes("wave")) wave = true;
        } catch (error) {}
      }
    }
    return { axe, pa11y, lighthouse, wave };
  } catch (error) {
    return { axe, pa11y, lighthouse, wave };
  }
}

async function checkDependencies(owner, repo) {
  const dependencyFiles = [
    "package.json",
    "requirements.txt",
    "Gemfile",
    "composer.json",
  ];
  let axe = false,
    pa11y = false,
    lighthouse = false,
    wave = false;

  for (const fileName of dependencyFiles) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;

    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });

      if (response.status === 404) continue;
      if (!response.ok)
        throw new Error(
          `Erro ao buscar arquivo ${fileName}: ${response.statusText}`
        );

      const file = await response.json();
      if (file.encoding === "base64") {
        const content = Buffer.from(file.content, "base64")
          .toString("utf-8")
          .toLowerCase();
        if (content.includes("axe")) axe = true;
        if (content.includes("pa11y")) pa11y = true;
        if (content.includes("lighthouse")) lighthouse = true;
        if (content.includes("wave")) wave = true;
      }
    } catch (error) {}
  }
  return { axe, pa11y, lighthouse, wave };
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
        }
      }
    }
    pageInfo {
      endCursor
      hasNextPage
    }
  }
}
`;

async function main() {
  writeHeader();
  let totalFound = 0;
  let totalAnalyzed = 0; // Contador total de repositórios analisados
  let after = null;
  const batchSize = 100; // Aumentado para mais eficiência
  const processedRepos = new Set(); // Para evitar duplicados

  const queryStrings = [
    // 🌟 Repositórios mais populares em geral (ordenados por estrelas)
    "stars:>1000 sort:stars-desc",
    "stars:>500 sort:stars-desc",
    "stars:>100 sort:stars-desc",
    "stars:>50 sort:stars-desc",
    "stars:>10 sort:stars-desc",

    // 💻 Repositórios populares por linguagem (mais propensos a ter web apps)
    "language:JavaScript stars:>100 sort:stars-desc",
    "language:TypeScript stars:>100 sort:stars-desc",
    "language:HTML stars:>50 sort:stars-desc",
    "language:CSS stars:>50 sort:stars-desc",

    // 🌐 Repositórios web populares por tópico
    "topic:web stars:>50 sort:stars-desc",
    "topic:website stars:>50 sort:stars-desc",
    "topic:webapp stars:>50 sort:stars-desc",
    "topic:frontend stars:>50 sort:stars-desc",
    "topic:react stars:>100 sort:stars-desc",
    "topic:vue stars:>100 sort:stars-desc",
    "topic:angular stars:>100 sort:stars-desc",
    "topic:nodejs stars:>100 sort:stars-desc",

    // 📱 Repositórios de aplicações/plataformas populares
    "topic:app stars:>50 sort:stars-desc",
    "topic:application stars:>50 sort:stars-desc",
    "topic:platform stars:>50 sort:stars-desc",
    "topic:dashboard stars:>50 sort:stars-desc",
    "topic:ui stars:>50 sort:stars-desc",
    "topic:pwa stars:>50 sort:stars-desc",
  ];

  for (const queryString of queryStrings) {
    after = null;
    let queryFound = 0;
    let queryAnalyzed = 0;
    console.log(`\n🔍 Buscando repositórios populares: "${queryString}"`);

    // Cada query roda até o final ou até 500 resultados por query
    while (queryFound < 500) {
      const variables = { queryString, first: batchSize, after };
      console.log(`📊 Processando lote de repositórios populares...`);
      console.log(`   Query: "${queryString.substring(0, 40)}..."`);
      console.log(
        `   Encontrados com ferramentas nesta query: ${queryFound} | Total geral: ${totalFound}`
      );

      try {
        const data = await graphqlRequest(searchRepositoriesQuery, variables);
        const edges = data.search.edges;
        if (edges.length === 0) break;

        console.log(
          `📈 Total de repositórios disponíveis para esta query: ${
            data.search.repositoryCount || "N/A"
          }`
        );

        for (const edge of edges) {
          const repo = edge.node;
          const nameWithOwner = `${repo.owner.login}/${repo.name}`;

          // Pula se já foi processado
          if (processedRepos.has(nameWithOwner)) {
            console.log(`⏭️  Já processado anteriormente: ${nameWithOwner}`);
            continue;
          }

          // Adiciona repositório para análise (sem filtros - analisa TODOS os populares)
          processedRepos.add(nameWithOwner);
          queryAnalyzed++;
          totalAnalyzed++; // Incrementa contador global

          console.log(
            `🔍 Analisando repositório popular (${queryAnalyzed}): ${nameWithOwner} (${repo.stargazerCount}⭐)`
          );

          const wf = await checkWorkflows(repo.owner.login, repo.name);
          const dep = await checkDependencies(repo.owner.login, repo.name);

          if (
            wf.axe ||
            wf.pa11y ||
            wf.lighthouse ||
            wf.wave ||
            dep.axe ||
            dep.pa11y ||
            dep.lighthouse ||
            dep.wave
          ) {
            appendToCSV({
              nameWithOwner,
              stars: repo.stargazerCount,
              axe_wf: wf.axe ? "Sim" : "Não",
              pa11y_wf: wf.pa11y ? "Sim" : "Não",
              lighthouse_wf: wf.lighthouse ? "Sim" : "Não",
              wave_wf: wf.wave ? "Sim" : "Não",
              axe_dep: dep.axe ? "Sim" : "Não",
              pa11y_dep: dep.pa11y ? "Sim" : "Não",
              lighthouse_dep: dep.lighthouse ? "Sim" : "Não",
              wave_dep: dep.wave ? "Sim" : "Não",
            });
            queryFound++;
            totalFound++;
            console.log(
              `✅ 🎯 ENCONTRADO! Repo com ferramentas de acessibilidade (${queryFound}/${totalFound}): ${nameWithOwner}`
            );
          } else {
            console.log(
              `⚪ Não possui ferramentas de acessibilidade: ${nameWithOwner}`
            );
          }
        }

        if (!data.search.pageInfo.hasNextPage) {
          console.log(
            `📄 Sem mais páginas para query: "${queryString.substring(
              0,
              30
            )}..."`
          );
          break;
        }
        after = data.search.pageInfo.endCursor;

        // Pequena pausa para evitar rate limiting
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`❌ Erro na busca: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        break;
      }
    }

    console.log(
      `📊 Query de repositórios populares finalizada: "${queryString.substring(
        0,
        40
      )}..."`
    );
    console.log(
      `   └─ Repositórios COM ferramentas encontrados: ${queryFound}`
    );
    console.log(`   └─ Repositórios populares analisados: ${queryAnalyzed}`);
    console.log(
      `   └─ Taxa de repositórios com acessibilidade: ${
        queryAnalyzed > 0 ? ((queryFound / queryAnalyzed) * 100).toFixed(1) : 0
      }%`
    );

    // Pausa entre queries
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(
    `\n🎉 ===== ANÁLISE DE REPOSITÓRIOS POPULARES FINALIZADA ===== 🎉`
  );
  console.log(
    `🌟 ESTRATÉGIA: Buscar repositórios populares e verificar se usam ferramentas de acessibilidade`
  );
  console.log(
    `🔢 Total de repositórios populares processados (todas as queries): ${totalAnalyzed}`
  );
  console.log(
    `📊 Repositórios únicos analisados (sem duplicatas): ${processedRepos.size}`
  );
  console.log(
    `✅ Repositórios populares que USAM ferramentas de acessibilidade: ${totalFound}`
  );
  console.log(
    `📈 Taxa de adoção de acessibilidade (repos com ferramentas / únicos): ${
      processedRepos.size > 0
        ? ((totalFound / processedRepos.size) * 100).toFixed(2)
        : 0
    }%`
  );
  console.log(
    `🎯 Taxa de eficiência (únicos / processados): ${
      totalAnalyzed > 0
        ? ((processedRepos.size / totalAnalyzed) * 100).toFixed(2)
        : 0
    }%`
  );
  console.log(
    `🔍 Queries de repositórios populares executadas: ${queryStrings.length}`
  );
  console.log(`📁 Arquivo CSV com repositórios encontrados: ${csvPath}`);
  console.log(
    `=================================================================\n`
  );
  console.log(
    "🏁 Análise concluída! Agora você pode executar as ferramentas nos repositórios encontrados."
  );
}

main();
