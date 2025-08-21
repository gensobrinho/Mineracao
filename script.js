const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
console.error('Erro: O token do GitHub não foi encontrado. Certifique-se de que o arquivo .env contém a variável GITHUB_TOKEN.');
process.exit(1);
}

const csvPath = 'repositorios_acessibilidade.csv';
const writeHeader = () => {
if (!fs.existsSync(csvPath)) {
  fs.writeFileSync(
    csvPath,
    'Repositório,Estrelas,AXE em Workflow,Pa11y em Workflow,AXE em Dependência,Pa11y em Dependência\n'
  );
}
};

const appendToCSV = (row) => {
const line = `${row.nameWithOwner},${row.stars},${row.axe_wf},${row.pa11y_wf},${row.axe_dep},${row.pa11y_dep}\n`;
fs.appendFileSync(csvPath, line);
};

async function graphqlRequest(query, variables) {
const response = await fetch('https://api.github.com/graphql', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'Content-Type': 'application/json',
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
  const response = await fetch(url, { ...options, signal: controller.signal });
  clearTimeout(id);
  return response;
} catch (error) {
  clearTimeout(id);
  throw error;
}
}

async function checkWorkflows(owner, repo) {
const url = `https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows`;
let axe = false, pa11y = false;

try {
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
    },
  });

  if (response.status === 404) return { axe, pa11y };
  if (!response.ok) throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

  const files = await response.json();
  if (!Array.isArray(files)) return { axe, pa11y };

  for (const file of files) {
    if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
      const workflowUrl = file.download_url;
      try {
        const workflowResponse = await fetchWithTimeout(workflowUrl, {}, 30000);
        if (!workflowResponse.ok) continue;
        const workflowContent = (await workflowResponse.text()).toLowerCase();
        if (workflowContent.includes('axe')) axe = true;
        if (workflowContent.includes('pa11y')) pa11y = true;
      } catch (error) {}
    }
  }
  return { axe, pa11y };
} catch (error) {
  return { axe, pa11y };
}
}

async function checkDependencies(owner, repo) {
const dependencyFiles = ['package.json', 'requirements.txt', 'Gemfile', 'composer.json'];
let axe = false, pa11y = false;

for (const fileName of dependencyFiles) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    if (response.status === 404) continue;
    if (!response.ok) throw new Error(`Erro ao buscar arquivo ${fileName}: ${response.statusText}`);

    const file = await response.json();
    if (file.encoding === 'base64') {
      const content = Buffer.from(file.content, 'base64').toString('utf-8').toLowerCase();
      if (content.includes('axe')) axe = true;
      if (content.includes('pa11y')) pa11y = true;
    }
  } catch (error) {
  }
}
return { axe, pa11y };
}

// Múltiplas estratégias de busca otimizadas
const searchQueries = [
  'topic:web sort:stars-desc',
  'topic:accessibility sort:stars-desc',
  'topic:a11y sort:stars-desc',
  'topic:wcag sort:stars-desc',
  'accessibility testing sort:stars-desc',
  'axe-core sort:stars-desc',
  'pa11y sort:stars-desc',
  'lighthouse accessibility sort:stars-desc',
  'web accessibility sort:stars-desc',
  'aria testing sort:stars-desc',
  'screen reader testing sort:stars-desc',
  'accessibility audit sort:stars-desc',
  'accessibility compliance sort:stars-desc',
  'accessibility tools sort:stars-desc',
  'accessibility framework sort:stars-desc',
  'axe testing sort:stars-desc',
  'pa11y testing sort:stars-desc',
  'accessibility automation sort:stars-desc',
  'accessibility ci sort:stars-desc',
  'accessibility workflow sort:stars-desc',
  'lighthouse sort:stars-desc',
  'wave accessibility sort:stars-desc',
  'lighthouse audit sort:stars-desc',
  'wave testing sort:stars-desc',
  'lighthouse accessibility testing sort:stars-desc',
  'wave automated testing sort:stars-desc'
];

const searchRepositoriesQuery = `
query($queryString: String!, $first: Int!, $after: String) {
search(query: $queryString, type: REPOSITORY, first: $first, after: $after) {
  edges {
    node {
      ... on Repository {
        name
        owner {
          login
        }
        url
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

async function searchWithQuery(queryString, maxResults = 1000) {
  let found = 0;
  let totalAnalyzed = 0;
  let after = null;
  const batchSize = 100; // Aumentado para processar mais por vez

  console.log(`\n🔍 Iniciando busca com query: "${queryString}"`);

  while (found < maxResults) {
    const variables = {
      queryString,
      first: batchSize,
      after: after
    };

    console.log(`📊 Buscando lote... já encontrados: ${found}, total analisados: ${totalAnalyzed}`);
    
    try {
      const data = await graphqlRequest(searchRepositoriesQuery, variables);

      if (!data.search.edges.length) {
        console.log('Nenhum repositório retornado, encerrando busca.');
        break;
      }

      for (const edge of data.search.edges) {
        if (found >= maxResults) break;
        const repo = edge.node;
        
        // Remove filtros limitantes para maximizar busca
        // if (repo.stargazerCount > 40000 && found === 0) continue;
        // if (repo.stargazerCount > 40000 && found > 0) continue; 

        const nameWithOwner = `${repo.owner.login}/${repo.name}`;
        console.log(`🔍 Analisando: ${nameWithOwner} (${repo.stargazerCount} estrelas)`);

        const wf = await checkWorkflows(repo.owner.login, repo.name);
        const dep = await checkDependencies(repo.owner.login, repo.name);
        
        totalAnalyzed++;

        if (wf.axe || wf.pa11y || dep.axe || dep.pa11y) {
          const row = {
            nameWithOwner,
            url: repo.url,
            stars: repo.stargazerCount,
            axe_wf: wf.axe ? 'Sim' : 'Não',
            pa11y_wf: wf.pa11y ? 'Sim' : 'Não',
            axe_dep: dep.axe ? 'Sim' : 'Não',
            pa11y_dep: dep.pa11y ? 'Sim' : 'Não'
          };

          appendToCSV(row);
          found++;
          console.log(`✅ Salvo no CSV (${found}): ${JSON.stringify(row)}`);
        } else {
          console.log('❌ Nenhuma ferramenta encontrada, não salvo no CSV.');
        }
      }

      if (!data.search.pageInfo.hasNextPage) {
        console.log('Não há mais páginas de resultados.');
        break;
      }
      after = data.search.pageInfo.endCursor;

      // Pequena pausa para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      console.log(`❌ Erro na busca: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  console.log(`\n📈 === RESUMO DA QUERY: "${queryString}" ===`);
  console.log(`📊 Total de repositórios analisados: ${totalAnalyzed}`);
  console.log(`✅ Repositórios com ferramentas de acessibilidade encontrados: ${found}`);
  console.log(`📈 Taxa de sucesso: ${totalAnalyzed > 0 ? ((found / totalAnalyzed) * 100).toFixed(2) : 0}%`);
  console.log(`===============================================\n`);

  return { found, totalAnalyzed };
}

async function main() {
  writeHeader();
  let totalFound = 0;
  let totalAnalyzed = 0;
  const maxResultsPerQuery = 1000; // Aumentado o limite por query

  console.log('🚀 Iniciando busca otimizada por repositórios com ferramentas de acessibilidade...');

  for (const query of searchQueries) {
    if (totalFound >= 5000) { // Limite total aumentado
      console.log('🎯 Limite total atingido.');
      break;
    }

    const result = await searchWithQuery(query, maxResultsPerQuery);
    totalFound += result.found;
    totalAnalyzed += result.totalAnalyzed;
    
    console.log(`📋 Query "${query}" completada.`);
    console.log(`📊 Total acumulado - Encontrados: ${totalFound}, Analisados: ${totalAnalyzed}`);
    
    // Pausa entre queries para evitar rate limiting
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log(`\n🎉 ===== RESUMO FINAL ===== 🎉`);
  console.log(`📊 Total de repositórios analisados/minerados: ${totalAnalyzed}`);
  console.log(`✅ Total de repositórios inseridos na planilha: ${totalFound}`);
  console.log(`📈 Taxa de sucesso geral: ${totalAnalyzed > 0 ? ((totalFound / totalAnalyzed) * 100).toFixed(2) : 0}%`);
  console.log(`📁 Arquivo CSV gerado: ${csvPath}`);
  console.log(`=====================================\n`);
}

main();
