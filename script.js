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

    // Sem controle de tempo interno - o GitHub Actions já controla com timeout-minutes: 35791
    this.startTime = Date.now();

    // Ferramentas de acessibilidade (multi-linguagem)
    this.accessibilityTools = {
      AXE: [
        // JavaScript/Node.js
        "axe-core",
        "axe",
        "@axe-core",
        "react-axe",
        "axe-selenium",
        "cypress-axe",
        "jest-axe",
        "axe-playwright",
        "axe-webdriverjs",
        "vue-axe",
        // Python
        "axe-selenium-python",
        "pytest-axe",
        "axe-core-python",
        // Java
        "axe-selenium-java",
        "axe-core-maven",
        "axe-core-api",
        // C#
        "selenium.axe",
        "axe.core",
        "axe-core-nuget",
        // Ruby
        "axe-core-rspec",
        "axe-matchers",
        "axe-core-capybara",
        // PHP
        "axe-core-php",
        "dmore/chrome-mink-driver",
      ],
      Pa11y: [
        // JavaScript/Node.js
        "pa11y",
        "pa11y-ci",
        "@pa11y",
        "pa11y-webdriver",
        "pa11y-reporter-cli",
        // Python
        "pa11y-python",
        "accessibility-checker-python",
        // Outros
        "pa11y-dashboard",
        "koa-pa11y",
      ],
      WAVE: ["wave", "wave-cli", "wave-accessibility", "webaim-wave"],
      AChecker: [
        "achecker",
        "accessibility-checker",
        "ibma/equal-access",
        "equal-access",
        "accessibility-checker-engine",
      ],
      Lighthouse: [
        // JavaScript/Node.js
        "lighthouse",
        "@lighthouse",
        "lighthouse-ci",
        "lhci",
        "lighthouse-batch",
        "lighthouse-plugin-accessibility",
        "lighthouse-ci-action",
        // Python
        "pylighthouse",
        "lighthouse-python",
        // Outros
        "lighthouse-badges",
        "lighthouse-keeper",
      ],
      Asqatasun: ["asqatasun", "asqata-sun", "tanaguru", "contrast-finder"],
      HTML_CodeSniffer: [
        "html_codesniffer",
        "htmlcs",
        "squizlabs/html_codesniffer",
        "pa11y-reporter-htmlcs",
        "htmlcodesniffer",
        "html-codesniffer",
      ],
    };

    // Arquivos de configuração
    this.configFiles = [
      ".pa11yci.json",
      ".pa11yci.yaml",
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
      "pa11y.js",
      "pa11yci.js",
      ".pa11yrc",
      ".pa11yrc.json",
      "lhci.json",
    ];

    this.stats = {
      analyzed: 0,
      saved: 0,
      errors: 0,
      skipped: 0,
      startTime: new Date().toISOString(),
    };
    this.loadReposFromCSV();
    this.initializeCSV();
  }

  initializeCSV() {
    if (!fs.existsSync(this.csvFile)) {
      const headers = [
        "Repositório",
        "Número de Estrelas",
        "Último Commit",
        "AXE",
        "Pa11y",
        "WAVE",
        "AChecker",
        "Lighthouse",
        "Asqatasun",
        "HTML_CodeSniffer",
      ].join(",");
      fs.writeFileSync(this.csvFile, headers + "\n");
    }
  }

  loadReposFromCSV() {
    try {
      if (fs.existsSync(this.csvFile)) {
        const csvContent = fs.readFileSync(this.csvFile, 'utf8');
        const lines = csvContent.split('\n');

        // Pular o cabeçalho
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
      console.log(
        `⚠️ Erro ao carregar repositórios processados: ${error.message}`
      );
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
      console.log(
        `⚠️ Erro ao salvar repositórios processados: ${error.message}`
      );
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
        `⏳ Rate limit baixo (${rateLimit}), aguardando ${Math.ceil(
          waitTime / 1000
        )}s...`
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
        `⏳ Rate limit REST baixo (${rateLimit}), aguardando ${Math.ceil(
          waitTime / 1000
        )}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  }

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
      console.log(
        `🔍 Buscando GraphQL: "${query}"${
          cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""
        }`
      );
      const data = await this.makeGraphQLRequest(graphqlQuery, variables);

      // Log do rate limit GraphQL
      if (data.rateLimit) {
        console.log(
          `   📊 Rate limit GraphQL: ${data.rateLimit.remaining} restantes`
        );
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

  async getReadmeContent(owner, repo) {
    const possibleNames = [
      "README.md",
      "README.MD",
      "README",
      "readme.md",
      "readme",
      "Readme.md",
    ];
    for (const name of possibleNames) {
      const content = await this.getFileContent(owner, repo, name);
      if (content) return content;
    }
    return null;
  }

  // Novo método isLibraryRepository usando README
  async isLibraryRepository(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const name = (repo.name || "").toLowerCase();
    const fullName = ((repo.full_name || repo.nameWithOwner) || "").toLowerCase();
    const description = (repo.description || "").toLowerCase();

    // topics pode vir como array de strings (REST) ou não existir; garantir string
    let topicsArr = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topicsArr = repo.repositoryTopics.nodes.map(
        (n) => ((n && n.topic && n.topic.name) || "").toLowerCase()
      );
    } else if (Array.isArray(repo.topics)) {
      topicsArr = repo.topics.map((t) => (t || "").toLowerCase());
    } else {
      topicsArr = [];
    }

    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();

    // 🔹 Tenta buscar o README
    let readmeContent = "";
    try {
      const readme = await this.getReadmeContent(owner, repo.name || repo.nameWithOwner);
      if (readme) {
        readmeContent = (readme || "").toLowerCase();
      }
    } catch (e) {
      // Sem README, segue sem ele
    }

    // 🔹 Combina tudo para análise
    const combinedText = [
      description,
      name,
      fullName,
      topicsArr.join(" "),
      homepage,
      readmeContent,
    ].join(" ");

    // Palavras que DEFINITIVAMENTE indicam bibliotecas/componentes
    const strongLibraryKeywords = [
      "library",
      "lib",
      "biblioteca",
      "component library",
      "ui library",
      "component collection",
      "design system",
      "ui components",
      "react components",
      "vue components",
      "angular components",
      "component kit",
      "ui kit",
      "framework",
      "toolkit",
      "boilerplate",
      "template",
      "starter kit",
      "starter template",
      "seed",
      "skeleton",
      "scaffold",
      "generator",
      "cli tool",
      "command line",
      "npm package",
      "node module",
      "plugin",
      "extension",
      "addon",
      "middleware",
      "utility",
      "utils",
      "utilities",
      "helper",
      "helpers",
      "sdk",
      "api client",
      "wrapper",
      "binding",
      "polyfill",
      "shim",
      "mock",
      "stub",
      "collection",
      // 🔹 Palavras comuns no README de libs
      "npm install",
      "yarn add",
      "composer require",
      "pip install",
      "gem install",
      "usage",
      "installation",
      "import ",
      "require(",
    ];

    // Padrões no nome que indicam bibliotecas
    const libraryNamePatterns = [
      /^react-/,
      /^vue-/,
      /^angular-/,
      /^ng-/,
      /^@[^/]+\//, // Prefixos comuns
      /-ui$/,
      /-components$/,
      /-lib$/,
      /-kit$/,
      /-utils$/,
      /-helpers$/, // Sufixos
      /^ui-/,
      /^lib-/,
      /^utils-/,
      /^helper-/,
      /^tool-/,
      /^cli-/, // Prefixos específicos
      /-boilerplate$/,
      /-template$/,
      /-starter$/,
      /-seed$/,
      /-skeleton$/,
    ];

    // Palavras que indicam aplicação REAL
    const appKeywords = [
      "web app",
      "webapp",
      "web application",
      "application",
      "app",
      "website",
      "site",
      "portal",
      "platform",
      "dashboard",
      "admin panel",
      "management system",
      "cms",
      "blog",
      "e-commerce",
      "ecommerce",
      "shop",
      "store",
      "marketplace",
      "social network",
      "chat app",
      "messaging",
      "game",
      "todo app",
      "task manager",
      "project management",
      "crm",
      "erp",
      "saas",
      "web service",
      "api server",
      "backend",
    ];

    // Verificar padrões fortes de biblioteca no nome
    const hasLibraryNamePattern = libraryNamePatterns.some(
      (pattern) => pattern.test(name) || pattern.test(fullName)
    );

    // Verificar palavras fortes de biblioteca no texto combinado
    const hasStrongLibraryKeywords = strongLibraryKeywords.some((keyword) =>
      combinedText.includes(keyword)
    );

    // Verificar palavras de aplicação
    const hasAppKeywords = appKeywords.some((keyword) =>
      combinedText.includes(keyword)
    );

    // Verificar se é "awesome list" ou coleção
    const isAwesomeList =
      combinedText.includes("awesome") ||
      combinedText.includes("curated list") ||
      combinedText.includes("collection of") ||
      combinedText.includes("list of");

    // Verificar se é documentação, tutorial ou exemplo
    const isDocsOrTutorial =
      combinedText.includes("documentation") ||
      combinedText.includes("tutorial") ||
      combinedText.includes("example") ||
      combinedText.includes("demo") ||
      combinedText.includes("sample") ||
      combinedText.includes("guide");

    // Verificar repositórios de configuração ou dotfiles
    const isConfigRepo =
      combinedText.includes("dotfiles") ||
      combinedText.includes("config") ||
      combinedText.includes("settings") ||
      combinedText.includes("configuration");

    // CRITÉRIOS DE EXCLUSÃO (é biblioteca se):
    const isLibrary =
      hasLibraryNamePattern ||
      (hasStrongLibraryKeywords && !hasAppKeywords) ||
      isAwesomeList ||
      isDocsOrTutorial ||
      isConfigRepo;

    // Log para debug
    if (isLibrary) {
      const reasons = [];
      if (hasLibraryNamePattern) reasons.push("nome suspeito");
      if (hasStrongLibraryKeywords && !hasAppKeywords)
        reasons.push("palavras de biblioteca");
      if (isAwesomeList) reasons.push("lista awesome");
      if (isDocsOrTutorial) reasons.push("docs/tutorial");
      if (isConfigRepo) reasons.push("configuração");
      if (readmeContent) reasons.push("README indica biblioteca");
      console.log(
        `   📚 Biblioteca detectada (${reasons.join(", ")}): ${repo.full_name || repo.nameWithOwner || ""}`
      );
    }

    return isLibrary;
  }

  isWebApplication(repo) {
    const description = (repo.description || "").toLowerCase();
    const name = (repo.name || "").toLowerCase();

    // Adaptar para GraphQL - topics vêm em formato diferente
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map((n) => ((n && n.topic && n.topic.name) || "").toLowerCase());
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map((t) => (t || "").toLowerCase());
    } else {
      topics = [];
    }

    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();

    // Combinar todas as informações
    const allContent = [description, name, topics.join(" "), homepage].join(" ");

    // Palavras que CONFIRMAM que é uma aplicação web
    const webAppKeywords = [
      // Tipos de aplicação
      "web application",
      "web app",
      "webapp",
      "website",
      "web platform",
      "web portal",
      "web interface",
      "web service",
      "online application",
      "web based",
      "browser based",
      "online platform",

      // Tipos específicos de aplicação
      "dashboard",
      "admin panel",
      "control panel",
      "management system",
      "cms",
      "content management",
      "blog platform",
      "forum",
      "ecommerce",
      "e-commerce",
      "online store",
      "shop",
      "marketplace",
      "social network",
      "social platform",
      "community platform",
      "chat application",
      "messaging app",
      "communication platform",
      "crm",
      "erp",
      "saas",
      "business application",
      "booking system",
      "reservation system",
      "ticketing system",
      "learning platform",
      "education platform",
      "lms",
      "portfolio site",
      "personal website",
      "company website",
      "news site",
      "media platform",
      "publishing platform",

      // Indicadores técnicos de aplicação web
      "frontend",
      "backend",
      "fullstack",
      "full-stack",
      "single page application",
      "spa",
      "progressive web app",
      "pwa",
      "responsive",
      "mobile-first",
      "cross-platform web",

      // Contextos de uso
      "deployed",
      "hosted",
      "live demo",
      "production",
      "users",
      "customers",
      "clients",
      "visitors",
    ];

    // Palavras que NEGAM que é uma aplicação (bibliotecas, ferramentas, etc.)
    const nonAppKeywords = [
      // Bibliotecas e componentes
      "library",
      "lib",
      "component library",
      "ui library",
      "design system",
      "components",
      "widgets",
      "elements",
      "controls",
      "framework",
      "toolkit",
      "sdk",
      "api client",
      "wrapper",

      // Ferramentas e utilitários
      "tool",
      "utility",
      "util",
      "helper",
      "plugin",
      "extension",
      "cli",
      "command line",
      "script",
      "automation",
      "generator",
      "builder",
      "compiler",
      "bundler",

      // Templates e boilerplates
      "template",
      "boilerplate",
      "starter",
      "seed",
      "skeleton",
      "scaffold",
      "example",
      "demo",
      "sample",
      "tutorial",

      // Documentação e recursos
      "documentation",
      "docs",
      "guide",
      "tutorial",
      "learning",
      "awesome",
      "curated",
      "collection",
      "list of",
      "resources",

      // Configuração e setup
      "config",
      "configuration",
      "setup",
      "dotfiles",
      "settings",
    ];

    // Verificar se tem palavras de aplicação web
    const hasWebAppKeywords = webAppKeywords.some((keyword) =>
      allContent.includes(keyword)
    );

    // Verificar se tem palavras que negam aplicação
    const hasNonAppKeywords = nonAppKeywords.some((keyword) =>
      allContent.includes(keyword)
    );

    // Verificar topics específicos que indicam aplicação
    const webAppTopics = [
      "webapp",
      "web-app",
      "website",
      "web-application",
      "dashboard",
      "admin-panel",
      "cms",
      "ecommerce",
      "e-commerce",
      "saas",
      "platform",
      "portal",
      "frontend",
      "fullstack",
      "spa",
      "pwa",
      "responsive",
      "bootstrap",
      "tailwind",
    ];

    const hasWebAppTopics = topics.some((topic) => webAppTopics.includes(topic));

    // Verificar se tem homepage (aplicações geralmente têm)
    const hasHomepage = !!(homepage && homepage.includes("http"));

    // LÓGICA DE DECISÃO:
    const isWebApp =
      (hasWebAppKeywords && !hasNonAppKeywords) || hasWebAppTopics || hasHomepage;

    // Log para debug
    if (!isWebApp) {
      const reasons = [];
      if (!hasWebAppKeywords) reasons.push("sem palavras de webapp");
      if (hasNonAppKeywords) reasons.push("tem palavras de biblioteca/ferramenta");
      if (!hasWebAppTopics) reasons.push("sem topics de webapp");
      if (!hasHomepage) reasons.push("sem homepage");

      console.log(`   🔍 Não é webapp (${reasons.join(", ")})`);
    } else {
      const reasons = [];
      if (hasWebAppKeywords && !hasNonAppKeywords) reasons.push("palavras de webapp");
      if (hasWebAppTopics) reasons.push("topics de webapp");
      if (hasHomepage) reasons.push("tem homepage");

      console.log(`   ✅ Confirmado como webapp (${reasons.join(", ")})`);
    }

    return isWebApp;
  }

  async checkRepositoryAbout(repo, foundTools) {
    const description = (repo.description || "");
    // Adaptar para GraphQL - topics vêm em formato diferente
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map((n) => (n && n.topic && n.topic.name) || "");
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map((t) => t || "");
    } else {
      topics = [];
    }
    const homepage = (repo.homepageUrl || repo.homepage || "");

    // Combinar todas as informações do "about"
    const aboutContent = [description, topics.join(" "), homepage].join(" ").toLowerCase();

    if (aboutContent.trim()) {
      console.log(`     📋 Analisando descrição/about do repositório`);

      // Buscar ferramentas na descrição
      this.searchToolsInContent(aboutContent, foundTools);

      // Verificar menções específicas de acessibilidade
      const accessibilityKeywords = [
        "accessibility",
        "accessible",
        "a11y",
        "wcag",
        "aria",
        "screen reader",
        "keyboard navigation",
        "color contrast",
        "accessibility testing",
        "accessibility audit",
        "accessibility compliance",
        "web accessibility",
        "inclusive design",
        "universal design",
        "disability",
        "assistive technology",
      ];

      const hasAccessibilityMention = accessibilityKeywords.some((keyword) =>
        aboutContent.includes(keyword)
      );

      if (hasAccessibilityMention) {
        console.log(`     ♿ Menção de acessibilidade encontrada na descrição`);

        // Se menciona acessibilidade, verificar mais profundamente
        // Procurar por ferramentas mesmo que não estejam explícitas
        const implicitTools = {
          "accessibility audit": ["AXE", "Pa11y", "Lighthouse"],
          "accessibility testing": ["AXE", "Pa11y", "WAVE"],
          "wcag compliance": ["AXE", "AChecker", "WAVE"],
          "a11y testing": ["AXE", "Pa11y"],
          "accessibility scanner": ["AXE", "WAVE", "AChecker"],
          "color contrast": ["AXE", "WAVE"],
          "screen reader": ["AXE", "Pa11y"],
        };

        for (const [phrase, tools] of Object.entries(implicitTools)) {
          if (aboutContent.includes(phrase)) {
            tools.forEach((tool) => {
              if (!foundTools[tool]) {
                console.log(`     🔍 ${tool} inferido por menção: "${phrase}"`);
                foundTools[tool] = true;
              }
            });
          }
        }
      }

      // Log dos topics se existirem
      if (topics.length > 0) {
        console.log(`     🏷️  Topics: ${topics.join(", ")}`);
      }
    }
  }

  // 1. FILTRO RÁPIDO DE WEBAPP (sem REST) - usando apenas dados GraphQL
  checkBasicWebAppIndicators(repo) {
    const name = (repo.name || "").toLowerCase();
    const description = (repo.description || "").toLowerCase();
    
    // Extrair topics
    const topics = [];
    if (repo.repositoryTopics && repo.repositoryTopics.nodes) {
      repo.repositoryTopics.nodes.forEach(topicNode => {
        if (topicNode.topic && topicNode.topic.name) {
          topics.push(topicNode.topic.name.toLowerCase());
        }
      });
    }
    const topicsText = topics.join(" ");

    // Texto combinado para análise
    const searchText = `${name} ${description} ${topicsText}`;

    // DETECTAR BIBLIOTECAS ÓBVIAS (eliminatórias)
    const obviousLibraryPatterns = [
      // Padrões de nome
      /^(lib|libs)-/,
      /-lib$/,
      /-library$/,
      /^react-/,
      /^vue-/,
      /^angular-/,
      /^jquery-/,
      /-component$/,
      /-components$/,
      /^ui-/,
      /-ui$/,
      /^css-/,
      /-css$/,
      /^npm-/,
      /-npm$/,
      /^node-/,
      /-node$/,
      /^js-/,
      /-js$/,
      /^webpack-/,
      /^babel-/,
      /^eslint-/,
      /-plugin$/,
      /-plugins$/,
      /-utils$/,
      /-util$/,
      /-helpers$/,
      /-helper$/,
      /-toolkit$/,
      /-sdk$/,
      /-api$/,
      /-client$/,
      /-wrapper$/,
    ];

    // Verificar padrões de nome
    if (obviousLibraryPatterns.some(pattern => pattern.test(name))) {
      console.log(`   📚 Padrão de biblioteca detectado no nome: ${name}`);
      return { isWebApp: false, reason: "biblioteca por padrão de nome" };
    }

    // Keywords que DEFINITIVAMENTE indicam bibliotecas
    const strongLibraryKeywords = [
      "npm package",
      "node module", 
      "javascript library",
      "react library",
      "vue library",
      "angular library",
      "css library",
      "ui library",
      "component library",
      "design system",
      "ui components",
      "react components",
      "vue components",
      "framework",
      "boilerplate",
      "template",
      "starter kit",
      "cli tool",
      "command line",
      "plugin",
      "extension",
      "middleware",
      "utility",
      "utils",
      "helper",
      "sdk",
      "api client",
      "wrapper",
      "polyfill",
    ];

    if (strongLibraryKeywords.some(keyword => searchText.includes(keyword))) {
      console.log(`   📚 Keywords de biblioteca detectadas`);
      return { isWebApp: false, reason: "biblioteca por keywords" };
    }

    // DETECTAR WEBAPPS POR KEYWORDS FORTES
    const strongWebAppKeywords = [
      // Tipos específicos de aplicação
      "web application",
      "web app", 
      "webapp",
      "website",
      "dashboard",
      "admin panel",
      "control panel",
      "management system",
      "cms",
      "content management",
      "blog platform",
      "ecommerce",
      "e-commerce", 
      "online store",
      "shop",
      "marketplace",
      "social network",
      "social platform",
      "chat application",
      "forum",
      "crm",
      "erp",
      "saas",
      "booking system",
      "ticketing system",
      "learning platform",
      "lms",
      "portfolio site",
      "company website",
      "news site",
      "media platform",

      // Topics específicos que confirmam webapp
      "frontend",
      "fullstack",
      "full-stack", 
      "single page application",
      "spa",
      "progressive web app",
      "pwa",
      "deployed",
      "hosted",
      "live demo",
      "production",
    ];

    const hasStrongWebAppIndicators = strongWebAppKeywords.some(keyword => 
      searchText.includes(keyword)
    );

    // Topics específicos que indicam webapp
    const webAppTopics = [
      "webapp",
      "web-app", 
      "website",
      "web-application",
      "dashboard",
      "admin-panel",
      "cms",
      "ecommerce",
      "e-commerce",
      "saas",
      "platform",
      "portal", 
      "frontend",
      "fullstack",
      "spa",
      "pwa",
    ];

    const hasWebAppTopics = topics.some(topic => webAppTopics.includes(topic));

    // Homepage (webapps geralmente têm)
    const homepage = (repo.homepageUrl || "").toLowerCase();
    const hasHomepage = !!(homepage && homepage.includes("http"));

    if (hasStrongWebAppIndicators || hasWebAppTopics) {
      console.log(`   ✅ Indicadores fortes de webapp detectados`);
      return { isWebApp: true, reason: "indicadores fortes de webapp" };
    }

    if (hasHomepage) {
      console.log(`   ✅ Homepage presente - possível webapp`);
      return { isWebApp: true, reason: "tem homepage" };
    }

    // Se chegou aqui: não tem sinais claros, precisa de verificação mais profunda
    console.log(`   🤔 Sinais ambíguos - precisa verificação detalhada`);
    return { isWebApp: null, reason: "ambíguo" };
  }

  // 2. DETECÇÃO RÁPIDA DE FERRAMENTAS (Quick Scan) - incluindo arquivos chave
  async quickToolScan(repo) {
    const description = (repo.description || "").toLowerCase();
    const homepageUrl = (repo.homepageUrl || "").toLowerCase();
    
    // Extrair topics
    const topics = [];
    if (repo.repositoryTopics && repo.repositoryTopics.nodes) {
      repo.repositoryTopics.nodes.forEach(topicNode => {
        if (topicNode.topic && topicNode.topic.name) {
          topics.push(topicNode.topic.name.toLowerCase());
        }
      });
    }
    const topicsText = topics.join(" ");

    // Texto combinado para busca
    const searchText = `${description} ${homepageUrl} ${topicsText}`;

    // ETAPA 2A: Verificar descrição/topics primeiro
    const foundTools = {
      AXE: false,
      Pa11y: false,
      WAVE: false,
      AChecker: false,
      Lighthouse: false,
      Asqatasun: false,
      HTML_CodeSniffer: false,
    };

    // Buscar ferramentas na descrição/topics
    this.searchToolsInContent(searchText, foundTools);

    // Se encontrou algo óbvio, retornar true
    if (Object.values(foundTools).some(tool => tool)) {
      const toolsFound = Object.keys(foundTools).filter(key => foundTools[key]);
      console.log(`   🔍 Quick scan (descrição): ${toolsFound.join(", ")}`);
      return true;
    }

    // ETAPA 2B: Verificar arquivos chave rapidamente
    const owner = (repo.owner && repo.owner.login) || "";
    const name = repo.name || "";
    
    // Lista de arquivos prioritários para quick scan
    const quickScanFiles = [
      "package.json",        // Node.js dependencies
      ".github/workflows/ci.yml",  // Common CI workflow
      ".github/workflows/test.yml", // Common test workflow  
      ".github/workflows/main.yml", // Common main workflow
    ];

    let foundInFiles = false;
    
    for (const filePath of quickScanFiles) {
      try {
        const content = await this.getFileContent(owner, name, filePath);
        if (content) {
          console.log(`   🔍 Quick scan: Verificando ${filePath}...`);
          
          // Reset foundTools para esta verificação
          const fileFoundTools = {
            AXE: false,
            Pa11y: false,
            WAVE: false,
            AChecker: false,
            Lighthouse: false,
            Asqatasun: false,
            HTML_CodeSniffer: false,
          };
          
          // Usar searchToolsInContent para encontrar ferramentas
          this.searchToolsInContent(content, fileFoundTools);
          
          if (Object.values(fileFoundTools).some(tool => tool)) {
            const toolsFound = Object.keys(fileFoundTools).filter(key => fileFoundTools[key]);
            console.log(`   🔍 Quick scan (${filePath}): ${toolsFound.join(", ")}`);
            foundInFiles = true;
            break; // Encontrou, não precisa verificar outros arquivos
          }
          
          // Para package.json, também verificar se é projeto web moderno
          if (filePath === "package.json") {
            try {
              const pkg = JSON.parse(content);
              const webDevKeywords = [
                "react", "vue", "angular", "svelte", "next", "nuxt", "gatsby",
                "express", "fastify", "koa", "nestjs",
                "webpack", "vite", "parcel", "rollup",
                "jest", "cypress", "playwright", "testing-library",
                "eslint", "prettier", "typescript"
              ];
              
              const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
              const hasWebDevDeps = Object.keys(dependencies).some(dep => 
                webDevKeywords.some(keyword => dep.includes(keyword))
              );
              
              if (hasWebDevDeps) {
                console.log(`   🔍 Quick scan: Projeto web moderno detectado em package.json`);
                foundInFiles = true;
                break;
              }
            } catch (e) {
              // Continuar se package.json não for válido
            }
          }
        }
      } catch (e) {
        // Arquivo não existe, continuar
      }
    }

    if (foundInFiles) {
      return true;
    }

    // ETAPA 2C: Se não encontrou workflows comuns, verificar se existe pasta de workflows
    try {
      const workflows = await this.getRepositoryContents(owner, name, ".github/workflows");
      if (workflows && workflows.length > 0) {
        console.log(`   🔍 Quick scan: Verificando workflows existentes...`);
        
        // Verificar até 3 workflows para não ser muito pesado
        const workflowsToCheck = workflows.slice(0, 3);
        
        for (const workflow of workflowsToCheck) {
          const workflowName = (workflow && workflow.name) || "";
          if (workflowName.endsWith(".yml") || workflowName.endsWith(".yaml")) {
            try {
              const content = await this.getFileContent(owner, name, workflow.path);
              if (content) {
                const workflowFoundTools = {
                  AXE: false,
                  Pa11y: false,
                  WAVE: false,
                  AChecker: false,
                  Lighthouse: false,
                  Asqatasun: false,
                  HTML_CodeSniffer: false,
                };
                
                this.searchToolsInContent(content, workflowFoundTools);
                
                if (Object.values(workflowFoundTools).some(tool => tool)) {
                  const toolsFound = Object.keys(workflowFoundTools).filter(key => workflowFoundTools[key]);
                  console.log(`   🔍 Quick scan (${workflowName}): ${toolsFound.join(", ")}`);
                  return true;
                }
              }
            } catch (e) {
              // Continuar com próximo workflow
            }
          }
        }
      }
    } catch (e) {
      // Sem workflows, continuar
    }

    // ETAPA 2D: Fallback conservador baseado em indicadores gerais
    const webDevKeywords = [
      // Frameworks web
      "react", "vue", "angular", "svelte", "next", "nuxt",
      "express", "django", "flask", "rails",
      // Tecnologias frontend
      "javascript", "typescript", "html", "css",
      "webpack", "vite", "frontend", "fullstack",
      // Testing que pode incluir a11y
      "testing", "jest", "cypress", "playwright",
      // Qualidade/CI que pode incluir a11y
      "quality", "ci", "continuous-integration", "github-actions",
      "eslint", "prettier"
    ];

    const hasWebDevIndicator = webDevKeywords.some(keyword => 
      searchText.includes(keyword)
    );

    if (hasWebDevIndicator) {
      console.log(`   🔍 Quick scan: Indicadores gerais de web development - prosseguindo`);
      return true;
    }

    console.log(`   ❌ Quick scan: Nenhum indicador relevante encontrado`);
    return false;
  }

  // 3. VERIFICAÇÃO DETALHADA DE WEBAPP (com REST) - PRIORIDADE MÁXIMA
  async isRealWebApplication(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const name = repo.name || "";
    
    console.log(`   🔍 Verificação detalhada de webapp...`);

    try {
      // 1. Buscar arquivos na raiz para detectar tipo de projeto
      const rootFiles = await this.getRepositoryContents(owner, name);
      const fileNames = rootFiles.map(f => f.name.toLowerCase());

      // INDICADORES FORTES DE WEBAPP
      const webAppFiles = [
        "index.html",
        "public/index.html", 
        "src/index.html",
        "app.html",
        "main.html",
        "home.html",
        "index.php",
        "app.php",
        "main.php",
        "index.jsx",
        "app.jsx",
        "index.tsx", 
        "app.tsx",
        "app.js",
        "main.js",
        "index.js",
        "server.js",
        "app.py",
        "main.py",
        "manage.py", // Django
        "wsgi.py",
        "asgi.py",
      ];

      const hasWebAppFiles = webAppFiles.some(file => 
        fileNames.some(fn => fn.includes(file))
      );

      // INDICADORES DE FRAMEWORK WEB
      const webFrameworkIndicators = [
        "package.json", // Node.js
        "requirements.txt", // Python
        "composer.json", // PHP
        "gemfile", // Ruby
        "go.mod", // Go
        "cargo.toml", // Rust
        "pom.xml", // Java Maven
        "build.gradle", // Java Gradle
      ];

      const hasFrameworkFiles = webFrameworkIndicators.some(file => 
        fileNames.includes(file)
      );

      // 2. Se tem package.json, verificar se é webapp Node.js
      if (fileNames.includes("package.json")) {
        try {
          const packageJson = await this.getFileContent(owner, name, "package.json");
          if (packageJson) {
            const pkg = JSON.parse(packageJson);
            
            // Scripts que indicam webapp
            const webAppScripts = ["start", "serve", "dev", "build", "deploy"];
            const hasWebAppScripts = webAppScripts.some(script => 
              pkg.scripts && pkg.scripts[script]
            );

            // Dependências que indicam webapp frontend
            const frontendDeps = [
              "react", "vue", "angular", "svelte", "next", "nuxt", "gatsby", 
              "webpack", "vite", "parcel", "rollup", "express", "fastify", 
              "koa", "hapi", "nestjs", "bootstrap", "tailwind", "material-ui",
              "styled-components", "emotion", "chakra-ui"
            ];

            const dependencies = {
              ...pkg.dependencies, 
              ...pkg.devDependencies
            };

            const hasFrontendDeps = frontendDeps.some(dep => 
              Object.keys(dependencies).some(key => key.includes(dep))
            );

            if (hasWebAppScripts || hasFrontendDeps) {
              console.log(`   ✅ Confirmado: webapp Node.js`);
              return true;
            }
          }
        } catch (e) {
          // Continuar verificação mesmo se package.json der erro
        }
      }

      // 3. Se tem requirements.txt, verificar se é webapp Python
      if (fileNames.includes("requirements.txt")) {
        try {
          const requirements = await this.getFileContent(owner, name, "requirements.txt");
          if (requirements) {
            const pythonWebFrameworks = [
              "django", "flask", "fastapi", "tornado", "pyramid", 
              "bottle", "cherrypy", "falcon", "sanic", "quart", "starlette"
            ];

            const hasWebFramework = pythonWebFrameworks.some(framework => 
              requirements.toLowerCase().includes(framework)
            );

            if (hasWebFramework) {
              console.log(`   ✅ Confirmado: webapp Python`);
              return true;
            }
          }
        } catch (e) {
          // Continuar verificação
        }
      }

      // 4. Verificar estrutura de pastas típica de webapp
      const webAppFolders = ["public", "src", "app", "views", "templates", "static", "assets"];
      const hasWebAppFolders = webAppFolders.some(folder => 
        fileNames.includes(folder)
      );

      // 5. DECISÃO FINAL
      if (hasWebAppFiles || (hasFrameworkFiles && hasWebAppFolders)) {
        console.log(`   ✅ Confirmado: estrutura de webapp detectada`);
        return true;
      }

      console.log(`   ❌ Não confirmado como webapp após verificação detalhada`);
      return false;

    } catch (error) {
      console.log(`   ⚠️ Erro na verificação detalhada: ${error.message}`);
      // Em caso de erro, ser conservador e assumir que pode ser webapp
      return true;
    }
  }

  async analyzeRepository(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const name = repo.name || "";
    const fullName = repo.nameWithOwner || repo.full_name || `${owner}/${name}`;

    console.log(
      `🔬 Analisando: ${fullName} (⭐ ${repo.stargazerCount || repo.stargazers_count || 0})`
    );

    try {
      // ETAPA 0: Verificar se o repositório está ativo
      const minDate = new Date("2024-01-01T00:00:00Z");
      const pushedAt = repo.pushedAt ? new Date(repo.pushedAt) : null;
      const createdAt = repo.createdAt ? new Date(repo.createdAt) : null;
      
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      
      const stars = repo.stargazerCount || repo.stargazers_count || 0;
      const isRecentRepo = createdAt && createdAt >= twoYearsAgo;
      const hasRecentPush = pushedAt && pushedAt >= minDate;
      const isPopular = stars >= 10;
      
      if (!isRecentRepo && !hasRecentPush && !isPopular) {
        const lastPushStr = pushedAt ? pushedAt.toLocaleDateString('pt-BR') : 'nunca';
        console.log(`   📅 Repositório inativo (último push: ${lastPushStr}, ${stars} ⭐), pulando...`);
        return null;
      }

      // ETAPA 1: FILTRO RÁPIDO DE WEBAPP (sem REST)
      console.log(`   🔍 Etapa 1: Verificação rápida de webapp...`);
      const webAppCheck = this.checkBasicWebAppIndicators(repo);
      
      if (webAppCheck.isWebApp === false) {
        console.log(`   📚 Não é webapp (${webAppCheck.reason}), pulando...`);
        return null;
      }

      // ETAPA 2: DETECÇÃO RÁPIDA DE FERRAMENTAS (Quick Scan)
      console.log(`   🔍 Etapa 2: Busca rápida de ferramentas...`);
      if (!await this.quickToolScan(repo)) {
        console.log(`   ❌ Nenhuma ferramenta detectada no quick scan, pulando...`);
        return null;
      }

      // ETAPA 3: VERIFICAÇÕES DETALHADAS COM REST (apenas candidatos fortes)
      console.log(`   🔍 Etapa 3: Verificações detalhadas...`);

      // 3.1: Verificar se realmente é biblioteca (REST)
      if (await this.isLibraryRepository(repo)) {
        console.log(`   📚 Biblioteca/ferramenta detectada após análise detalhada, pulando...`);
        return null;
      }

      // 3.2: VERIFICAÇÃO DETALHADA DE WEBAPP (PRIORIDADE MÁXIMA)
      // Se teve resultado ambíguo na etapa 1, fazer verificação completa
      if (webAppCheck.isWebApp === null) {
        const isReallyWebApp = await this.isRealWebApplication(repo);
        if (!isReallyWebApp) {
          console.log(`   ❌ Não confirmado como webapp após verificação detalhada, pulando...`);
          return null;
        }
      }

      console.log(`   ✅ Passou em todas as verificações - iniciando busca detalhada...`);

      // Buscar informações do último commit para registro
      let lastCommitDate = pushedAt;
      let lastCommitSha = null;
      try {
        const branch = (repo.defaultBranchRef && repo.defaultBranchRef.name) || "main";
        const commitsUrl = `${this.restUrl}/repos/${owner}/${name}/commits?sha=${branch}&per_page=1`;
        const commits = await this.makeRestRequest(commitsUrl);
        if (Array.isArray(commits) && commits.length > 0) {
          const commit = commits[0];
          const dateStr = commit.commit && commit.commit.committer && commit.commit.committer.date;
          if (dateStr) {
            lastCommitDate = new Date(dateStr);
            lastCommitSha = commit.sha;
          }
        }
      } catch (e) {
        // Usar pushedAt se não conseguir buscar commits
      }

      // ETAPA 4: BUSCA DETALHADA DE FERRAMENTAS (apenas candidatos confirmados)
      const foundTools = {
        AXE: false,
        Pa11y: false,
        WAVE: false,
        AChecker: false,
        Lighthouse: false,
        Asqatasun: false,
        HTML_CodeSniffer: false,
      };

      console.log(`   🔍 Etapa 4: Busca detalhada de ferramentas...`);

      // 4.1: Verificar descrição/about do repositório (dados GraphQL)
      await this.checkRepositoryAbout(repo, foundTools);

      // 4.2: Verificar arquivos de configuração (REST)
      await this.checkConfigFiles(owner, name, foundTools);

      // 4.3: Verificar arquivos de dependências (REST)
      await this.checkDependencyFiles(owner, name, foundTools);

      // 4.4: Verificar workflows (REST)
      await this.checkWorkflows(owner, name, foundTools);

      const hasAnyTool = Object.values(foundTools).some((tool) => tool);

      if (hasAnyTool) {
        const toolsFound = Object.keys(foundTools).filter((key) => foundTools[key]);
        console.log(`   ✅ SUCESSO: Ferramentas encontradas: ${toolsFound.join(", ")}`);

        return {
          repository: fullName,
          stars: repo.stargazerCount || repo.stargazers_count || 0,
          lastCommit: lastCommitDate ? lastCommitDate.toISOString() : (pushedAt ? pushedAt.toISOString() : new Date().toISOString()),
          ...foundTools,
        };
      }

      console.log(`   ❌ Nenhuma ferramenta encontrada na busca detalhada`);
      return null;
    } catch (error) {
      console.log(`   ⚠️ Erro: ${error.message}`);
      this.stats.errors++;
      return null;
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
          if (fileName.includes("lighthouse") || fileName.includes("lhci"))
            foundTools["Lighthouse"] = true;
          if (fileName.includes("axe")) foundTools["AXE"] = true;
          if (fileName.includes("wave")) foundTools["WAVE"] = true;
          if (fileName.includes("html_codesniffer"))
            foundTools["HTML_CodeSniffer"] = true;
        }
      }
    } catch (error) {
      // Ignorar erros de acesso
    }
  }

  async checkDependencyFiles(owner, name, foundTools) {
    // Arquivos de dependências por linguagem/framework
    const dependencyFiles = [
      // JavaScript/Node.js
      "package.json",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",

      // Python
      "requirements.txt",
      "requirements.in",
      "Pipfile",
      "Pipfile.lock",
      "pyproject.toml",
      "setup.py",
      "setup.cfg",
      "poetry.lock",

      // PHP
      "composer.json",
      "composer.lock",

      // Java
      "pom.xml",
      "build.gradle",
      "build.gradle.kts",
      "gradle.properties",

      // C# / .NET
      "packages.config",
      "project.json",
      "*.csproj",
      "*.fsproj",
      "*.vbproj",
      "Directory.Build.props",
      "Directory.Packages.props",

      // Ruby
      "Gemfile",
      "Gemfile.lock",
      "*.gemspec",

      // Go
      "go.mod",
      "go.sum",
      "Gopkg.toml",
      "Gopkg.lock",

      // Rust
      "Cargo.toml",
      "Cargo.lock",

      // Dart/Flutter
      "pubspec.yaml",
      "pubspec.lock",

      // Swift
      "Package.swift",
      "Podfile",
      "Podfile.lock",

      // Outros
      "Makefile",
      "CMakeLists.txt",
      "meson.build",
    ];

    for (const depFile of dependencyFiles) {
      try {
        // Para arquivos com wildcards (*.csproj), verificar conteúdo da pasta
        if (depFile.includes("*")) {
          const extension = depFile.replace("*", "");
          const rootContents = await this.getRepositoryContents(owner, name);

          for (const file of rootContents) {
            const fileName = file && file.name ? file.name : "";
            if (fileName.endsWith(extension)) {
              const content = await this.getFileContent(owner, name, fileName);
              if (content) {
                console.log(`     📄 Analisando ${fileName}`);
                this.searchToolsInContent(content, foundTools);
              }
            }
          }
        } else {
          const content = await this.getFileContent(owner, name, depFile);
          if (content) {
            console.log(`     📦 Analisando ${depFile}`);
            this.searchToolsInContent(content, foundTools);
          }
        }
      } catch (error) {
        // Ignorar arquivos inexistentes
      }
    }
  }

  async checkWorkflows(owner, name, foundTools) {
    try {
      const workflows = await this.getRepositoryContents(
        owner,
        name,
        ".github/workflows"
      );

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
    console.log("\n⏰ LIMITE DE TEMPO ATINGIDO (5h59min)");
    console.log(`🔬 Total de repositórios analisados: ${analyzed}`);
    console.log(`💾 Total de repositórios salvos: ${saved}`);
    console.log(`📈 Porcentagem de sucesso: ${percent}%`);
    // Salvar stats em CSV
    const statsContent = [
      "total_analisados,total_salvos,porcentagem_sucesso",
      `${analyzed},${saved},${percent}`
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
    console.log(`⏭️  Repositórios pulados: ${this.stats.skipped}`);
    console.log(`❌ Erros: ${this.stats.errors}`);
    console.log(
      `📈 Taxa de sucesso: ${(
        (this.stats.saved / Math.max(this.stats.analyzed, 1)) *
        100
      ).toFixed(1)}%`
    );
    console.log(`🗃️  Total processados: ${this.processedRepos.size}\n`);
  }

  async run() {
    console.log("🚀 GITHUB ACCESSIBILITY MINER - EXECUÇÃO CONTÍNUA");
    console.log(`🔑 Token configurado: ${this.token ? "✅" : "❌"}`);
    console.log(`📊 Repositórios já processados: ${this.processedRepos.size}`);
    console.log(`⏰ Timeout controlado pelo GitHub Actions (35791 minutos)\n`);

    const queries = [
      // Termos gerais de aplicação web
      "web application",
      "webapp",
      "web app",
      "website application",
      "web platform",
      "web portal",
      "online application",
      "web based application",
      "web service",
      "fullstack application",
      "frontend application",
      "single page application",

      // Tipos de aplicação por função
      "dashboard application",
      "admin panel",
      "management system",
      "control panel",
      "monitoring dashboard",
      "analytics dashboard",

      // E-commerce e vendas
      "ecommerce application",
      "online store",
      "shopping application",
      "marketplace application",
      "retail application",

      // Sistemas de gestão
      "crm application",
      "erp application",
      "cms application",
      "content management",
      "project management",
      "task management",

      // Aplicações sociais e comunicação
      "social application",
      "chat application",
      "messaging application",
      "forum application",
      "community platform",

      // Aplicações de conteúdo
      "blog application",
      "news application",
      "media application",
      "publishing platform",
      "content platform",

      // Aplicações de negócio
      "saas application",
      "business application",
      "enterprise application",
      "corporate application",
      "professional application",

      // Aplicações educacionais e pessoais
      "learning platform",
      "education application",
      "portfolio application",
      "personal application",
      "productivity application",

      // Aplicações específicas populares
      "todo application",
      "calendar application",
      "booking application",
      "reservation system",
      "inventory system",
      "helpdesk application",
      "ticketing system",
      "survey application",
      "form application",
      "gallery application",
    ];

    const foundRepos = [];
    let queryIndex = 0;

    // Timer para garantir parada após 5h59min
    setTimeout(() => {
      this.timeoutTriggered = true;
      this.printFinalStatsAndSave();
      process.exit(0);
    }, this.maxRunMillis);

    // Loop contínuo até acabar o tempo
    while (this.shouldContinueRunning()) {
      try {
        const query = queries[queryIndex % queries.length];
        console.log(`\n🔍 Consulta: "${query}"`);

        // Usar cursor-based pagination (GraphQL)
        let cursor = null;
        let pageCount = 0;

        do {
          pageCount++;
          console.log(
            `   📄 Página ${pageCount}${cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""}`
          );

          const searchResult = await this.searchRepositories(query, cursor);

          if (!searchResult.items || searchResult.items.length === 0) {
            console.log(`   📭 Sem resultados nesta página.`);
            break;
          }

          for (const repo of searchResult.items) {
            if (!this.shouldContinueRunning()) break;

            this.stats.analyzed++;

            // Normalizar identificador do repositório para controle
            const repoId =
              repo.nameWithOwner || repo.full_name || `${(repo.owner && repo.owner.login) || ""}/${repo.name || ""}`;

            if (this.processedRepos.has(repoId)) {
              this.stats.skipped++;
              continue;
            }

            const analysis = await this.analyzeRepository(repo);

            if (analysis) {
              foundRepos.push(analysis);
              this.stats.saved++;

              // Salvar em lotes de 5
              if (foundRepos.length >= 5) {
                this.appendToCSV(foundRepos);
                foundRepos.forEach((r) => this.processedRepos.add(r.repository));
                this.saveProcessedRepos();
                foundRepos.length = 0;
              }
            }

            this.processedRepos.add(repoId);

            // Mostrar progresso a cada 50 repositórios
            if (this.stats.analyzed % 50 === 0) {
              this.printProgress();
            }

            // Pausa pequena entre repositórios
            await new Promise((resolve) => setTimeout(resolve, 50));
          }

          // Decidir se vamos para a próxima página (cursor)
          if (
            searchResult.pageInfo &&
            searchResult.pageInfo.hasNextPage &&
            pageCount < 10
          ) {
            cursor = searchResult.pageInfo.endCursor;
            // pequena pausa entre páginas
            await new Promise((resolve) => setTimeout(resolve, 500));
          } else {
            cursor = null; // encerra o loop de páginas para essa query
          }
        } while (cursor && this.shouldContinueRunning());

        // Avança para próxima query
        queryIndex++;
        // pequena pausa entre queries
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.log(`❌ Erro na execução: ${error.message}`);

        if (error.message.includes("rate limit")) {
          console.log(`⏳ Rate limit atingido, aguardando 10 minutos...`);
          await new Promise((resolve) => setTimeout(resolve, 20000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 2000));
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
      // Relatório final (só executa se o script terminar naturalmente, não por timeout)
      console.log(`\n🎉 EXECUÇÃO FINALIZADA NATURALMENTE!`);
      this.printProgress();
      console.log(`📄 Arquivo CSV: ${this.csvFile}`);
      console.log(`🗃️  Arquivo de controle: ${this.processedReposFile}`);
      console.log(`\n💡 Nota: Se foi interrompido por timeout do GitHub Actions, isso é normal!`);
    }
  }
}

// Executar
const miner = new GitHubAccessibilityMiner();
miner.run().catch((error) => {
console.error("💥 Erro fatal:", error);
process.exit(1);
});
