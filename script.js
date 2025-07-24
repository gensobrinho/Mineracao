const fetch = require('node-fetch');
const fs = require('fs');
require('dotenv').config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  console.error('Erro: O token do GitHub não foi encontrado. Certifique-se de que o arquivo .env contém a variável GITHUB_TOKEN.');
  process.exit(1);
}

const csvPath = 'repositorios_acessibilidade.csv';
const processedReposPath = 'processed_repos.json';

// Carregar repositórios já processados para evitar duplicatas
let processedRepos = new Set();
if (fs.existsSync(processedReposPath)) {
  try {
    processedRepos = new Set(JSON.parse(fs.readFileSync(processedReposPath, 'utf8')));
  } catch (error) {
    console.log('Erro ao carregar repositórios processados, iniciando do zero.');
  }
}

const writeHeader = () => {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(
      csvPath,
      'Repositório,Estrelas,AXE em Workflow,Pa11y em Workflow,AXE em Dependência,Pa11y em Dependência,Outras Ferramentas\n'
    );
  }
};

const appendToCSV = (row) => {
  const line = `${row.nameWithOwner},${row.stars},${row.axe_wf},${row.pa11y_wf},${row.axe_dep},${row.pa11y_dep},${row.other_tools}\n`;
  fs.appendFileSync(csvPath, line);
};

const saveProcessedRepos = () => {
  fs.writeFileSync(processedReposPath, JSON.stringify(Array.from(processedRepos)));
};

async function graphqlRequest(query, variables, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch('https://api.github.com/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
      });

      if (!response.ok) {
        if (response.status === 403 && i < retries - 1) {
          console.log('Rate limit atingido, aguardando...');
          await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minuto
          continue;
        }
        throw new Error(`Erro na solicitação GraphQL: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.errors) {
        throw new Error(`Erro GraphQL: ${JSON.stringify(data.errors)}`);
      }
      return data.data;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Tentativa ${i + 1} falhou, tentando novamente...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
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
  let axe = false, pa11y = false, otherTools = [];

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    if (response.status === 404) return { axe, pa11y, otherTools };
    if (!response.ok) throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

    const files = await response.json();
    if (!Array.isArray(files)) return { axe, pa11y, otherTools };

    for (const file of files) {
      if (file.name.endsWith('.yml') || file.name.endsWith('.yaml')) {
        const workflowUrl = file.download_url;
        try {
          const workflowResponse = await fetchWithTimeout(workflowUrl, {}, 10000);
          if (!workflowResponse.ok) continue;
          const workflowContent = (await workflowResponse.text()).toLowerCase();
          
          // Detecção expandida de ferramentas de acessibilidade
          if (workflowContent.includes('axe') || workflowContent.includes('axe-core')) axe = true;
          if (workflowContent.includes('pa11y') || workflowContent.includes('pa11y-ci')) pa11y = true;
          
          // Outras ferramentas de acessibilidade
          const accessibilityTools = [
            'lighthouse', 'wave', 'html_codesniffer', 'accessibility-checker',
            'axe-core', 'pa11y', 'pa11y-ci', 'axe-cli', 'axe-webdriverjs',
            'accessibility', 'a11y', 'wcag', 'aria', 'screen-reader'
          ];
          
          for (const tool of accessibilityTools) {
            if (workflowContent.includes(tool) && !otherTools.includes(tool)) {
              otherTools.push(tool);
            }
          }
        } catch (error) {
          // Ignora erros individuais de workflow
        }
      }
    }
    return { axe, pa11y, otherTools };
  } catch (error) {
    return { axe, pa11y, otherTools };
  }
}

async function checkDependencies(owner, repo) {
  const dependencyFiles = [
    'package.json', 'requirements.txt', 'Gemfile', 'composer.json',
    'pom.xml', 'build.gradle', 'Cargo.toml', 'go.mod', 'pubspec.yaml',
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'
  ];
  let axe = false, pa11y = false, otherTools = [];

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
        
        // Detecção expandida
        if (content.includes('axe') || content.includes('axe-core')) axe = true;
        if (content.includes('pa11y') || content.includes('pa11y-ci')) pa11y = true;
        
        // Outras ferramentas de acessibilidade
        const accessibilityTools = [
          'lighthouse', 'wave', 'html_codesniffer', 'accessibility-checker',
          'axe-core', 'pa11y', 'pa11y-ci', 'axe-cli', 'axe-webdriverjs',
          'accessibility', 'a11y', 'wcag', 'aria', 'screen-reader',
          'jest-axe', 'cypress-axe', 'axe-core', 'pa11y-reporter'
        ];
        
        for (const tool of accessibilityTools) {
          if (content.includes(tool) && !otherTools.includes(tool)) {
            otherTools.push(tool);
          }
        }
      }
    } catch (error) {
      // Ignora erros individuais de arquivo
    }
  }
  return { axe, pa11y, otherTools };
}

async function checkReadmeAndDocs(owner, repo) {
  const files = ['README.md', 'README.txt', 'docs/README.md', 'documentation.md'];
  let otherTools = [];

  for (const fileName of files) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;

    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });

      if (response.status === 404) continue;
      if (!response.ok) continue;

      const file = await response.json();
      if (file.encoding === 'base64') {
        const content = Buffer.from(file.content, 'base64').toString('utf-8').toLowerCase();
        
        const accessibilityTools = [
          'lighthouse', 'wave', 'html_codesniffer', 'accessibility-checker',
          'axe-core', 'pa11y', 'pa11y-ci', 'axe-cli', 'axe-webdriverjs',
          'accessibility', 'a11y', 'wcag', 'aria', 'screen-reader',
          'jest-axe', 'cypress-axe', 'axe-core', 'pa11y-reporter'
        ];
        
        for (const tool of accessibilityTools) {
          if (content.includes(tool) && !otherTools.includes(tool)) {
            otherTools.push(tool);
          }
        }
      }
    } catch (error) {
      // Ignora erros
    }
  }
  return { otherTools };
}

// Múltiplas estratégias de busca
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
  'accessibility framework sort:stars-desc'
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
          description
          topics
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

async function processRepository(repo) {
  const nameWithOwner = `${repo.owner.login}/${repo.name}`;
  
  // Verifica se já foi processado
  if (processedRepos.has(nameWithOwner)) {
    return null;
  }

  console.log(`Analisando: ${nameWithOwner} (${repo.stargazerCount} estrelas)`);

  try {
    // Processamento paralelo das verificações
    const [wf, dep, docs] = await Promise.allSettled([
      checkWorkflows(repo.owner.login, repo.name),
      checkDependencies(repo.owner.login, repo.name),
      checkReadmeAndDocs(repo.owner.login, repo.name)
    ]);

    const wfResult = wf.status === 'fulfilled' ? wf.value : { axe: false, pa11y: false, otherTools: [] };
    const depResult = dep.status === 'fulfilled' ? dep.value : { axe: false, pa11y: false, otherTools: [] };
    const docsResult = docs.status === 'fulfilled' ? docs.value : { otherTools: [] };

    // Combina todas as ferramentas encontradas
    const allTools = [...new Set([
      ...wfResult.otherTools,
      ...depResult.otherTools,
      ...docsResult.otherTools
    ])];

    if (wfResult.axe || wfResult.pa11y || depResult.axe || depResult.pa11y || allTools.length > 0) {
      const row = {
        nameWithOwner,
        url: repo.url,
        stars: repo.stargazerCount,
        axe_wf: wfResult.axe ? 'Sim' : 'Não',
        pa11y_wf: wfResult.pa11y ? 'Sim' : 'Não',
        axe_dep: depResult.axe ? 'Sim' : 'Não',
        pa11y_dep: depResult.pa11y ? 'Sim' : 'Não',
        other_tools: allTools.join('; ')
      };

      appendToCSV(row);
      processedRepos.add(nameWithOwner);
      console.log(`Salvo no CSV: ${JSON.stringify(row)}`);
      return row;
    } else {
      console.log('Nenhuma ferramenta encontrada, não salvo no CSV.');
      processedRepos.add(nameWithOwner); // Marca como processado mesmo sem encontrar
      return null;
    }
  } catch (error) {
    console.log(`Erro ao processar ${nameWithOwner}: ${error.message}`);
    processedRepos.add(nameWithOwner); // Marca como processado para evitar reprocessamento
    return null;
  }
}

async function searchWithQuery(queryString, maxResults = 1000) {
  let found = 0;
  let totalSearched = 0;
  let after = null;
  const batchSize = 100; // Aumentado para processar mais por vez

  console.log(`\nIniciando busca com query: "${queryString}"`);

  while (found < maxResults) {
    const variables = {
      queryString,
      first: batchSize,
      after: after
    };

    console.log(`Buscando lote... já encontrados: ${found}, total buscados: ${totalSearched}`);
    
    try {
      const data = await graphqlRequest(searchRepositoriesQuery, variables);

      if (!data.search.edges.length) {
        console.log('Nenhum repositório retornado, encerrando busca.');
        break;
      }

      // Processa repositórios em paralelo (em lotes para não sobrecarregar)
      const batch = data.search.edges.slice(0, 10); // Processa 10 por vez
      totalSearched += batch.length; // Adiciona ao total de repositórios buscados
      
      const results = await Promise.allSettled(
        batch.map(edge => processRepository(edge.node))
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          found++;
          if (found >= maxResults) break;
        }
      }

      if (!data.search.pageInfo.hasNextPage) {
        console.log('Não há mais páginas de resultados.');
        break;
      }
      after = data.search.pageInfo.endCursor;

      // Salva progresso periodicamente
      if (found % 50 === 0) {
        saveProcessedRepos();
      }

      // Pequena pausa para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.log(`Erro na busca: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  console.log(`\n=== RESUMO DA QUERY: "${queryString}" ===`);
  console.log(`📊 Total de repositórios buscados: ${totalSearched}`);
  console.log(`✅ Repositórios com ferramentas de acessibilidade encontrados: ${found}`);
  console.log(`📈 Taxa de sucesso: ${totalSearched > 0 ? ((found / totalSearched) * 100).toFixed(2) : 0}%`);
  console.log(`===============================================\n`);

  return { found, totalSearched };
}

async function main() {
  writeHeader();
  let totalFound = 0;
  let totalSearched = 0;
  const maxResultsPerQuery = 500; // Aumentado o limite por query

  console.log('Iniciando busca otimizada por repositórios com ferramentas de acessibilidade...');

  for (const query of searchQueries) {
    if (totalFound >= 2000) { // Limite total aumentado
      console.log('Limite total atingido.');
      break;
    }

    const result = await searchWithQuery(query, maxResultsPerQuery);
    totalFound += result.found;
    totalSearched += result.totalSearched;
    
    console.log(`Query "${query}" completada. Encontrados: ${result.found}, Total buscados: ${result.totalSearched}`);
    console.log(`Total acumulado - Encontrados: ${totalFound}, Buscados: ${totalSearched}`);
    
    // Pausa entre queries para evitar rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  saveProcessedRepos();
  
  console.log(`\n🎉 ===== RESUMO FINAL ===== 🎉`);
  console.log(`📊 Total de repositórios buscados: ${totalSearched}`);
  console.log(`✅ Total de repositórios com ferramentas de acessibilidade: ${totalFound}`);
  console.log(`📈 Taxa de sucesso geral: ${totalSearched > 0 ? ((totalFound / totalSearched) * 100).toFixed(2) : 0}%`);
  console.log(`📁 Arquivo CSV gerado: ${csvPath}`);
  console.log(`📋 Controle de processamento: ${processedReposPath}`);
  console.log(`=====================================\n`);
}

main();
