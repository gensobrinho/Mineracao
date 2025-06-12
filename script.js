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
  } catch (error) {}
}
return { axe, pa11y };
}

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

async function main() {
writeHeader();
let found = 0;
let totalProcessed = 0;
const processedRepos = new Set();
const batchSize = 50;

// Consultas otimizadas para encontrar repositórios com 40000+ estrelas que usam axe-core ou pa11y
const optimizedQueries = [
  // Busca direta por axe-core em arquivos
  'axe-core in:file stars:>=40000 sort:stars-desc',
  'axe-core filename:package.json stars:>=40000 sort:stars-desc',
  '@axe-core/core in:file stars:>=40000 sort:stars-desc',
  
  // Busca direta por pa11y em arquivos  
  'pa11y in:file stars:>=40000 sort:stars-desc',
  'pa11y filename:package.json stars:>=40000 sort:stars-desc',
  'pa11y-ci in:file stars:>=40000 sort:stars-desc',
  
  // Busca em workflows
  'axe path:.github/workflows stars:>=40000 sort:stars-desc',
  'pa11y path:.github/workflows stars:>=40000 sort:stars-desc',
  'axe-core path:.github/workflows stars:>=40000 sort:stars-desc',
  
  // Busca por tópicos relacionados a acessibilidade
  'topic:accessibility stars:>=40000 sort:stars-desc',
  'topic:a11y stars:>=40000 sort:stars-desc',
  'topic:web-accessibility stars:>=40000 sort:stars-desc',
  
  // Busca por linguagens específicas com acessibilidade
  'language:JavaScript accessibility stars:>=40000 sort:stars-desc',
  'language:TypeScript accessibility stars:>=40000 sort:stars-desc',
  'language:JavaScript axe stars:>=40000 sort:stars-desc',
  'language:TypeScript axe stars:>=40000 sort:stars-desc',
  
  // Busca por frameworks populares com acessibilidade
  'react accessibility stars:>=40000 sort:stars-desc',
  'vue accessibility stars:>=40000 sort:stars-desc',
  'angular accessibility stars:>=40000 sort:stars-desc',
  'next.js accessibility stars:>=40000 sort:stars-desc',
  
  // Busca ampla em projetos web populares
  'topic:frontend stars:>=40000 sort:stars-desc',
  'topic:web stars:>=40000 sort:stars-desc',
  'topic:webapp stars:>=40000 sort:stars-desc',
  'topic:website stars:>=40000 sort:stars-desc'
];

console.log('🚀 Iniciando busca otimizada para repositórios 40000+ estrelas com axe-core/pa11y...');
console.log(`📝 Total de consultas: ${optimizedQueries.length}`);

for (let i = 0; i < optimizedQueries.length; i++) {
  if (found >= 1000) break;
  
  const queryString = optimizedQueries[i];
  console.log(`\n🔍 [${i+1}/${optimizedQueries.length}] Executando: ${queryString}`);
  
  let after = null;
  let queryResults = 0;
  
  try {
    while (found < 1000) {
      const variables = { queryString, first: batchSize, after };
      
      const data = await graphqlRequest(searchRepositoriesQuery, variables);
      
      if (!data.search.edges.length) {
        console.log(`   ✅ Consulta finalizada. Encontrados: ${queryResults} repositórios`);
        break;
      }

      for (const edge of data.search.edges) {
        if (found >= 1000) break;
        
        const repo = edge.node;
        const repoId = `${repo.owner.login}/${repo.name}`;
        
        // Garantir que tem pelo menos 40000 estrelas
        if (repo.stargazerCount < 40000) continue;
        
        totalProcessed++;
        
        // Evitar duplicatas
        if (processedRepos.has(repoId)) continue;
        processedRepos.add(repoId);
        
        queryResults++;
        console.log(`   📊 Analisando: ${repoId} (${repo.stargazerCount} ⭐)`);

        const [wf, dep] = await Promise.all([
          checkWorkflows(repo.owner.login, repo.name),
          checkDependencies(repo.owner.login, repo.name)
        ]);

        if (wf.axe || wf.pa11y || dep.axe || dep.pa11y) {
          const row = {
            nameWithOwner: repoId,
            url: repo.url,
            stars: repo.stargazerCount,
            axe_wf: wf.axe ? 'Sim' : 'Não',
            pa11y_wf: wf.pa11y ? 'Sim' : 'Não',
            axe_dep: dep.axe ? 'Sim' : 'Não',
            pa11y_dep: dep.pa11y ? 'Sim' : 'Não'
          };

          appendToCSV(row);
          found++;
          console.log(`   ✅ ENCONTRADO! (${found}/1000): ${repoId} - AXE: ${wf.axe||dep.axe ? '✓' : '✗'} | PA11Y: ${wf.pa11y||dep.pa11y ? '✓' : '✗'}`);
        }
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
  } catch (error) {
    console.error(`   ❌ Erro na consulta: ${error.message}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.log(`   📈 Progresso geral: ${found}/1000 encontrados | ${processedRepos.size} únicos processados`);
}

console.log('\n🎉 BUSCA FINALIZADA!');
console.log(`📊 Estatísticas finais:`);
console.log(`   • Repositórios com axe/pa11y encontrados: ${found}`);
console.log(`   • Total de repositórios únicos processados: ${processedRepos.size}`);
console.log(`   • Total de repositórios analisados: ${totalProcessed}`);
console.log(`   • Arquivo CSV: ${csvPath}`);
}

main().catch(error => {
console.error('💥 Erro fatal:', error);
process.exit(1);
});
