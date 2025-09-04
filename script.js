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

// Detecção ampliada de ferramentas e CSV detalhado
const detailedCsvPath = "repositorios_acessibilidade_detalhado.csv";
const writeDetailedHeader = () => {
  if (!fs.existsSync(detailedCsvPath)) {
    fs.writeFileSync(
      detailedCsvPath,
      "Repositório,Estrelas,FerramentasWorkflow,FerramentasDependencias\n"
    );
  }
};

const appendToDetailedCSV = (row) => {
  const sanitize = (s) => String(s ?? "").replace(/"/g, '""');
  const wf = sanitize(row.wfTools);
  const dep = sanitize(row.depTools);
  const line = `"${sanitize(row.nameWithOwner)}",${
    row.stars
  },"${wf}","${dep}"\n`;
  fs.appendFileSync(detailedCsvPath, line);
};

// Lista de ferramentas conhecidas e termos de detecção
const KNOWN_TOOLS = [
  {
    name: "axe-core",
    tokens: [
      "@axe-core/cli",
      "axe-core",
      "axe-playwright",
      "axe-puppeteer",
      "axe-webdriverjs",
      "axe-selenium",
      "react-axe",
      "@axe-core/react",
      "jest-axe",
      "cypress-axe",
    ],
  },
  { name: "pa11y", tokens: ["pa11y", "pa11y-ci"] },
  { name: "lighthouse", tokens: ["lighthouse", "lighthouse-ci", "lhci"] },
  { name: "wave", tokens: ["wave", "webaim"] },
  {
    name: "html-codesniffer",
    tokens: [
      "html_codesniffer",
      "html-codesniffer",
      "htmlcs",
      "squizlabs/html_codesniffer",
    ],
  },
  {
    name: "accessibility-checker",
    tokens: ["accessibility-checker", "ibm equal access", "ibm accessibility"],
  },
  { name: "webhint", tokens: ["webhint", "@hint/cli", "hint"] },
  {
    name: "nu-html-checker",
    tokens: ["vnu", "nu html checker", "html-validator", "htmlvalidator"],
  },
  { name: "html-validate", tokens: ["html-validate"] },
  {
    name: "eslint-plugin-jsx-a11y",
    tokens: ["eslint-plugin-jsx-a11y", "jsx-a11y"],
  },
  {
    name: "eslint-plugin-vuejs-accessibility",
    tokens: ["eslint-plugin-vuejs-accessibility", "vue-a11y"],
  },
  { name: "stylelint-a11y", tokens: ["stylelint-a11y"] },
  { name: "ember-a11y-testing", tokens: ["ember-a11y-testing"] },
  {
    name: "storybook-addon-a11y",
    tokens: ["@storybook/addon-a11y", "addon-a11y"],
  },
  {
    name: "accessibility-insights-action",
    tokens: ["accessibility-insights-action"],
  },
  { name: "accesslint", tokens: ["accesslint"] },
  { name: "tota11y", tokens: ["tota11y"] },
];

const detectToolsInText = (textLower) => {
  const found = new Set();
  for (const tool of KNOWN_TOOLS) {
    for (const token of tool.tokens) {
      if (textLower.includes(token)) {
        found.add(tool.name);
        break;
      }
    }
  }
  return Array.from(found).sort();
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
  let wfToolsList = [];

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
          // Detecção ampliada no conteúdo do workflow
          const detected = detectToolsInText(workflowContent);
          if (detected.length) {
            wfToolsList = Array.from(new Set([...wfToolsList, ...detected]));
          }
        } catch (error) {}
      }
    }
    return { axe, pa11y, lighthouse, wave, wfToolsList };
  } catch (error) {
    return { axe, pa11y, lighthouse, wave, wfToolsList };
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
  let depToolsList = [];

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
        // Detecção ampliada no conteúdo de dependências
        const detected = detectToolsInText(content);
        if (detected.length) {
          depToolsList = Array.from(new Set([...depToolsList, ...detected]));
        }
      }
    } catch (error) {}
  }
  return { axe, pa11y, lighthouse, wave, depToolsList };
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

// Utilidades de divisão por data para ultrapassar o limite de 1000 resultados por query
function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function getRepositoryCount(queryString) {
  const variables = { queryString, first: 1, after: null };
  const data = await graphqlRequest(searchRepositoriesQuery, variables);
  return data.search.repositoryCount || 0;
}

function buildStarsQuery(range) {
  if (range.max == null) return `stars:>=${range.min}`;
  return `stars:${range.min}..${range.max}`;
}

async function splitRangeByDateUntilUnderLimit(
  range,
  startDate,
  endDate,
  maxPerQuery = 1000,
  depth = 0
) {
  const starsPart = buildStarsQuery(range);
  const queryString = `${starsPart} pushed:${formatDate(
    startDate
  )}..${formatDate(endDate)} sort:stars-desc`;
  const count = await getRepositoryCount(queryString);

  if (count <= maxPerQuery) {
    return [{ queryString, rangeName: range.name, count }];
  }

  // Evita recursão infinita: se janela de 1 dia ainda for > 1000, retorna mesmo assim
  const msPerDay = 24 * 60 * 60 * 1000;
  if (endDate - startDate <= msPerDay) {
    return [{ queryString, rangeName: range.name, count }];
  }

  // Divide pela metade do período
  const midTime =
    startDate.getTime() +
    Math.floor((endDate.getTime() - startDate.getTime()) / 2);
  const midDate = new Date(midTime);

  const left = await splitRangeByDateUntilUnderLimit(
    range,
    startDate,
    midDate,
    maxPerQuery,
    depth + 1
  );
  const rightStart = new Date(midDate.getTime() + msPerDay);
  const right = await splitRangeByDateUntilUnderLimit(
    range,
    rightStart,
    endDate,
    maxPerQuery,
    depth + 1
  );
  return [...left, ...right];
}

async function buildSubQueriesForRange(range) {
  // Varre desde 2008-01-01 (início do GitHub público) até hoje
  const start = new Date(Date.UTC(2008, 0, 1));
  const end = new Date();
  return await splitRangeByDateUntilUnderLimit(range, start, end, 1000);
}

async function main() {
  writeHeader();
  writeDetailedHeader();
  let totalFound = 0;
  let totalAnalyzed = 0; // Contador total de repositórios analisados
  let after = null;
  const batchSize = 100; // Máximo permitido pela API do GitHub
  const processedRepos = new Set(); // Para evitar duplicados

  console.log(`🚀 INICIANDO ANÁLISE GERAL SEM LIMITAÇÕES!`);
  console.log(`⚡ ATENÇÃO: Este processo pode demorar HORAS para completar`);
  console.log(
    `📊 Cada faixa será processada COMPLETAMENTE (sem limite de 500 repos)`
  );
  console.log(
    `🔄 O script continuará até esgotar todos os repositórios de cada faixa`
  );
  console.log(`⏰ Tempo estimado: 2-8 horas dependendo da API do GitHub\n`);

  const startTime = Date.now();

  // 🌟 ESTRATÉGIA GERAL: TODOS os repositórios por faixas exclusivas de estrelas
  const starRanges = [
    {
      query: "topic:web stars:>=10000 sort:stars-desc",
      name: "10.000+ estrelas",
      min: 10000,
      max: null,
    },
    {
      query: "topic:web stars:5000..9999 sort:stars-desc",
      name: "5.000-9.999 estrelas",
      min: 5000,
      max: 9999,
    },
    {
      query: "topic:web stars:1000..4999 sort:stars-desc",
      name: "1.000-4.999 estrelas",
      min: 1000,
      max: 4999,
    },
    {
      query: "topic:web stars:500..999 sort:stars-desc",
      name: "500-999 estrelas",
      min: 500,
      max: 999,
    },
    {
      query: "topic:web stars:100..499 sort:stars-desc",
      name: "100-499 estrelas",
      min: 100,
      max: 499,
    },
    {
      query: "topic:web stars:50..99 sort:stars-desc",
      name: "50-99 estrelas",
      min: 50,
      max: 99,
    },
    {
      query: "topic:web stars:10..49 sort:stars-desc",
      name: "10-49 estrelas",
      min: 10,
      max: 49,
    },
    {
      query: "topic:web stars:1..9 sort:stars-desc",
      name: "1-9 estrelas",
      min: 1,
      max: 9,
    },
  ];

  // Estatísticas por faixa de estrelas
  const rangeStats = new Map();

  for (const range of starRanges) {
    const { query: queryString, name: rangeName } = range;
    after = null;
    let queryFound = 0;
    let queryAnalyzed = 0;

    console.log(`\n🌟 ===== FAIXA: ${rangeName.toUpperCase()} =====`);
    console.log(`🔍 Query: "${queryString}"`);

    // Cada faixa roda até o final (SEM LIMITAÇÃO)
    while (true) {
      const variables = { queryString, first: batchSize, after };
      console.log(`📊 Processando repositórios da faixa "${rangeName}"...`);
      console.log(
        `   🎯 Com ferramentas nesta faixa: ${queryFound} | 📊 Total geral: ${totalFound}`
      );
      console.log(
        `   🔍 Analisados nesta faixa: ${queryAnalyzed} | 🌟 Total analisados: ${totalAnalyzed}`
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
            // CSV detalhado com lista de ferramentas detectadas
            appendToDetailedCSV({
              nameWithOwner,
              stars: repo.stargazerCount,
              wfTools: (wf.wfToolsList || []).join(", "),
              depTools: (dep.depToolsList || []).join(", "),
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

    // Salva estatísticas da faixa
    rangeStats.set(rangeName, {
      found: queryFound,
      analyzed: queryAnalyzed,
      range: range,
    });

    console.log(`🎯 ===== FAIXA "${rangeName.toUpperCase()}" FINALIZADA =====`);
    console.log(
      `   📊 Repositórios COM ferramentas encontrados: ${queryFound}`
    );
    console.log(`   🔍 Repositórios analisados nesta faixa: ${queryAnalyzed}`);
    console.log(
      `   📈 Taxa de acessibilidade na faixa: ${
        queryAnalyzed > 0 ? ((queryFound / queryAnalyzed) * 100).toFixed(1) : 0
      }%`
    );
    console.log(
      `   ⭐ Faixa de estrelas: ${range.min}${
        range.max ? `-${range.max}` : "+"
      }`
    );
    console.log(`============================================`);

    // Pausa entre queries
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log(`\n🎉 ===== ANÁLISE GERAL DE REPOSITÓRIOS FINALIZADA ===== 🎉`);
  console.log(
    `🌟 ESTRATÉGIA: Análise GERAL de TODOS os repositórios por faixa de estrelas`
  );
  console.log(
    `===============================================================\n`
  );

  // Resumo geral
  const endTime = Date.now();
  const totalTimeMs = endTime - startTime;
  const totalTimeMin = Math.round(totalTimeMs / 60000);
  const totalTimeHour = Math.round(totalTimeMin / 60);
  const timeDisplay =
    totalTimeMin > 60
      ? `${totalTimeHour}h ${totalTimeMin % 60}min`
      : `${totalTimeMin}min`;

  console.log(`📊 RESUMO GERAL:`);
  console.log(`⏰ Tempo total de execução: ${timeDisplay}`);
  console.log(`🔢 Total de repositórios processados: ${totalAnalyzed}`);
  console.log(`📊 Repositórios únicos analisados: ${processedRepos.size}`);
  console.log(
    `✅ Repositórios que USAM ferramentas de acessibilidade: ${totalFound}`
  );
  console.log(
    `📈 Taxa global de adoção de acessibilidade: ${
      processedRepos.size > 0
        ? ((totalFound / processedRepos.size) * 100).toFixed(2)
        : 0
    }%`
  );
  console.log(
    `🎯 Taxa de eficiência (únicos/processados): ${
      totalAnalyzed > 0
        ? ((processedRepos.size / totalAnalyzed) * 100).toFixed(2)
        : 0
    }%`
  );
  console.log(
    `⚡ Velocidade: ${Math.round(totalAnalyzed / totalTimeMin)} repos/min`
  );
  console.log(`🔍 Faixas de estrelas analisadas: ${starRanges.length}`);
  console.log(`📁 Arquivo CSV: ${csvPath}\n`);

  // Detalhamento por faixa
  console.log(`🌟 DETALHAMENTO POR FAIXA DE ESTRELAS:`);
  console.log(`${"".padEnd(70, "=")}`);
  for (const [faixaNome, stats] of rangeStats) {
    const taxa =
      stats.analyzed > 0
        ? ((stats.found / stats.analyzed) * 100).toFixed(1)
        : "0.0";
    const range = stats.range;
    const faixaEstrelas = `${range.min}${range.max ? `-${range.max}` : "+"}`;

    console.log(
      `⭐ ${faixaNome.padEnd(20)} | Estrelas: ${faixaEstrelas.padEnd(
        12
      )} | Analisados: ${stats.analyzed
        .toString()
        .padStart(4)} | Com ferramentas: ${stats.found
        .toString()
        .padStart(3)} | Taxa: ${taxa.padStart(5)}%`
    );
  }

  console.log(`${"".padEnd(70, "=")}`);
  console.log(
    `🏁 Análise completa! Execute o script de ferramentas nos repos encontrados.`
  );
}

main();
