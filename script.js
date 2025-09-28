const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

class GitHubAccessibilityMiner {
  constructor() {
    this.tokens = [
      process.env.GITHUB_TOKEN,
    ].filter(Boolean);
    this.tokenIndex = 0;
    this.token = this.tokens[0];
    this.tokenLimits = Array(this.tokens.length).fill(null);
    this.graphqlUrl = "https://api.github.com/graphql";
    this.restUrl = "https://api.github.com";
    this.csvFile = "repositorios_acessibilidade.csv";
    this.processedReposFile = "processed_repos.json";
    this.statsCsvFile = "stats.csv";
    this.maxRunMillis = (5 * 60 + 59) * 60 * 1000; // 5h59min em ms
    this.timeoutTriggered = false;
    this.processedRepos = this.loadProcessedRepos();
    this.seenRepos = new Set(); // Para evitar duplicatas durante a execução
    
    // Adicionar repositórios pulados do CSV
    const skippedCsv = 'repositorios_pulados.csv';
    if (fs.existsSync(skippedCsv)) {
      const lines = fs.readFileSync(skippedCsv, 'utf8').split('\n');
      for (let i = 1; i < lines.length; i++) {
        const repo = lines[i].trim();
        if (repo) this.processedRepos.add(repo);
      }
      this.saveProcessedRepos();
      console.log(`📋 Adicionados ${lines.length-1} repositórios pulados ao processed_repos.json`);
    }
    
    this.perPage = 100;
    this.startTime = Date.now();

    // Ferramentas de acessibilidade (multi-linguagem)
    this.accessibilityTools = {
      AXE: [
        "axe-core", "axe", "@axe-core", "react-axe", "axe-selenium",
        "cypress-axe", "jest-axe", "axe-playwright", "axe-webdriverjs", "vue-axe",
        "axe-selenium-python", "pytest-axe", "axe-core-python",
        "axe-selenium-java", "axe-core-maven", "axe-core-api",
        "selenium.axe", "axe.core", "axe-core-nuget",
        "axe-core-rspec", "axe-matchers", "axe-core-capybara",
        "axe-core-php", "dmore/chrome-mink-driver",
      ],
      Pa11y: [
        "pa11y", "pa11y-ci", "@pa11y", "pa11y-webdriver", "pa11y-reporter-cli",
        "pa11y-python", "accessibility-checker-python", "pa11y-dashboard", "koa-pa11y",
      ],
      WAVE: ["wave", "wave-cli", "wave-accessibility", "webaim-wave"],
      AChecker: [
        "achecker", "accessibility-checker", "ibma/equal-access",
        "equal-access", "accessibility-checker-engine",
      ],
      Lighthouse: [
        "lighthouse", "@lighthouse", "lighthouse-ci", "lhci", "lighthouse-batch",
        "lighthouse-plugin-accessibility", "lighthouse-ci-action",
        "pylighthouse", "lighthouse-python", "lighthouse-badges", "lighthouse-keeper",
      ],
      Asqatasun: ["asqatasun", "asqata-sun", "tanaguru", "contrast-finder"],
      HTML_CodeSniffer: [
        "html_codesniffer", "htmlcs", "squizlabs/html_codesniffer",
        "pa11y-reporter-htmlcs", "htmlcodesniffer", "html-codesniffer",
      ],
    };

    // Arquivos de configuração
    this.configFiles = [
      ".pa11yci.json", ".pa11yci.yaml", ".lighthouseci.json", ".html_codesniffer.json",
      "pa11y.json", "lighthouse.json", "axe.json", "wave.json",
      ".pa11y.json", ".lighthouse.json", ".axe.json", ".wave.json",
      "pa11y.js", "pa11yci.js", ".pa11yrc", ".pa11yrc.json", "lhci.json",
    ];

    this.stats = {
      analyzed: 0,
      saved: 0,
      errors: 0,
      skipped: 0,
      duplicates: 0,
      libraries: 0,
      nonWebApps: 0,
      inactive: 0,
      startTime: new Date().toISOString(),
    };
    this.loadReposFromCSV();
    this.initializeCSV();
  }

  initializeCSV() {
    if (!fs.existsSync(this.csvFile)) {
      const headers = [
        "Repositório", "Número de Estrelas", "Último Commit",
        "AXE", "Pa11y", "WAVE", "AChecker", "Lighthouse", "Asqatasun", "HTML_CodeSniffer",
      ].join(",");
      fs.writeFileSync(this.csvFile, headers + "\n");
    }
  }

  loadReposFromCSV() {
    try {
      if (fs.existsSync(this.csvFile)) {
        const csvContent = fs.readFileSync(this.csvFile, 'utf8');
        const lines = csvContent.split('\n');

        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line) {
            const columns = line.split(',');
            const repoName = columns[0];
            if (repoName && !this.processedRepos.has(repoName)) {
              this.processedRepos.add(repoName);
            }
          }
        }
        console.log(`📋 Carregados ${this.processedRepos.size} repositórios do CSV e JSON`);
      }
    } catch (error) {
      console.log(`⚠️ Erro ao carregar repositórios do CSV: ${error.message}`);
    }
  }

  loadProcessedRepos() {
    try {
      if (fs.existsSync(this.processedReposFile)) {
        const data = JSON.parse(fs.readFileSync(this.processedReposFile, "utf8"));
        console.log(`📋 Carregados ${data.length} repositórios já processados`);
        return new Set(data);
      }
    } catch (error) {
      console.log(`⚠️ Erro ao carregar repositórios processados: ${error.message}`);
    }
    return new Set();
  }

  saveProcessedRepos() {
    try {
      fs.writeFileSync(
        this.processedReposFile,
        JSON.stringify([...this.processedRepos], null, 2)
      );
    } catch (error) {
      console.log(`⚠️ Erro ao salvar repositórios processados: ${error.message}`);
    }
  }

  nextToken() {
    this.tokenIndex = (this.tokenIndex + 1) % this.tokens.length;
    this.token = this.tokens[this.tokenIndex];
  }

  switchTokenIfNeeded(rateLimit) {
    if (rateLimit !== null && rateLimit <= 0) {
      let startIndex = this.tokenIndex;
      let found = false;
      for (let i = 1; i <= this.tokens.length; i++) {
        let nextIndex = (startIndex + i) % this.tokens.length;
        if (!this.tokenLimits[nextIndex] || this.tokenLimits[nextIndex] > 0) {
          this.tokenIndex = nextIndex;
          this.token = this.tokens[this.tokenIndex];
          found = true;
          break;
        }
      }
      if (!found) {
        console.log('⏳ Todos os tokens atingiram o rate limit. Aguardando reset...');
      }
    }
  }

  async makeGraphQLRequest(query, variables = {}) {
    const options = {
      method: "POST",
      headers: {
        "User-Agent": "GitHub-Accessibility-Miner-Action",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
      timeout: 20000,
    };

    const response = await fetch(this.graphqlUrl, options);
    const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
    const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
    this.tokenLimits[this.tokenIndex] = rateLimit;
    this.switchTokenIfNeeded(rateLimit);

    if (rateLimit < 100) {
      const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
      console.log(
        `⏳ Rate limit baixo (${rateLimit}), aguardando ${Math.ceil(waitTime / 1000)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.errors) {
      throw new Error(`GraphQL Error: ${JSON.stringify(result.errors)}`);
    }

    return result.data;
  }

  async makeRestRequest(url) {
    const options = {
      headers: {
        "User-Agent": "GitHub-Accessibility-Miner-Action",
        Accept: "application/vnd.github.v3+json",
        Authorization: `token ${this.token}`,
      },
      timeout: 20000,
    };

    const response = await fetch(url, options);
    const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
    const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));
    this.tokenLimits[this.tokenIndex] = rateLimit;
    this.switchTokenIfNeeded(rateLimit);

    if (rateLimit < 50) {
      const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 0);
      console.log(
        `⏳ Rate limit REST baixo (${rateLimit}), aguardando ${Math.ceil(waitTime / 1000)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

  // Busca otimizada com queries mais específicas e filtros
  async searchRepositories(query, cursor = null) {
    const graphqlQuery = `
    query SearchRepositories($query: String!, $first: Int!, $after: String) {
      search(query: $query, type: REPOSITORY, first: $first, after: $after) {
        repositoryCount
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          ... on Repository {
            id
            name
            nameWithOwner
            description
            url
            homepageUrl
            stargazerCount
            updatedAt
            createdAt
            pushedAt
            primaryLanguage {
              name
            }
            languages(first: 10) {
              nodes {
                name
              }
            }
            repositoryTopics(first: 20) {
              nodes {
                topic {
                  name
                }
              }
            }
            owner {
              login
            }
            defaultBranchRef {
              name
            }
            isArchived
            isFork
            isPrivate
            licenseInfo {
              name
            }
          }
        }
      }
      rateLimit {
        remaining
        resetAt
      }
    }
  `;

    const variables = {
      query: `${query} sort:stars-desc`,
      first: this.perPage,
      after: cursor,
    };

    try {
      console.log(`🔍 Buscando GraphQL: "${query}"${cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""}`);
      const data = await this.makeGraphQLRequest(graphqlQuery, variables);

      if (data.rateLimit) {
        console.log(`   📊 Rate limit GraphQL: ${data.rateLimit.remaining} restantes`);
      }

      return {
        items: data.search.nodes || [],
        pageInfo: data.search.pageInfo,
        totalCount: data.search.repositoryCount,
      };
    } catch (error) {
      console.log(`❌ Erro na busca GraphQL: ${error.message}`);
      throw error;
    }
  }

  // Filtragem antecipada por metadados básicos
  isRepoEligibleByMetadata(repo) {
    // Verificar duplicata
    const repoId = repo.nameWithOwner || repo.full_name || `${(repo.owner && repo.owner.login) || ""}/${repo.name || ""}`;
    
    if (this.processedRepos.has(repoId) || this.seenRepos.has(repoId)) {
      this.stats.duplicates++;
      return { eligible: false, reason: "duplicata" };
    }
    
    this.seenRepos.add(repoId);

    // Verificar se teve commit após 1º setembro 2024 - CRITÉRIO ÚNICO
    const minDate = new Date("2024-09-01T00:00:00Z");
    const pushedAt = repo.pushedAt ? new Date(repo.pushedAt) : null;
    
    if (!pushedAt || pushedAt < minDate) {
      const lastPushStr = pushedAt ? pushedAt.toLocaleDateString('pt-BR') : 'nunca';
      this.stats.inactive++;
      return { eligible: false, reason: `sem commit após 01/09/2024 (último push: ${lastPushStr})` };
    }

    // Filtro rápido por linguagem - deve ter linguagem web
    const primaryLang = (repo.primaryLanguage && repo.primaryLanguage.name) || "";
    const webLanguages = [
      "JavaScript", "TypeScript", "Python", "PHP", "Ruby", "Java", "C#",
      "Go", "Rust", "HTML", "CSS", "Vue", "Svelte", "Dart"
    ];
    
    const hasWebLanguage = webLanguages.includes(primaryLang) || 
                          (repo.languages && repo.languages.nodes && 
                           repo.languages.nodes.some(l => webLanguages.includes(l.name)));

    if (!hasWebLanguage && stars < 20) {
      return { eligible: false, reason: `linguagem não-web (${primaryLang})` };
    }

    // Filtro rápido por nome - obvias bibliotecas
    const name = (repo.name || "").toLowerCase();
    const obviousLibPatterns = [
      /^lib/, /^@/, /-lib$/, /-ui$/, /-components?$/, /-utils?$/, /-helpers?$/,
      /^react-/, /^vue-/, /^ng-/, /^angular-/, /-plugin$/, /-extension$/,
      /^awesome-/, /^collection-/, /^list-/
    ];
    
    if (obviousLibPatterns.some(pattern => pattern.test(name))) {
      this.stats.libraries++;
      return { eligible: false, reason: "nome indica biblioteca" };
    }

    return { eligible: true, reason: "passou filtros básicos" };
  }

  // Verificação rápida se é biblioteca usando só metadados (sem README)
  isLibraryRepositoryFast(repo) {
    const name = (repo.name || "").toLowerCase();
    const fullName = ((repo.full_name || repo.nameWithOwner) || "").toLowerCase();
    const description = (repo.description || "").toLowerCase();

    let topicsArr = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topicsArr = repo.repositoryTopics.nodes.map(n => ((n && n.topic && n.topic.name) || "").toLowerCase());
    } else if (Array.isArray(repo.topics)) {
      topicsArr = repo.topics.map(t => (t || "").toLowerCase());
    }

    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();
    const combinedText = [description, name, fullName, topicsArr.join(" "), homepage].join(" ");

    // Palavras que DEFINITIVAMENTE indicam bibliotecas
    const strongLibraryKeywords = [
      "library", "lib", "biblioteca", "component library", "ui library", "design system",
      "ui components", "react components", "vue components", "angular components",
      "component kit", "ui kit", "framework", "toolkit", "boilerplate", "template",
      "starter kit", "npm package", "node module", "plugin", "extension", "addon",
      "middleware", "utility", "utils", "helper", "sdk", "api client", "wrapper",
      "binding", "polyfill", "collection"
    ];

    // Padrões no nome
    const libraryNamePatterns = [
      /^react-/, /^vue-/, /^angular-/, /^ng-/, /^@[^/]+\//, /-ui$/, /-components?$/,
      /-lib$/, /-kit$/, /-utils?$/, /-helpers?$/, /^ui-/, /^lib-/, /^utils-/,
      /-boilerplate$/, /-template$/, /-starter$/, /-seed$/, /-skeleton$/
    ];

    // Verificações
    const hasLibraryNamePattern = libraryNamePatterns.some(pattern => 
      pattern.test(name) || pattern.test(fullName)
    );
    
    const hasStrongLibraryKeywords = strongLibraryKeywords.some(keyword =>
      combinedText.includes(keyword)
    );

    const isAwesomeList = combinedText.includes("awesome") ||
                         combinedText.includes("curated list") ||
                         combinedText.includes("collection of");

    const isDocsOrTutorial = combinedText.includes("documentation") ||
                            combinedText.includes("tutorial") ||
                            combinedText.includes("example") ||
                            combinedText.includes("demo");

    return hasLibraryNamePattern || hasStrongLibraryKeywords || isAwesomeList || isDocsOrTutorial;
  }

  // Verificação rápida se é aplicação web
  isWebApplicationFast(repo) {
    const description = (repo.description || "").toLowerCase();
    const name = (repo.name || "").toLowerCase();

    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map(n => ((n && n.topic && n.topic.name) || "").toLowerCase());
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map(t => (t || "").toLowerCase());
    }

    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();
    const allContent = [description, name, topics.join(" "), homepage].join(" ");

    // Palavras que confirmam aplicação web
    const webAppKeywords = [
      "web application", "web app", "webapp", "website", "dashboard", "admin panel",
      "cms", "ecommerce", "e-commerce", "online store", "saas", "platform", "portal",
      "frontend", "fullstack", "spa", "pwa", "management system", "crm", "erp"
    ];

    const hasWebAppKeywords = webAppKeywords.some(keyword => allContent.includes(keyword));

    // Topics específicos que indicam aplicação
    const webAppTopics = [
      "webapp", "web-app", "website", "dashboard", "admin-panel", "cms",
      "ecommerce", "saas", "platform", "frontend", "fullstack", "spa", "pwa"
    ];

    const hasWebAppTopics = topics.some(topic => webAppTopics.includes(topic));
    const hasHomepage = !!(homepage && homepage.includes("http"));

    return hasWebAppKeywords || hasWebAppTopics || hasHomepage;
  }

  async getRepositoryContents(owner, repo, path = "") {
    const url = `${this.restUrl}/repos/${owner}/${repo}/contents/${path}`;

    try {
      const contents = await this.makeRestRequest(url);
      return Array.isArray(contents) ? contents : [contents];
    } catch (error) {
      if (error.message && error.message.includes("404")) {
        return [];
      }
      throw error;
    }
  }

  async getFileContent(owner, repo, filePath) {
    try {
      const content = await this.makeRestRequest(
        `${this.restUrl}/repos/${owner}/${repo}/contents/${filePath}`
      );
      if (content && content.content) {
        return Buffer.from(content.content, "base64").toString("utf8");
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async analyzeRepository(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const name = repo.name || "";
    const fullName = repo.nameWithOwner || repo.full_name || `${owner}/${name}`;

    console.log(`🔬 Analisando: ${fullName} (⭐ ${repo.stargazerCount || repo.stargazers_count || 0})`);

    try {
      // Buscar informações do último commit para registro
      let lastCommitDate = repo.pushedAt ? new Date(repo.pushedAt) : null;
      try {
        const branch = (repo.defaultBranchRef && repo.defaultBranchRef.name) || "main";
        const commitsUrl = `${this.restUrl}/repos/${owner}/${name}/commits?sha=${branch}&per_page=1`;
        const commits = await this.makeRestRequest(commitsUrl);
        if (Array.isArray(commits) && commits.length > 0) {
          const commit = commits[0];
          const dateStr = commit.commit && commit.commit.committer && commit.commit.committer.date;
          if (dateStr) {
            lastCommitDate = new Date(dateStr);
          }
        }
      } catch (e) {
        // Usar pushedAt se não conseguir buscar commits
      }

      // Filtrar bibliotecas
      if (this.isLibraryRepositoryFast(repo)) {
        console.log(`   📚 Biblioteca/ferramenta detectada, pulando...`);
        this.stats.libraries++;
        return null;
      }

      // Verificar se é aplicação web
      if (!this.isWebApplicationFast(repo)) {
        console.log(`   ❌ Não é uma aplicação web, pulando...`);
        this.stats.nonWebApps++;
        return null;
      }

      const foundTools = {
        AXE: false, Pa11y: false, WAVE: false, AChecker: false,
        Lighthouse: false, Asqatasun: false, HTML_CodeSniffer: false,
      };

      // Verificar descrição/about do repositório
      await this.checkRepositoryAbout(repo, foundTools);

      // Verificar arquivos de configuração
      await this.checkConfigFiles(owner, name, foundTools);

      // Verificar arquivos de dependências
      await this.checkDependencyFiles(owner, name, foundTools);

      // Verificar workflows do GitHub
      await this.checkWorkflows(owner, name, foundTools);

      const hasAnyTool = Object.values(foundTools).some((tool) => tool);

      if (hasAnyTool) {
        const toolsFound = Object.keys(foundTools).filter((key) => foundTools[key]);
        console.log(`   ✅ Ferramentas: ${toolsFound.join(", ")}`);

        return {
          repository: fullName,
          stars: repo.stargazerCount || repo.stargazers_count || 0,
          lastCommit: lastCommitDate ? lastCommitDate.toISOString() : (pushedAt ? pushedAt.toISOString() : new Date().toISOString()),
          ...foundTools,
        };
      }

      console.log(`   ❌ Nenhuma ferramenta encontrada`);
      return null;
    } catch (error) {
      console.log(`   ⚠️ Erro: ${error.message}`);
      this.stats.errors++;
      return null;
    }
  }

  async checkRepositoryAbout(repo, foundTools) {
    const description = (repo.description || "");
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map(n => (n && n.topic && n.topic.name) || "");
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map(t => t || "");
    }
    const homepage = (repo.homepageUrl || repo.homepage || "");

    const aboutContent = [description, topics.join(" "), homepage].join(" ").toLowerCase();

    if (aboutContent.trim()) {
      console.log(`     📋 Analisando descrição/about do repositório`);
      this.searchToolsInContent(aboutContent, foundTools);

      const accessibilityKeywords = [
        "accessibility", "accessible", "a11y", "wcag", "aria", "screen reader",
        "keyboard navigation", "color contrast", "accessibility testing",
        "accessibility audit", "web accessibility", "inclusive design"
      ];

      if (accessibilityKeywords.some(keyword => aboutContent.includes(keyword))) {
        console.log(`     ♿ Menção de acessibilidade encontrada na descrição`);
        
        const implicitTools = {
          "accessibility audit": ["AXE", "Pa11y", "Lighthouse"],
          "accessibility testing": ["AXE", "Pa11y", "WAVE"],
          "wcag compliance": ["AXE", "AChecker", "WAVE"],
          "a11y testing": ["AXE", "Pa11y"],
        };

        for (const [phrase, tools] of Object.entries(implicitTools)) {
          if (aboutContent.includes(phrase)) {
            tools.forEach(tool => {
              if (!foundTools[tool]) {
                console.log(`     🔍 ${tool} inferido por menção: "${phrase}"`);
                foundTools[tool] = true;
              }
            });
          }
        }
      }
    }
  }

  async checkConfigFiles(owner, name, foundTools) {
    try {
      const rootContents = await this.getRepositoryContents(owner, name);
      for (const file of rootContents) {
        const fileName = file && file.name ? file.name : "";
        if (this.configFiles.includes(fileName)) {
          console.log(`     📄 Config: ${fileName}`);
          if (fileName.includes("pa11y")) foundTools["Pa11y"] = true;
          if (fileName.includes("lighthouse") || fileName.includes("lhci")) foundTools["Lighthouse"] = true;
          if (fileName.includes("axe")) foundTools["AXE"] = true;
          if (fileName.includes("wave")) foundTools["WAVE"] = true;
          if (fileName.includes("html_codesniffer")) foundTools["HTML_CodeSniffer"] = true;
        }
      }
    } catch (error) {
      // Ignorar erros de acesso
    }
  }

  async checkDependencyFiles(owner, name, foundTools) {
    const dependencyFiles = [
      "package.json", "requirements.txt", "Pipfile", "composer.json", "pom.xml",
      "build.gradle", "Gemfile", "go.mod", "Cargo.toml", "pubspec.yaml"
    ];

    for (const depFile of dependencyFiles) {
      try {
        const content = await this.getFileContent(owner, name, depFile);
        if (content) {
          console.log(`     📦 Analisando ${depFile}`);
          this.searchToolsInContent(content, foundTools);
        }
      } catch (error) {
        // Ignorar arquivos inexistentes
      }
    }
  }

  async checkWorkflows(owner, name, foundTools) {
    try {
      const workflows = await this.getRepositoryContents(owner, name, ".github/workflows");
      for (const workflow of workflows) {
        const workflowName = (workflow && workflow.name) || "";
        if (workflowName.endsWith(".yml") || workflowName.endsWith(".yaml")) {
          const content = await this.getFileContent(owner, name, workflow.path);
          if (content) {
            console.log(`     ⚙️ Workflow: ${workflowName}`);
            this.searchToolsInContent(content, foundTools);
          }
        }
      }
    } catch (error) {
      // Ignorar se não tiver workflows
    }
  }

  searchToolsInContent(content, foundTools) {
    const contentLower = (content || "").toLowerCase();

    for (const [toolName, keywords] of Object.entries(this.accessibilityTools)) {
      if (!foundTools[toolName]) {
        for (const keyword of keywords) {
          if (contentLower.includes((keyword || "").toLowerCase())) {
            foundTools[toolName] = true;
            console.log(`       🎯 ${toolName} via: ${keyword}`);
            break;
          }
        }
      }
    }
  }

  appendToCSV(repositories) {
    if (repositories.length === 0) return;

    const csvLines = repositories.map((repo) => {
      return [
        repo.repository,
        repo.stars,
        repo.lastCommit,
        repo.AXE,
        repo.Pa11y,
        repo.WAVE,
        repo.AChecker,
        repo.Lighthouse,
        repo.Asqatasun,
        repo.HTML_CodeSniffer,
      ].join(",");
    });

    fs.appendFileSync(this.csvFile, csvLines.join("\n") + "\n");
    console.log(`💾 ${repositories.length} repositórios salvos no CSV`);
  }

  printFinalStatsAndSave() {
    const analyzed = this.stats.analyzed;
    const saved = this.stats.saved;
    const percent = analyzed === 0 ? 0 : ((saved / analyzed) * 100).toFixed(2);
    console.log("\n⏰ EXECUÇÃO FINALIZADA");
    console.log(`🔬 Total de repositórios analisados: ${analyzed}`);
    console.log(`💾 Total de repositórios salvos: ${saved}`);
    console.log(`⏭️ Repositórios pulados:`);
    console.log(`   - Duplicatas: ${this.stats.duplicates}`);
    console.log(`   - Bibliotecas: ${this.stats.libraries}`);
    console.log(`   - Não-webapps: ${this.stats.nonWebApps}`);
    console.log(`   - Inativos: ${this.stats.inactive}`);
    console.log(`❌ Erros: ${this.stats.errors}`);
    console.log(`📈 Taxa de sucesso: ${percent}%`);
    
    const statsContent = [
      "total_analisados,total_salvos,duplicatas,bibliotecas,nao_webapps,inativos,erros,taxa_sucesso",
      `${analyzed},${saved},${this.stats.duplicates},${this.stats.libraries},${this.stats.nonWebApps},${this.stats.inactive},${this.stats.errors},${percent}`
    ].join("\n");
    fs.writeFileSync(this.statsCsvFile, statsContent);
    console.log(`📄 Estatísticas salvas em ${this.statsCsvFile}`);
  }

  shouldContinueRunning() {
    if (this.timeoutTriggered) return false;
    const elapsed = Date.now() - this.startTime;
    if (elapsed >= this.maxRunMillis) {
      this.timeoutTriggered = true;
      this.printFinalStatsAndSave();
      return false;
    }
    return true;
  }

  printProgress() {
    const elapsed = Date.now() - this.startTime;
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));

    console.log(`\n📊 PROGRESSO ATUAL:`);
    console.log(`⏱️  Tempo decorrido: ${hours}h ${minutes}m`);
    console.log(`🔬 Repositórios analisados: ${this.stats.analyzed}`);
    console.log(`💾 Repositórios salvos: ${this.stats.saved}`);
    console.log(`⏭️  Filtrados por:`);
    console.log(`   - Duplicatas: ${this.stats.duplicates}`);
    console.log(`   - Bibliotecas: ${this.stats.libraries}`);
    console.log(`   - Não-webapps: ${this.stats.nonWebApps}`);
    console.log(`   - Inativos: ${this.stats.inactive}`);
    console.log(`❌ Erros: ${this.stats.errors}`);
    console.log(`📈 Taxa de sucesso: ${(this.stats.saved / Math.max(this.stats.analyzed, 1) * 100).toFixed(1)}%`);
    console.log(`🗃️  Total processados: ${this.processedRepos.size}\n`);
  }

  async run() {
    console.log("🚀 GITHUB ACCESSIBILITY MINER - VERSÃO OTIMIZADA");
    console.log(`🔑 Token configurado: ${this.token ? "✅" : "❌"}`);
    console.log(`📊 Repositórios já processados: ${this.processedRepos.size}`);
    console.log(`📅 Critério de data: commits após 1º setembro 2024`);
    console.log(`🎯 Foco: aplicações web com ferramentas de acessibilidade\n`);

    // Queries otimizadas com filtros específicos
    const optimizedQueries = [
      // Linguagens web + termos de aplicação - excluindo bibliotecas
      'language:JavaScript "web application" -topic:library -topic:framework stars:>2',
      'language:TypeScript "web app" -topic:component -topic:ui-library stars:>2',
      'language:Python "django" OR "flask" OR "fastapi" "web app" -topic:library stars:>2',
      'language:PHP "web application" -topic:library -topic:package stars:>2',
      'language:Ruby "rails" "web app" -topic:gem -topic:library stars:>2',
      'language:Java "spring boot" "web application" -topic:library stars:>2',
      
      // Tipos específicos de aplicação
      'topic:webapp -topic:library -topic:template stars:>1',
      'topic:dashboard -topic:component -topic:ui-kit stars:>1',
      'topic:ecommerce "web" -topic:library stars:>1',
      'topic:cms "web application" -topic:plugin stars:>1',
      'topic:crm "web" -topic:library stars:>1',
      'topic:saas "web platform" -topic:framework stars:>1',
      
      // Frameworks de aplicação web
      'topic:react "web application" -topic:component-library -topic:ui-library stars:>2',
      'topic:vue "web app" -topic:component -topic:ui stars:>2',
      'topic:angular "web application" -topic:library -topic:component stars:>2',
      'topic:nextjs "web app" -topic:template -topic:boilerplate stars:>2',
      'topic:nuxtjs "web application" -topic:template stars:>2',
      
      // Contextos de negócio
      '"management system" web -topic:library stars:>1',
      '"admin panel" web -topic:component stars:>1',
      '"online platform" -topic:library stars:>1',
      '"business application" web -topic:framework stars:>1',
      
      // Com menção de acessibilidade
      'accessibility "web application" -topic:library stars:>0',
      'a11y "web app" -topic:library stars:>0',
      'wcag "web" -topic:library stars:>0',
      '"accessible web" application -topic:library stars:>0',
    ];

    const foundRepos = [];
    let queryIndex = 0;

    // Timer de segurança
    setTimeout(() => {
      this.timeoutTriggered = true;
      this.printFinalStatsAndSave();
      process.exit(0);
    }, this.maxRunMillis);

    while (this.shouldContinueRunning()) {
      try {
        const query = optimizedQueries[queryIndex % optimizedQueries.length];
        console.log(`\n🔍 Query otimizada ${queryIndex + 1}/${optimizedQueries.length}: "${query}"`);

        let cursor = null;
        let pageCount = 0;
        const maxPagesPerQuery = 5; // Reduzido para evitar sobreposição

        do {
          pageCount++;
          console.log(`   📄 Página ${pageCount}${cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""}`);

          const searchResult = await this.searchRepositories(query, cursor);

          if (!searchResult.items || searchResult.items.length === 0) {
            console.log(`   📭 Sem resultados nesta página.`);
            break;
          }

          let processedInPage = 0;
          for (const repo of searchResult.items) {
            if (!this.shouldContinueRunning()) break;

            // Filtro antecipado por metadados
            const eligibility = this.isRepoEligibleByMetadata(repo);
            if (!eligibility.eligible) {
              console.log(`   ⏭️ ${repo.nameWithOwner || repo.name}: ${eligibility.reason}`);
              continue;
            }

            this.stats.analyzed++;
            processedInPage++;

            const analysis = await this.analyzeRepository(repo);

            if (analysis) {
              foundRepos.push(analysis);
              this.stats.saved++;

              // Salvar em lotes menores para eficiência
              if (foundRepos.length >= 3) {
                this.appendToCSV(foundRepos);
                foundRepos.forEach((r) => this.processedRepos.add(r.repository));
                this.saveProcessedRepos();
                foundRepos.length = 0;
              }
            }

            this.processedRepos.add(repo.nameWithOwner || repo.full_name || `${repo.owner?.login || ""}/${repo.name || ""}`);

            // Pausa entre repos
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          console.log(`   📊 Página ${pageCount}: ${processedInPage} repos elegíveis processados`);

          // Mostrar progresso a cada 25 repos analisados
          if (this.stats.analyzed % 25 === 0 && this.stats.analyzed > 0) {
            this.printProgress();
          }

          // Próxima página
          if (searchResult.pageInfo?.hasNextPage && pageCount < maxPagesPerQuery) {
            cursor = searchResult.pageInfo.endCursor;
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            cursor = null;
          }
        } while (cursor && this.shouldContinueRunning());

        queryIndex++;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.log(`❌ Erro na execução: ${error.message}`);

        if (error.message.includes("rate limit")) {
          console.log(`⏳ Rate limit atingido, aguardando 2 minutos...`);
          await new Promise((resolve) => setTimeout(resolve, 120000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        this.stats.errors++;
      }
    }

    // Salvar repositórios restantes
    if (foundRepos.length > 0) {
      this.appendToCSV(foundRepos);
      foundRepos.forEach((r) => this.processedRepos.add(r.repository));
    }

    this.saveProcessedRepos();

    if (!this.timeoutTriggered) {
      console.log(`\n🎉 EXECUÇÃO FINALIZADA COM SUCESSO!`);
      this.printProgress();
      console.log(`📄 Arquivo CSV: ${this.csvFile}`);
      console.log(`🗃️ Arquivo de controle: ${this.processedReposFile}`);
    }
  }
}

// Executar
const miner = new GitHubAccessibilityMiner();
miner.run().catch((error) => {
  console.error("💥 Erro fatal:", error);
  process.exit(1);
});
