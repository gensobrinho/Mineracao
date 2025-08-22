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
  'Repositório,Estrelas,AXE em Workflow,Pa11y em Workflow,Lighthouse em Workflow,Wave em Workflow,AXE em Dependência,Pa11y em Dependência,Lighthouse em Dependência,Wave em Dependência\n'
);
}
};

const appendToCSV = (row) => {
const line = `${row.nameWithOwner},${row.stars},${row.axe_wf},${row.pa11y_wf},${row.lighthouse_wf},${row.wave_wf},${row.axe_dep},${row.pa11y_dep},${row.lighthouse_dep},${row.wave_dep}\n`;
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
let axe = false, pa11y = false, lighthouse = false, wave = false;

try {
const response = await fetchWithTimeout(url, {
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
  },
});

if (response.status === 404) return { axe, pa11y, lighthouse, wave };
if (!response.ok) throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

const files = await response.json();
if (!Array.isArray(files)) return { axe, pa11y, lighthouse, wave };

for (const file of files) {
  if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
    const workflowUrl = file.download_url;
    try {
      const workflowResponse = await fetchWithTimeout(workflowUrl, {}, 30000);
      if (!workflowResponse.ok) continue;
      const workflowContent = (await workflowResponse.text()).toLowerCase();
      if (workflowContent.includes('axe')) axe = true;
      if (workflowContent.includes('pa11y')) pa11y = true;
      if (workflowContent.includes('lighthouse')) lighthouse = true;
      if (workflowContent.includes('wave')) wave = true;
    } catch (error) {}
  }
}
return { axe, pa11y, lighthouse, wave };
} catch (error) {
return { axe, pa11y, lighthouse, wave };
}
}

async function checkDependencies(owner, repo) {
const dependencyFiles = ['package.json', 'requirements.txt', 'Gemfile', 'composer.json'];
let axe = false, pa11y = false, lighthouse = false, wave = false;

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
    if (content.includes('lighthouse')) lighthouse = true;
    if (content.includes('wave')) wave = true;
  }
} catch (error) {
}
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
    // 🌐 Aplicações web com ferramentas de acessibilidade (PRIORIDADE ALTA)
    'axe-core topic:web language:JavaScript sort:stars-desc',
    'pa11y topic:web language:JavaScript sort:stars-desc',
    'lighthouse topic:web language:JavaScript sort:stars-desc',
    'wave topic:web language:JavaScript sort:stars-desc',
    
    // 🎯 Projetos web que IMPLEMENTAM acessibilidade
    'axe topic:web topic:accessibility sort:stars-desc',
    'pa11y topic:web topic:accessibility sort:stars-desc', 
    'lighthouse topic:web topic:accessibility sort:stars-desc',
    'accessibility testing topic:web sort:stars-desc',
    
    // 💻 Aplicações React/Vue/Angular com acessibilidade
    'axe topic:react language:JavaScript sort:stars-desc',
    'axe topic:vue language:JavaScript sort:stars-desc',
    'axe topic:angular language:JavaScript sort:stars-desc',
    'pa11y topic:react language:JavaScript sort:stars-desc',
    'pa11y topic:vue language:JavaScript sort:stars-desc',
    'lighthouse topic:react language:JavaScript sort:stars-desc',
    
    // 🏗️ Projetos frontend com CI/CD de acessibilidade  
    'axe ci frontend in:name,description,readme language:JavaScript sort:stars-desc',
    'pa11y ci frontend in:name,description,readme language:JavaScript sort:stars-desc',
    'lighthouse ci frontend in:name,description,readme language:JavaScript sort:stars-desc',
    'accessibility testing ci in:name,description,readme language:JavaScript sort:stars-desc',
    
    // 🔧 Websites e web apps com automação de acessibilidade
    'axe website in:name,description,readme language:JavaScript sort:stars-desc',
    'pa11y webapp in:name,description,readme language:JavaScript sort:stars-desc',
    'lighthouse website in:name,description,readme language:JavaScript sort:stars-desc',
    'accessibility automation website in:name,description,readme sort:stars-desc',
    
    // 🎨 Projetos específicos de UI/UX com acessibilidade
    'axe ui component library sort:stars-desc',
    'accessibility ui components sort:stars-desc',
    'pa11y design system sort:stars-desc',
    'lighthouse pwa sort:stars-desc',
    
    // 🌍 Sites governamentais e educacionais (alta chance de ter acessibilidade)
    'accessibility gov website sort:stars-desc',
    'accessibility education website sort:stars-desc',
    'wcag compliance website sort:stars-desc'
  ];

  for (const queryString of queryStrings) {
    after = null;
    let queryFound = 0;
    let queryAnalyzed = 0;
    console.log(`\n🔍 Iniciando busca com query: "${queryString}"`);
    
    // Cada query roda até o final ou até 500 resultados por query
    while (queryFound < 500) {
      const variables = { queryString, first: batchSize, after };
      console.log(`📊 Buscando lote... Query: "${queryString.substring(0, 30)}..." | Encontrados nesta query: ${queryFound} | Total geral: ${totalFound}`);

      try {
        const data = await graphqlRequest(searchRepositoriesQuery, variables);
        const edges = data.search.edges;
        if (edges.length === 0) break;

        console.log(`📈 Total de repositórios disponíveis para esta query: ${data.search.repositoryCount || 'N/A'}`);

        for (const edge of edges) {
          const repo = edge.node;
          const nameWithOwner = `${repo.owner.login}/${repo.name}`;

          // Pula se já foi processado
          if (processedRepos.has(nameWithOwner)) {
            console.log(`⏭️  Já processado anteriormente: ${nameWithOwner}`);
            continue;
          }

          // Filtro inteligente para priorizar aplicações web
          const repoName = repo.name.toLowerCase();
          const ownerName = repo.owner.login.toLowerCase();
          
          // Indicadores de que é uma aplicação web (PRIORIDADE ALTA)
          const webAppIndicators = [
            'website', 'webapp', 'app', 'frontend', 'ui', 'dashboard', 
            'portal', 'platform', 'site', 'web', 'client', 'interface'
          ];
          
          // Indicadores de que é framework/biblioteca (PRIORIDADE BAIXA para nosso objetivo)  
          const libraryIndicators = [
            'axe-core', 'pa11y', 'lighthouse', 'wave', 'lib', 'library', 
            'framework', 'plugin', 'util', 'tool', 'helper'
          ];
          
          const isWebApp = webAppIndicators.some(indicator => 
            repoName.includes(indicator) || ownerName.includes(indicator)
          );
          
          const isLibrary = libraryIndicators.some(indicator => 
            repoName.includes(indicator)
          );
          
          // Prioriza web apps, mas não exclui totalmente libraries (podem ser úteis)
          if (isLibrary && !isWebApp && queryAnalyzed > 20) {
            console.log(`⏭️  Priorizando web apps: ${nameWithOwner} (parece ser biblioteca)`);
            continue;
          }
          
          processedRepos.add(nameWithOwner);
          queryAnalyzed++;
          totalAnalyzed++; // Incrementa contador global

          const appType = isWebApp ? '🌐 [WEB APP]' : isLibrary ? '📚 [LIBRARY]' : '❓ [OTHER]';
          console.log(`🔍 Analisando (${queryAnalyzed}): ${appType} ${nameWithOwner} (${repo.stargazerCount}⭐)`);

          const wf = await checkWorkflows(repo.owner.login, repo.name);
          const dep = await checkDependencies(repo.owner.login, repo.name);

          if (wf.axe || wf.pa11y || wf.lighthouse || wf.wave || dep.axe || dep.pa11y || dep.lighthouse || dep.wave) {
            appendToCSV({
              nameWithOwner,
              stars: repo.stargazerCount,
              axe_wf: wf.axe ? 'Sim' : 'Não',
              pa11y_wf: wf.pa11y ? 'Sim' : 'Não',
              lighthouse_wf: wf.lighthouse ? 'Sim' : 'Não',
              wave_wf: wf.wave ? 'Sim' : 'Não',
              axe_dep: dep.axe ? 'Sim' : 'Não',
              pa11y_dep: dep.pa11y ? 'Sim' : 'Não',
              lighthouse_dep: dep.lighthouse ? 'Sim' : 'Não',
              wave_dep: dep.wave ? 'Sim' : 'Não',
            });
            queryFound++;
            totalFound++;
            console.log(`✅ Salvo no CSV! Query: ${queryFound} | Total: ${totalFound} | Repo: ${nameWithOwner}`);
          } else {
            console.log(`❌ Nenhuma ferramenta encontrada: ${nameWithOwner}`);
          }
        }

        if (!data.search.pageInfo.hasNextPage) {
          console.log(`📄 Sem mais páginas para query: "${queryString.substring(0, 30)}..."`);
          break;
        }
        after = data.search.pageInfo.endCursor;

        // Pequena pausa para evitar rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`❌ Erro na busca: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        break;
      }
    }

    console.log(`📊 Query finalizada: "${queryString.substring(0, 40)}..."`);
    console.log(`   └─ Encontrados nesta query: ${queryFound}`);
    console.log(`   └─ Analisados nesta query: ${queryAnalyzed}`);
    console.log(`   └─ Taxa de sucesso da query: ${queryAnalyzed > 0 ? ((queryFound / queryAnalyzed) * 100).toFixed(1) : 0}%`);
    
    // Pausa entre queries
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log(`\n🎉 ===== RESUMO FINAL DETALHADO ===== 🎉`);
  console.log(`🔢 Total de repositórios processados (todas as queries): ${totalAnalyzed}`);
  console.log(`📊 Total de repositórios únicos analisados (sem duplicatas): ${processedRepos.size}`);
  console.log(`✅ Total de repositórios com ferramentas de acessibilidade: ${totalFound}`);
  console.log(`📈 Taxa de sucesso (repos com ferramentas / únicos analisados): ${processedRepos.size > 0 ? ((totalFound / processedRepos.size) * 100).toFixed(2) : 0}%`);
  console.log(`🎯 Taxa de eficiência (únicos / processados): ${totalAnalyzed > 0 ? ((processedRepos.size / totalAnalyzed) * 100).toFixed(2) : 0}%`);
  console.log(`🔍 Total de queries executadas: ${queryStrings.length}`);
  console.log(`📁 Arquivo CSV gerado: ${csvPath}`);
  console.log(`=====================================\n`);
  console.log('🏁 Processo finalizado!');
}

main();
