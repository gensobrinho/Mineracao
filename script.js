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

// Configuração de filtros de data
const DATE_FILTERS = {
  "1-mes": 1,
  "3-meses": 3,
  "6-meses": 6,
  "1-ano": 12
};

// Configurar o filtro de data desejado (altere aqui conforme necessário)
const SELECTED_DATE_FILTER = "1-ano"; // Opções: "1-mes", "3-meses", "6-meses", "1-ano"

// Função para verificar se o repositório está dentro do período
function isWithinDateRange(commitDate, monthsAgo) {
  if (!commitDate) return false;
  
  const commit = new Date(commitDate);
  const limit = new Date();
  limit.setMonth(limit.getMonth() - monthsAgo);
  
  return commit >= limit;
}

// Função para formatar data para exibição
function formatDate(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR');
}

// Função para detectar se é uma biblioteca
function isLibrary(repoName, description) {
  const libraryKeywords = [
    'library', 'lib', 'sdk', 'framework', 'toolkit', 'engine',
    'package', 'module', 'plugin', 'extension', 'addon',
    'wrapper', 'client', 'api', 'core', 'utils', 'helpers',
    'components', 'ui-components', 'design-system', 'kit',
    'boilerplate', 'template', 'starter', 'scaffold',
    'polyfill', 'shim', 'poly', 'ponyfill', 'framework‑free', 'component'
  ];
  
  const text = `${repoName} ${description || ''}`.toLowerCase();
  return libraryKeywords.some(keyword => text.includes(keyword));
}

// Função para detectar se é uma aplicação web
function isWebApp(repoName, description) {
  const webAppKeywords = [
    'app', 'application', 'website', 'site', 'webapp', 'web-app',
    'dashboard', 'admin', 'portal', 'platform', 'service',
    'frontend', 'front-end', 'spa', 'pwa', 'cms', 'blog',
    'ecommerce', 'e-commerce', 'shop', 'store', 'marketplace',
    'landing', 'landing-page', 'portfolio', 'showcase',
    'game', 'tool', 'editor', 'builder', 'generator',
    'web application', 'web-application'
  ];
  
  const text = `${repoName} ${description || ''}`.toLowerCase();
  return webAppKeywords.some(keyword => text.includes(keyword));
}

// Função para verificar estrutura de aplicação web
async function hasWebAppStructure(owner, repo) {
  const webAppFiles = [
    'index.html', 'app.html', 'main.html', 'home.html',
    'public/index.html', 'src/index.html', 'app/index.html',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'vercel.json', 'netlify.toml', 'firebase.json'
  ];
  
  // Verificar alguns arquivos chave (limitado para não sobrecarregar API)
  const filesToCheck = webAppFiles.slice(0, 6); // Verificar apenas os primeiros 3
  
  for (const fileName of filesToCheck) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${fileName}`;
    
    try {
      const response = await fetchWithTimeout(url, {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      }, 5000); // Timeout menor para verificação rápida
      
      if (response.ok) {
        return true; // Encontrou pelo menos um arquivo típico de web app
      }
    } catch (error) {
      // Continua verificando outros arquivos
    }
  }
  
  return false;
}

const writeHeader = () => {
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(
      csvPath,
      "Repositório,Estrelas,Data do Último Commit,AXE em Workflow,Pa11y em Workflow,Wave em Workflow,Asqata-sun em Workflow,HTML_CodeSniffer em Workflow,Equal Access em Workflow,Lighthouse em Workflow,AXE em Dependência,Pa11y em Dependência,Wave em Dependência,Asqata-sun em Dependência,HTML_CodeSniffer em Dependência,Equal Access em Dependência,Lighthouse em Dependência\n"
    );
  }
};

const appendToCSV = (row) => {
  const line = `${row.nameWithOwner},${row.stars},${row.lastCommit},${row.axe_wf},${row.pa11y_wf},${row.wave_wf},${row.asqata_wf},${row.htmlcs_wf},${row.equalaccess_wf},${row.lighthouse_wf},${row.axe_dep},${row.pa11y_dep},${row.wave_dep},${row.asqata_dep},${row.htmlcs_dep},${row.equalaccess_dep},${row.lighthouse_dep}\n`;
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
    const errorText = await response.text();
    console.error(`❌ Erro HTTP ${response.status}: ${response.statusText}`);
    console.error(`📄 Resposta: ${errorText}`);
    throw new Error(`Erro na solicitação GraphQL: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  
  // Debug: verificar se há erros na resposta
  if (data.errors) {
    console.error(`❌ Erros GraphQL:`, data.errors);
    throw new Error(`Erros GraphQL: ${data.errors.map(e => e.message).join(', ')}`);
  }
  
  if (!data.data) {
    console.error(`❌ Resposta sem data:`, data);
    throw new Error(`Resposta da API não contém 'data'`);
  }
  
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
    wave = false,
    asqata = false,
    htmlcs = false,
    equalaccess = false,
    lighthouse = false;

  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    if (response.status === 404) return { axe, pa11y, wave, asqata, htmlcs, equalaccess, lighthouse };
    if (!response.ok)
      throw new Error(`Erro ao buscar workflows: ${response.statusText}`);

    const files = await response.json();
    if (!Array.isArray(files)) return { axe, pa11y, wave, asqata, htmlcs, equalaccess, lighthouse };

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
          if (workflowContent.includes("axe") || workflowContent.includes("axe-core")) axe = true;
          if (workflowContent.includes("pa11y")) pa11y = true;
          if (workflowContent.includes("wave") || workflowContent.includes("webaim")) wave = true;
          if (workflowContent.includes("asqata") || workflowContent.includes("asqata-sun")) asqata = true;
          if (workflowContent.includes("html_codesniffer") || workflowContent.includes("html-codesniffer") || workflowContent.includes("htmlcodesniffer")) htmlcs = true;
          if (workflowContent.includes("equal access") || workflowContent.includes("equal-access") || workflowContent.includes("ibm equal access") || workflowContent.includes("achecker")) equalaccess = true;
          if (workflowContent.includes("lighthouse") || workflowContent.includes("lighthouse-ci") || workflowContent.includes("@lhci/cli")) lighthouse = true;
        } catch (error) {}
      }
    }
    return { axe, pa11y, wave, asqata, htmlcs, equalaccess, lighthouse };
  } catch (error) {
    return { axe, pa11y, wave, asqata, htmlcs, equalaccess, lighthouse };
  }
}

async function checkDependencies(owner, repo) {
  const dependencyFiles = [
    "package.json",
    "requirements.txt",
    "Gemfile",
    "composer.json",
    ".pa11yci.json",
    ".lighthouseci.json", 
    ".html_codesniffer.json",
    "pa11y.json",
    "lighthouse.json",
    "axe.json",
    "wave.json",
    ".pa11y.json",
    ".lighthouse.json",
    ".axe.json",
    ".wave.json",
    'pa11y.js',
    'pa11yci.js',
  ];
  let axe = false,
    pa11y = false,
    wave = false,
    asqata = false,
    htmlcs = false,
    equalaccess = false,
    lighthouse = false;

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
        if (content.includes("axe") || content.includes("axe-core")) axe = true;
        if (content.includes("pa11y")) pa11y = true;
        if (content.includes("wave") || content.includes("webaim")) wave = true;
        if (content.includes("asqata") || content.includes("asqata-sun")) asqata = true;
        if (content.includes("html_codesniffer") || content.includes("html-codesniffer") || content.includes("htmlcodesniffer")) htmlcs = true;
        if (content.includes("equal access") || content.includes("equal-access") || content.includes("ibm equal access") || content.includes("achecker")) equalaccess = true;
        if (content.includes("lighthouse") || content.includes("lighthouse-ci") || content.includes("@lhci/cli")) lighthouse = true;
      }
    } catch (error) {}
  }
  return { axe, pa11y, wave, asqata, htmlcs, equalaccess, lighthouse };
}

const searchRepositoriesQuery = `
query($queryString: String!, $first: Int!, $after: String) {
  search(query: $queryString, type: REPOSITORY, first: $first, after: $after) {
    repositoryCount
    edges {
      node {
        ... on Repository {
          name
          description
          owner { login }
          stargazerCount
          pushedAt
          defaultBranchRef {
            name
            target {
              ... on Commit { committedDate oid }
            }
          }
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

  console.log(
    "🚀 Iniciando coleta focada em projetos frontend e acessibilidade web..."
  );
  console.log("🔍 Escopo: Frontend, frameworks web, acessibilidade e ferramentas de teste");
  console.log("🎯 Filtro: Apenas repositórios com ferramentas axe-core, pa11y, WAVE, Asqata-sun, HTML_CodeSniffer, Equal Access/AChecker ou Lighthouse serão salvos");
  console.log(`📅 Filtro de data: DESABILITADO - Todos os repositórios serão analisados independente da data do último commit`);
  console.log("🌐 Filtro de tipo: Apenas aplicações web serão analisadas (bibliotecas serão excluídas)");

  const queryStrings = [
    // 🌟 Repositórios mais populares em geral (ordenados por estrelas)
    "stars:>1000 sort:stars-desc",
    "stars:>500 sort:stars-desc",
    "stars:>100 sort:stars-desc",
    "stars:>50 sort:stars-desc",
    "stars:>10 sort:stars-desc",

    // 💻 Repositórios populares por linguagem (mais propensos a ter web apps)
    // "language:JavaScript stars:>100 sort:stars-desc",
    // "language:TypeScript stars:>100 sort:stars-desc",
    // "language:HTML stars:>50 sort:stars-desc",
    // "language:CSS stars:>50 sort:stars-desc",

    // 🌐 Repositórios web populares por tópico
    "topic:web stars:>50 sort:stars-desc",
    "topic:website stars:>50 sort:stars-desc",
    "topic:webapp stars:>50 sort:stars-desc",
    "topic:frontend stars:>50 sort:stars-desc",
    // "topic:react stars:>100 sort:stars-desc",
    // "topic:vue stars:>100 sort:stars-desc",
    // "topic:angular stars:>100 sort:stars-desc",
    // "topic:nodejs stars:>100 sort:stars-desc",


    // 🔧 Busca específica pelas ferramentas de acessibilidade
    "axe-core in:name,description,readme sort:stars-desc",
    "axe in:name,description,readme sort:stars-desc",
    "pa11y in:name,description,readme sort:stars-desc",
    "WAVE in:name,description,readme sort:stars-desc",
    "wave in:name,description,readme sort:stars-desc",
    "asqata-sun in:name,description,readme sort:stars-desc",
    "asqata in:name,description,readme sort:stars-desc",
    "html_codesniffer in:name,description,readme sort:stars-desc",
    "html-codesniffer in:name,description,readme sort:stars-desc",
    "equal access in:name,description,readme sort:stars-desc",
    "ibm equal access in:name,description,readme sort:stars-desc",
    "achecker in:name,description,readme sort:stars-desc",
    "ibm achecker in:name,description,readme sort:stars-desc",
    "lighthouse in:name,description,readme sort:stars-desc",
    "lighthouse-ci in:name,description,readme sort:stars-desc",

    // 🎯 Termos de acessibilidade e UX/UI
    "accessibility in:name,description sort:stars-desc",
    "a11y in:name,description sort:stars-desc",
    "wcag in:name,description sort:stars-desc",
    "aria in:name,description sort:stars-desc",
    "ux in:name,description sort:stars-desc",
    "ui in:name,description sort:stars-desc",
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
        
        // Verificar se a resposta tem a estrutura esperada
        if (!data || !data.search) {
          console.error(`❌ Resposta inválida para query: ${queryString}`);
          console.error(`📄 Data recebida:`, data);
          break;
        }
        
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
            console.log(`⏭  Já processado anteriormente: ${nameWithOwner}`);
            continue;
          }

          // Obter data do último commit
          let lastCommit = repo.pushedAt || "";
          const target = repo.defaultBranchRef && repo.defaultBranchRef.target;
          if (target && target.committedDate) {
            lastCommit = target.committedDate;
          }

          // Verificar se está dentro do período desejado
          const isRecent = isWithinDateRange(lastCommit, DATE_FILTERS[SELECTED_DATE_FILTER]);

          if (!isRecent) {
            console.log(`⏭️  REPOSITÓRIO IGNORADO: ${nameWithOwner} - Último commit muito antigo (${formatDate(lastCommit)})`);
            processedRepos.add(nameWithOwner); // Marcar como processado para não verificar novamente
            continue;
          }

          // Verificar se parece ser uma aplicação web (prioridade)
          const looksLikeWebApp = isWebApp(repo.name, repo.description || '');
          const hasWebStructure = await hasWebAppStructure(repo.owner.login, repo.name);
          
          // Se é uma aplicação web, não verificar se é biblioteca
          if (looksLikeWebApp || hasWebStructure) {
            console.log(`✅ Aplicação web detectada: ${nameWithOwner}`);
          } else {
            // Só verificar se é biblioteca se não for aplicação web
            if (isLibrary(repo.name, repo.description || '')) {
              console.log(`⏭️ REPOSITÓRIO IGNORADO: ${nameWithOwner} - É uma biblioteca`);
              processedRepos.add(nameWithOwner); // Marcar como processado para não verificar novamente
              continue;
            }
            
            console.log(`⏭️ REPOSITÓRIO IGNORADO: ${nameWithOwner} - Não parece ser uma aplicação web`);
            processedRepos.add(nameWithOwner); // Marcar como processado para não verificar novamente
            continue;
          }

          // Adiciona repositório para análise (filtrado para aplicações web)
          processedRepos.add(nameWithOwner);
          queryAnalyzed++;
          totalAnalyzed++;

          console.log(
            `🔍 Analisando aplicação web (${queryAnalyzed}): ${nameWithOwner} (${repo.stargazerCount}⭐) - Último commit: ${formatDate(lastCommit)}`
          );

          const wf = await checkWorkflows(repo.owner.login, repo.name);
          const dep = await checkDependencies(repo.owner.login, repo.name);

          if (
            wf.axe ||
            wf.pa11y ||
            wf.wave ||
            wf.asqata ||
            wf.htmlcs ||
            wf.equalaccess ||
            wf.lighthouse ||
            dep.axe ||
            dep.pa11y ||
            dep.wave ||
            dep.asqata ||
            dep.htmlcs ||
            dep.equalaccess ||
            dep.lighthouse
          ) {
            appendToCSV({
              nameWithOwner,
              stars: repo.stargazerCount,
              lastCommit: formatDate(lastCommit),
              axe_wf: wf.axe ? "Sim" : "Nao",
              pa11y_wf: wf.pa11y ? "Sim" : "Nao",
              wave_wf: wf.wave ? "Sim" : "Nao",
              asqata_wf: wf.asqata ? "Sim" : "Nao",
              htmlcs_wf: wf.htmlcs ? "Sim" : "Nao",
              equalaccess_wf: wf.equalaccess ? "Sim" : "Nao",
              lighthouse_wf: wf.lighthouse ? "Sim" : "Nao",
              axe_dep: dep.axe ? "Sim" : "Nao",
              pa11y_dep: dep.pa11y ? "Sim" : "Nao",
              wave_dep: dep.wave ? "Sim" : "Nao",
              asqata_dep: dep.asqata ? "Sim" : "Nao",
              htmlcs_dep: dep.htmlcs ? "Sim" : "Nao",
              equalaccess_dep: dep.equalaccess ? "Sim" : "Nao",
              lighthouse_dep: dep.lighthouse ? "Sim" : "Nao",
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

          // Pequena pausa para evitar rate limiting
          await new Promise((resolve) => setTimeout(resolve, 100));
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
