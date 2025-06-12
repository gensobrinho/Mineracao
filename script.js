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
let tools = { axe: false, pa11y: false };

try {
  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
    },
  });

  if (response.status === 404) return tools;
  if (!response.ok) throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

  const files = await response.json();
  if (!Array.isArray(files)) return tools;

  const toolPatterns = [
    'axe', 'axe-core', '@axe-core', 'axe-playwright', 'axe-puppeteer',
    'pa11y', 'pa11y-ci', 'lighthouse', 'accessibility-checker',
    'jest-axe', 'cypress-axe', 'storybook-addon-a11y',
    'eslint-plugin-jsx-a11y', 'react-axe'
  ];

  for (const file of files) {
    if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
      const workflowUrl = file.download_url;
      try {
        const workflowResponse = await fetchWithTimeout(workflowUrl, {}, 30000);
        if (!workflowResponse.ok) continue;
        const workflowContent = (await workflowResponse.text()).toLowerCase();
        
        for (const pattern of toolPatterns) {
          if (workflowContent.includes(pattern.toLowerCase())) {
            if (pattern.includes('axe')) tools.axe = true;
            if (pattern.includes('pa11y')) tools.pa11y = true;
          }
        }
      } catch (error) {}
    }
  }
  return tools;
} catch (error) {
  return tools;
}
}

async function checkDependencies(owner, repo) {
const dependencyFiles = [
  'package.json', 'package-lock.json', 'yarn.lock',
  'requirements.txt', 'Pipfile', 'pyproject.toml',
  'Gemfile', 'Gemfile.lock',
  'composer.json', 'composer.lock',
  'pom.xml', 'build.gradle', 'build.gradle.kts',
  'Cargo.toml', 'go.mod'
];

const toolPatterns = [
  'axe', 'axe-core', '@axe-core', 'axe-playwright', 'axe-puppeteer',
  'pa11y', 'pa11y-ci', 'jest-axe', 'cypress-axe', 'react-axe',
  'storybook-addon-a11y', 'eslint-plugin-jsx-a11y',
  'lighthouse', 'accessibility-checker', 'wave-cli'
];

let tools = { axe: false, pa11y: false };

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
      
      for (const pattern of toolPatterns) {
        if (content.includes(pattern.toLowerCase())) {
          if (pattern.includes('axe')) tools.axe = true;
          if (pattern.includes('pa11y')) tools.pa11y = true;
        }
      }
    }
  } catch (error) {}
}
return tools;
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
const batchSize = 50;
const processedRepos = new Set();

const searchQueries = [
  'axe-core in:file sort:stars-desc',
  'pa11y in:file sort:stars-desc', 
  '@axe-core/core in:file sort:stars-desc',
  'accessibility-testing in:file sort:stars-desc',
  'topic:accessibility sort:stars-desc',
  'topic:a11y sort:stars-desc',
  'filename:package.json axe sort:stars-desc',
  'filename:package.json pa11y sort:stars-desc',
  'path:.github/workflows axe sort:stars-desc',
  'path:.github/workflows pa11y sort:stars-desc',
  'language:JavaScript accessibility sort:stars-desc',
  'language:TypeScript accessibility sort:stars-desc',
  'topic:frontend testing sort:stars-desc',
  'topic:react accessibility sort:stars-desc',
  'topic:vue accessibility sort:stars-desc',
  'topic:angular accessibility sort:stars-desc',
  'jest-axe in:file sort:stars-desc',
  'cypress-axe in:file sort:stars-desc',
  'react-axe in:file sort:stars-desc',
  'storybook-addon-a11y in:file sort:stars-desc',
  'eslint-plugin-jsx-a11y in:file sort:stars-desc',
  'lighthouse in:file sort:stars-desc',
  'accessibility-checker in:file sort:stars-desc',
  'topic:web sort:stars-desc'
];

for (const queryString of searchQueries) {
  if (found >= 1000) break;
  
  console.log(`\n🔍 Nova busca: ${queryString}`);
  let after = null;
  
  while (found < 1000) {
    const variables = { queryString, first: batchSize, after };
    
    console.log(`Buscando lote... já encontrados: ${found}`);
    
    try {
      const data = await graphqlRequest(searchRepositoriesQuery, variables);
      
      if (!data.search.edges.length) {
        console.log('Nenhum repositório retornado, próxima consulta.');
        break;
      }

      for (const edge of data.search.edges) {
        if (found >= 1000) break;
        
        const repo = edge.node;
        const repoId = `${repo.owner.login}/${repo.name}`;
        
        if (processedRepos.has(repoId)) continue;
        processedRepos.add(repoId);

        console.log(`Analisando: ${repoId} (${repo.stargazerCount} estrelas)`);

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
          console.log(`✅ Salvo no CSV (${found}): ${repoId}`);
        } else {
          console.log('Nenhuma ferramenta encontrada, não salvo no CSV.');
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
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
}

console.log(`\n🎉 Processo finalizado! Total encontrado: ${found}`);
console.log(`Total de repositórios únicos processados: ${processedRepos.size}`);
}

main().catch(error => {
console.error('Erro fatal:', error);
process.exit(1);
});
