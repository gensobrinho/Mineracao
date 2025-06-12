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
const processedRepos = new Set();
const batchSize = 50;

// Consultas simples que funcionam, baseadas no script original
const queries = [
  'topic:web sort:stars-desc',
  'topic:frontend sort:stars-desc', 
  'topic:javascript sort:stars-desc',
  'topic:react sort:stars-desc',
  'topic:vue sort:stars-desc',
  'topic:angular sort:stars-desc',
  'topic:accessibility sort:stars-desc',
  'language:JavaScript sort:stars-desc',
  'language:TypeScript sort:stars-desc'
];

console.log('🚀 Iniciando busca otimizada...');

for (let queryIndex = 0; queryIndex < queries.length; queryIndex++) {
  if (found >= 1000) break;
  
  const queryString = queries[queryIndex];
  console.log(`\n🔍 [${queryIndex + 1}/${queries.length}] Executando: ${queryString}`);
  
  let after = null;
  let reposFromThisQuery = 0;

  while (found < 1000) {
    const variables = { queryString, first: batchSize, after };
    
    try {
      console.log(`Buscando lote... já encontrados: ${found}`);
      const data = await graphqlRequest(searchRepositoriesQuery, variables);

      if (!data.search.edges.length) {
        console.log('Nenhum repositório retornado para esta consulta.');
        break;
      }

      for (const edge of data.search.edges) {
        if (found >= 1000) break;
        
        const repo = edge.node;
        const nameWithOwner = `${repo.owner.login}/${repo.name}`;
        
        // Filtrar por 40000+ estrelas
        if (repo.stargazerCount < 40000) continue;
        
        // Evitar duplicatas
        if (processedRepos.has(nameWithOwner)) continue;
        processedRepos.add(nameWithOwner);

        console.log(`Analisando: ${nameWithOwner} (${repo.stargazerCount} estrelas)`);

        const wf = await checkWorkflows(repo.owner.login, repo.name);
        const dep = await checkDependencies(repo.owner.login, repo.name);

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
          reposFromThisQuery++;
          console.log(`✅ Salvo no CSV (${found}): ${JSON.stringify(row)}`);
        } else {
          console.log('Nenhuma ferramenta encontrada, não salvo no CSV.');
        }
      }

      if (!data.search.pageInfo.hasNextPage) {
        console.log('Não há mais páginas para esta consulta.');
        break;
      }
      after = data.search.pageInfo.endCursor;
      
    } catch (error) {
      console.error(`Erro na busca: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  console.log(`Consulta finalizada. Encontrados nesta consulta: ${reposFromThisQuery}`);
}

console.log('\nProcesso finalizado!');
console.log(`Total encontrado: ${found}`);
console.log(`Total de repositórios únicos processados: ${processedRepos.size}`);
}

main();
