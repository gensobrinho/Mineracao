const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

class GitHubAccessibilityMiner {
  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    this.graphqlUrl = "https://api.github.com/graphql";
    this.restUrl = "https://api.github.com";
    this.csvFile = "repositorios_acessibilidade.csv";
    this.processedReposFile = "processed_repos.json";
    this.processedRepos = this.loadProcessedRepos();
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

    // Inicializar CSV se não existir
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

  async makeGraphQLRequest(query, variables = {}) {
    const options = {
      method: "POST",
      headers: {
        "User-Agent": "GitHub-Accessibility-Miner-Action",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
      timeout: 30000,
    };

    const response = await fetch(this.graphqlUrl, options);

    // Verificar rate limit (GraphQL usa diferentes headers)
    const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
    const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));

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
      timeout: 30000,
    };

    const response = await fetch(url, options);

    // Verificar rate limit
    const rateLimit = parseInt(response.headers.get("x-ratelimit-remaining"));
    const resetTime = parseInt(response.headers.get("x-ratelimit-reset"));

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

  // Nova função para detectar arquivos CSS e frontend
  async checkFrontendFiles(owner, name) {
    const frontendFiles = [
      // CSS e pré-processadores
      "style.css", "styles.css", "main.css", "app.css", "index.css",
      "global.css", "theme.css", "custom.css", "base.css",
      
      // Arquivos SCSS/SASS
      "style.scss", "styles.scss", "main.scss", "app.scss", 
      "variables.scss", "_variables.scss", "mixins.scss",
      
      // LESS
      "style.less", "styles.less", "main.less", "variables.less",
      
      // Stylus
      "style.styl", "styles.styl", "main.styl",
      
      // Configurações de frameworks CSS
      "tailwind.config.js", "tailwind.config.ts", "postcss.config.js",
      "bootstrap.css", "bulma.css", "foundation.css",
      
      // Arquivos de build CSS
      "webpack.config.js", "vite.config.js", "rollup.config.js"
    ];

    let frontendScore = 0;
    const foundFiles = [];
    let hasStylesFolder = false;

    // Verificar arquivos específicos
    for (const file of frontendFiles) {
      try {
        const content = await this.getFileContent(owner, name, file);
        if (content) {
          foundFiles.push(file);
          
          // Pontuação baseada no tipo de arquivo
          if (file.includes(".css")) frontendScore += 12;
          else if (file.includes(".scss") || file.includes(".sass")) frontendScore += 15;
          else if (file.includes(".less") || file.includes(".styl")) frontendScore += 15;
          else if (file.includes("tailwind") || file.includes("postcss")) frontendScore += 18;
          else if (file.includes("webpack") || file.includes("vite")) frontendScore += 10;
          else frontendScore += 8;
        }
      } catch (error) {
        // Arquivo não existe, continua
      }
    }

    // Verificar pastas comuns de estilos
    const styleFolders = ["css", "styles", "scss", "sass", "less", "stylus", "assets/css", "src/styles", "public/css"];
    
    for (const folder of styleFolders) {
      try {
        const contents = await this.getRepositoryContents(owner, name, folder);
        if (contents && contents.length > 0) {
          hasStylesFolder = true;
          const cssFiles = contents.filter(file => 
            file.name && (
              file.name.endsWith('.css') || 
              file.name.endsWith('.scss') || 
              file.name.endsWith('.sass') || 
              file.name.endsWith('.less') ||
              file.name.endsWith('.styl')
            )
          );
          
          if (cssFiles.length > 0) {
            frontendScore += Math.min(cssFiles.length * 5, 20);
            foundFiles.push(`${folder}/ (${cssFiles.length} arquivos CSS)`);
          }
        }
      } catch (error) {
        // Pasta não existe, continua
      }
    }

    return {
      score: Math.min(frontendScore, 25), // Máximo 25 pontos
      files: foundFiles,
      hasStylesFolder
    };
  }

  // Nova função para detectar arquivos de deploy
  async checkDeployFiles(owner, name) {
    const deployFiles = [
      // Docker
      "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
      
      // Heroku
      "Procfile", "app.json",
      
      // Vercel
      "vercel.json", ".vercelignore",
      
      // Netlify
      "netlify.toml", "_redirects", "_headers",
      
      // Firebase
      "firebase.json", ".firebaserc",
      
      // Google Cloud
      "app.yaml", "cloudbuild.yaml",
      
      // AWS
      "buildspec.yml", "appspec.yml", "serverless.yml",
      
      // Kubernetes
      "deployment.yaml", "k8s.yaml", "kustomization.yaml",
      
      // Outros
      "Dockerfile.prod", "docker-compose.prod.yml",
      "deploy.sh", "deploy.yml", "deployment.yml"
    ];

    let deployScore = 0;
    const foundFiles = [];

    for (const file of deployFiles) {
      try {
        const content = await this.getFileContent(owner, name, file);
        if (content) {
          foundFiles.push(file);
          
          // Pontuação baseada no tipo de arquivo
          if (file.includes("docker")) deployScore += 15;
          else if (file === "Procfile") deployScore += 20;
          else if (file.includes("vercel") || file.includes("netlify")) deployScore += 18;
          else if (file.includes("firebase")) deployScore += 18;
          else if (file.includes("k8s") || file.includes("deployment")) deployScore += 15;
          else deployScore += 10;
        }
      } catch (error) {
        // Arquivo não existe, continua
      }
    }

    return {
      score: Math.min(deployScore, 35), // Máximo 35 pontos
      files: foundFiles
    };
  }

  // Nova função para análise inteligente de homepage
  analyzeHomepage(homepage, allContent) {
    if (!homepage || !homepage.includes("http")) {
      return { score: 0, reason: "sem homepage" };
    }

    const url = homepage.toLowerCase();
    
    // URLs que claramente indicam documentação/biblioteca (penalização)
    const docPatterns = [
      ".github.io",
      "netlify.app",
      "vercel.app", 
      "surge.sh",
      "firebase.app",
      "web.app",
      "pages.dev",
      "gitbook.io",
      "readthedocs.io",
      "docs.",
      "documentation",
      "/docs",
      "/guide",
      "/tutorial"
    ];

    const isDocSite = docPatterns.some(pattern => url.includes(pattern));
    
    if (isDocSite) {
      return { score: -10, reason: "homepage é site de documentação" };
    }

    // URLs que indicam aplicações reais (pontuação positiva)
    const appPatterns = [
      "app.",
      "admin.",
      "dashboard.",
      "portal.",
      "platform.",
      "my.",
      "client.",
      "user."
    ];

    const isAppUrl = appPatterns.some(pattern => url.includes(pattern));
    
    if (isAppUrl) {
      return { score: 25, reason: "homepage indica aplicação real" };
    }

    // Verificar se o contexto ao redor da homepage indica aplicação
    const contextKeywords = [
      "live demo", "deployed", "production", "visit", "try it", 
      "access", "login", "sign up", "register", "use online"
    ];
    
    const hasAppContext = contextKeywords.some(keyword => 
      allContent.includes(keyword)
    );

    if (hasAppContext) {
      return { score: 15, reason: "contexto indica aplicação deployada" };
    }

    // Homepage genérica - pontuação neutra baixa
    return { score: 5, reason: "homepage genérica" };
  }

  // Nova função principal com sistema de pontuação
  async isWebApplication(repo) {
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

    // Sistema de pontuação (0-100)
    let score = 0;
    const reasons = [];

    // 1. ANÁLISE DE HOMEPAGE (peso: até 25 pontos ou -10 penalização)
    const homepageAnalysis = this.analyzeHomepage(homepage, allContent);
    score += homepageAnalysis.score;
    if (homepageAnalysis.score !== 0) {
      reasons.push(homepageAnalysis.reason);
    }

    // 2. PALAVRAS-CHAVE POSITIVAS (peso: até 40 pontos)
    const strongWebAppKeywords = [
      "web application", "web app", "webapp", "website", "web platform",
      "dashboard", "admin panel", "management system", "cms", "ecommerce",
      "e-commerce", "saas", "platform", "portal", "frontend", "fullstack",
      "spa", "pwa", "deployed", "production", "live demo",
      
      // Indicadores de frontend/UI
      "responsive design", "user interface", "ui/ux", "css", "scss", "sass",
      "tailwind", "bootstrap", "material ui", "styled-components", "css-in-js",
      "web design", "mobile responsive", "cross-browser", "interactive"
    ];

    const positiveKeywords = strongWebAppKeywords.filter(keyword => 
      allContent.includes(keyword)
    );

    if (positiveKeywords.length > 0) {
      const keywordScore = Math.min(positiveKeywords.length * 8, 40);
      score += keywordScore;
      reasons.push(`${positiveKeywords.length} palavras-chave de webapp (+${keywordScore})`);
    }

    // 3. TOPICS ESPECÍFICOS (peso: até 20 pontos)
    const webAppTopics = [
      "webapp", "web-app", "website", "web-application", "dashboard",
      "admin-panel", "cms", "ecommerce", "e-commerce", "saas", "platform",
      "portal", "frontend", "fullstack", "spa", "pwa"
    ];

    const matchingTopics = topics.filter(topic => webAppTopics.includes(topic));
    
    if (matchingTopics.length > 0) {
      const topicScore = Math.min(matchingTopics.length * 10, 20);
      score += topicScore;
      reasons.push(`${matchingTopics.length} topics de webapp (+${topicScore})`);
    }

    // 4. PENALIZAÇÕES POR INDICADORES NEGATIVOS (peso: até -50 pontos)
    const strongNegativeKeywords = [
      "library", "lib", "component library", "ui library", "design system",
      "framework", "toolkit", "sdk", "cli", "tool", "utility", "plugin",
      "template", "boilerplate", "starter", "example", "demo", "tutorial",
      "documentation", "docs", "guide", "awesome", "collection"
    ];

    const negativeKeywords = strongNegativeKeywords.filter(keyword => 
      allContent.includes(keyword)
    );

    if (negativeKeywords.length > 0) {
      const penalty = Math.min(negativeKeywords.length * 10, 50);
      score -= penalty;
      reasons.push(`${negativeKeywords.length} indicadores negativos (-${penalty})`);
    }

    // 5. BONUS POR CONTEXTO DE APLICAÇÃO (peso: até 15 pontos)
    const contextKeywords = [
      "users", "customers", "clients", "visitors", "hosted", "online",
      "login", "register", "sign up", "authentication", "database"
    ];

    const contextMatches = contextKeywords.filter(keyword => 
      allContent.includes(keyword)
    );

    if (contextMatches.length > 0) {
      const contextScore = Math.min(contextMatches.length * 3, 15);
      score += contextScore;
      reasons.push(`contexto de aplicação (+${contextScore})`);
    }

    // 6. DETECÇÃO DE PROCESSOS DE DEPLOY (peso: até 30 pontos) - FORTE INDICADOR
    const deployKeywords = [
      // Plataformas de deploy
      "heroku", "vercel", "netlify", "firebase", "aws", "azure", "gcp",
      "docker", "kubernetes", "k8s", "deployment", "deploy", "deployed",
      
      // Arquivos/configurações de deploy
      "dockerfile", "docker-compose", "procfile", "vercel.json", "netlify.toml",
      "firebase.json", "app.yaml", "serverless", "terraform",
      
      // Processos de CI/CD
      "github actions", "ci/cd", "continuous deployment", "auto deploy",
      "build and deploy", "production deployment", "staging deployment",
      
      // Scripts e comandos de deploy
      "npm run deploy", "yarn deploy", "build script", "production build",
      "dist", "build folder", "static files"
    ];

    const deployMatches = deployKeywords.filter(keyword => 
      allContent.includes(keyword)
    );

    if (deployMatches.length > 0) {
      const deployScore = Math.min(deployMatches.length * 6, 30);
      score += deployScore;
      reasons.push(`${deployMatches.length} indicadores de deploy (+${deployScore})`);
    }

    // 7. VERIFICAÇÃO DE ARQUIVOS DE DEPLOY (peso: até 35 pontos) - EVIDÊNCIA CONCRETA
    const owner = (repo.owner && repo.owner.login) || "";
    const repoName = repo.name || "";
    
    if (owner && repoName) {
      try {
        const deployFileCheck = await this.checkDeployFiles(owner, repoName);
        if (deployFileCheck.score > 0) {
          score += deployFileCheck.score;
          reasons.push(`arquivos de deploy encontrados: ${deployFileCheck.files.join(", ")} (+${deployFileCheck.score})`);
        }
      } catch (error) {
        // Ignorar erros na verificação de arquivos
      }
    }

    // 8. VERIFICAÇÃO DE ARQUIVOS CSS/FRONTEND (peso: até 25 pontos) - INDICADOR DE UI
    if (owner && repoName) {
      try {
        const frontendFileCheck = await this.checkFrontendFiles(owner, repoName);
        if (frontendFileCheck.score > 0) {
          score += frontendFileCheck.score;
          reasons.push(`arquivos CSS/frontend encontrados: ${frontendFileCheck.files.join(", ")} (+${frontendFileCheck.score})`);
        }
      } catch (error) {
        // Ignorar erros na verificação de arquivos
      }
    }

    // DECISÃO FINAL: threshold de 30 pontos
    const isWebApp = score >= 30;

    // Log detalhado para debug
    if (!isWebApp) {
      console.log(`   🔍 Não é webapp (score: ${score}/30) - ${reasons.join(", ") || "sem indicadores positivos"}`);
    } else {
      console.log(`   ✅ Confirmado como webapp (score: ${score}/30) - ${reasons.join(", ")}`);
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

  async analyzeRepository(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const name = repo.name || "";
    const fullName = repo.nameWithOwner || repo.full_name || `${owner}/${name}`;

    console.log(
      `🔬 Analisando: ${fullName} (⭐ ${repo.stargazerCount || repo.stargazers_count || 0})`
    );

    try {
      // Verificar se é muito antigo
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      const lastUpdateStr = repo.updatedAt || repo.updated_at || null;
      const lastUpdate = lastUpdateStr ? new Date(lastUpdateStr) : null;

      if (lastUpdate && lastUpdate < oneYearAgo) {
        console.log(`   📅 Muito antigo, pulando...`);
        return null;
      }

      // Filtrar bibliotecas usando nome, descrição e topics
      if (await this.isLibraryRepository(repo)) {
        console.log(`   📚 Biblioteca/ferramenta detectada, pulando...`);
        return null;
      }

      // Verificar se é realmente uma aplicação web usando o "about"
      if (!(await this.isWebApplication(repo))) {
        console.log(`   ❌ Não é uma aplicação web, pulando...`);
        return null;
      }

      const foundTools = {
        AXE: false,
        Pa11y: false,
        WAVE: false,
        AChecker: false,
        Lighthouse: false,
        Asqatasun: false,
        HTML_CodeSniffer: false,
      };

      // Verificar descrição/about do repositório
      await this.checkRepositoryAbout(repo, foundTools);

      // Verificar arquivos de configuração
      await this.checkConfigFiles(owner, name, foundTools);

      // Verificar arquivos de dependências de todas as linguagens
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
          lastCommit: repo.updatedAt || repo.updated_at || "",
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

  shouldContinueRunning() {
    // GitHub Actions controla o timeout automaticamente
    // Apenas continua executando até ser interrompido
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
            await new Promise((resolve) => setTimeout(resolve, 75));
          }

          // Decidir se vamos para a próxima página (cursor)
          if (
            searchResult.pageInfo &&
            searchResult.pageInfo.hasNextPage &&
            pageCount < 10
          ) {
            cursor = searchResult.pageInfo.endCursor;
            // pequena pausa entre páginas
            await new Promise((resolve) => setTimeout(resolve, 750));
          } else {
            cursor = null; // encerra o loop de páginas para essa query
          }
        } while (cursor && this.shouldContinueRunning());

        // Avança para próxima query
        queryIndex++;
        // pequena pausa entre queries
        await new Promise((resolve) => setTimeout(resolve, 750));
      } catch (error) {
        console.log(`❌ Erro na execução: ${error.message}`);

        if (error.message.includes("rate limit")) {
          console.log(`⏳ Rate limit atingido, aguardando 10 minutos...`);
          await new Promise((resolve) => setTimeout(resolve, 300000));
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

    // Relatório final (só executa se o script terminar naturalmente, não por timeout)
    console.log(`\n🎉 EXECUÇÃO FINALIZADA NATURALMENTE!`);
    this.printProgress();
    console.log(`📄 Arquivo CSV: ${this.csvFile}`);
    console.log(`🗃️  Arquivo de controle: ${this.processedReposFile}`);
    console.log(`\n💡 Nota: Se foi interrompido por timeout do GitHub Actions, isso é normal!`);
  }
}

// Executar
const miner = new GitHubAccessibilityMiner();
miner.run().catch((error) => {
  console.error("💥 Erro fatal:", error);
  process.exit(1);
});
