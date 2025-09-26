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
    this.perPage = 50;

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
        "Último Commit (pós ago/2024)",
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

  async makeGraphQLRequest(query, variables = {}, retries = 3) {
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

    try {
      const response = await fetch(this.graphqlUrl, options);

      // Retry para erros temporários
      if ([502, 503, 504].includes(response.status)) {
        if (retries > 0) {
          const waitTime = (4 - retries) * 5000; // espera crescente
          console.log(`⚠️ Erro ${response.status}, tentando novamente em ${waitTime / 1000}s... (${retries} tentativas restantes)`);
          await new Promise(res => setTimeout(res, waitTime));
          return this.makeGraphQLRequest(query, variables, retries - 1);
        } else {
          console.log(`❌ Erro ${response.status} persistente, pulando esta busca.`);
          return null; // retorna null para não travar
        }
      }

      if (!response.ok) {
        console.log(`❌ Erro HTTP ${response.status}: ${response.statusText}`);
        return null;
      }

      const result = await response.json();

      if (result.errors) {
        console.log(`⚠️ Erro GraphQL: ${JSON.stringify(result.errors)}`);
        return null;
      }

      return result.data;
    } catch (error) {
      console.log(`❌ Erro na requisição GraphQL: ${error.message}`);
      return null;
    }
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
              pushedAt
              createdAt
              defaultBranchRef {
                name
                target {
                  ... on Commit {
                    author {
                      name
                      email
                      user {
                        login
                      }
                    }
                    committedDate
                    history(first: 10) {
                      nodes {
                        author {
                          name
                          email
                          user {
                            login
                          }
                        }
                        committedDate
                      }
                    }
                  }
                }
              }
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
        `🔍 Buscando GraphQL: "${query}"${cursor ? ` - Cursor: ${String(cursor).substring(0, 10)}...` : ""
        }`
      );
      const data = await this.makeGraphQLRequest(graphqlQuery, variables);

      if (!data) {
        console.log(`⚠️ Nenhum dado retornado para query "${query}", pulando...`);
        return { items: [], pageInfo: { hasNextPage: false }, totalCount: 0 };
      }

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

    let topicsArr = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topicsArr = repo.repositoryTopics.nodes.map(n => (n?.topic?.name || "").toLowerCase());
    } else if (Array.isArray(repo.topics)) {
      topicsArr = repo.topics.map(t => (t || "").toLowerCase());
    }

    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();

    let readmeContent = "";
    try {
      const readme = await this.getReadmeContent(owner, repo.name || repo.nameWithOwner);
      if (readme) readmeContent = readme.toLowerCase();
    } catch { }

    const combinedText = [description, name, fullName, topicsArr.join(" "), homepage, readmeContent].join(" ");

    const strongLibraryKeywords = [
      "library", "lib", "biblioteca", "component library", "ui library", "framework",
      "toolkit", "npm package", "node module", "plugin", "extension", "addon",
      "middleware", "utility", "utils", "helper", "sdk", "api client", "wrapper"
    ];

    const libraryNamePatterns = [
      /^react-/, /^vue-/, /^angular-/, /^ng-/, /^@[^/]+\//,
      /-ui$/, /-components$/, /-lib$/, /-kit$/, /-utils$/, /-helpers$/,
      /^ui-/, /^lib-/, /^utils-/, /^helper-/, /^tool-/, /^cli-/,
      /-boilerplate$/, /-template$/, /-starter$/, /-seed$/, /-skeleton$/
    ];

    const appKeywords = [
      "web app", "webapp", "web application", "application", "website", "portal",
      "dashboard", "cms", "blog", "ecommerce", "shop", "store", "marketplace"
    ];

    const isAwesomeList = combinedText.includes("awesome") || combinedText.includes("curated list");
    const isDocsOrTutorial = combinedText.includes("documentation") || combinedText.includes("tutorial");
    const isConfigRepo = combinedText.includes("dotfiles") || combinedText.includes("configuration");

    const hasLibraryNamePattern = libraryNamePatterns.some(p => p.test(name) || p.test(fullName));
    const hasStrongLibraryKeywords = strongLibraryKeywords.some(k => combinedText.includes(k));
    const hasAppKeywords = appKeywords.some(k => combinedText.includes(k));

    const isTemplateOrStarter = combinedText.includes("template") || combinedText.includes("starter kit");

    // 🔹 Se for template/starter kit e tiver sinais de aplicação, não descartar
    if (isTemplateOrStarter && hasAppKeywords) {
      return false;
    }

    const isLibrary = hasLibraryNamePattern || (hasStrongLibraryKeywords && !hasAppKeywords) || isAwesomeList || isDocsOrTutorial || isConfigRepo;

    if (isLibrary) {
      console.log(`   📚 Biblioteca detectada: ${repo.full_name || repo.nameWithOwner}`);
    }

    return isLibrary;
  }

  // Nova função para detectar arquivos CSS e frontend
  async checkFrontendFiles(owner, name) {
    const frontendFiles = [
      "style.css", "styles.css", "main.css", "app.css", "index.css",
      "global.css", "theme.css", "custom.css", "base.css",
      "style.scss", "styles.scss", "main.scss", "app.scss",
      "variables.scss", "_variables.scss", "mixins.scss",
      "style.less", "styles.less", "main.less", "variables.less",
      "style.styl", "styles.styl", "main.styl",
      "tailwind.config.js", "tailwind.config.ts", "postcss.config.js",
      "uno.config.ts", "windi.config.js",
      "webpack.config.js", "vite.config.js", "vite.config.ts", "rollup.config.js"
    ];

    const codeExtensions = [".jsx", ".tsx"];

    let frontendScore = 0;
    const foundFiles = [];
    let hasStylesFolder = false;

    for (const file of frontendFiles) {
      try {
        const content = await this.getFileContent(owner, name, file);
        if (content) {
          foundFiles.push(file);
          frontendScore += 10;
        }
      } catch { }
    }

    const styleFolders = ["css", "styles", "scss", "sass", "less", "stylus", "assets/css", "src/styles", "public/css"];
    for (const folder of styleFolders) {
      try {
        const contents = await this.getRepositoryContents(owner, name, folder);
        if (contents.length > 0) {
          hasStylesFolder = true;
          frontendScore += 10;
        }
      } catch { }
    }

    // Detectar arquivos JSX/TSX
    try {
      const srcContents = await this.getRepositoryContents(owner, name, "src");
      if (srcContents.some(f => codeExtensions.some(ext => f.name.endsWith(ext)))) {
        frontendScore += 15;
        foundFiles.push("arquivos JSX/TSX detectados");
      }
    } catch { }

    return { score: Math.min(frontendScore, 25), files: foundFiles, hasStylesFolder };
  }

  // Nova função para detectar frameworks web backend
  async checkBackendFrameworks(owner, name) {
    const frameworkChecks = [
      // Ruby on Rails
      {
        files: ["config/routes.rb", "app/controllers/application_controller.rb", "Gemfile"],
        keywords: ["rails", "ruby on rails"],
        name: "Ruby on Rails",
        score: 30
      },

      // Django (Python)
      {
        files: ["manage.py", "settings.py", "urls.py", "wsgi.py"],
        keywords: ["django", "python web"],
        name: "Django",
        score: 30
      },

      // Laravel (PHP)
      {
        files: ["artisan", "composer.json", "routes/web.php", "app/Http/Controllers/Controller.php"],
        keywords: ["laravel", "php framework"],
        name: "Laravel",
        score: 30
      },

      // Express.js (Node.js)
      {
        files: ["package.json"],
        keywords: ["express", "node.js web", "koa", "fastify"],
        name: "Node.js Web Framework",
        score: 25
      },

      // Spring Boot (Java)
      {
        files: ["pom.xml", "build.gradle", "src/main/java"],
        keywords: ["spring boot", "spring mvc", "java web"],
        name: "Spring Boot",
        score: 30
      },

      // ASP.NET (C#)
      {
        files: ["Program.cs", "Startup.cs", "appsettings.json", "Controllers"],
        keywords: ["asp.net", "dotnet", "c# web"],
        name: "ASP.NET",
        score: 30
      },

      // Flask (Python)
      {
        files: ["app.py", "main.py", "requirements.txt"],
        keywords: ["flask", "python microframework"],
        name: "Flask",
        score: 25
      },

      // Symfony (PHP)
      {
        files: ["symfony.lock", "config/services.yaml", "src/Controller"],
        keywords: ["symfony", "php symfony"],
        name: "Symfony",
        score: 30
      }
    ];

    for (const framework of frameworkChecks) {
      let foundFiles = 0;
      let foundKeywords = false;

      // Verificar arquivos específicos do framework
      for (const file of framework.files) {
        try {
          const content = await this.getFileContent(owner, name, file);
          if (content) {
            foundFiles++;

            // Para package.json e Gemfile, verificar dependências específicas
            if (file === "package.json" && content) {
              const hasWebFramework = framework.keywords.some(keyword =>
                content.toLowerCase().includes(keyword)
              );
              if (hasWebFramework) foundKeywords = true;
            }

            if (file === "Gemfile" && content) {
              const hasRails = content.toLowerCase().includes("rails");
              if (hasRails) foundKeywords = true;
            }

            if (file === "composer.json" && content) {
              const hasLaravel = content.toLowerCase().includes("laravel");
              if (hasLaravel) foundKeywords = true;
            }
          }
        } catch (error) {
          // Arquivo não existe, continua
        }
      }

      // Verificar estrutura de pastas específicas
      if (framework.name === "Ruby on Rails") {
        try {
          const appFolder = await this.getRepositoryContents(owner, name, "app");
          const configFolder = await this.getRepositoryContents(owner, name, "config");
          if (appFolder.length > 0 && configFolder.length > 0) {
            foundFiles += 2;
          }
        } catch (error) {
          // Pastas não existem
        }
      }

      if (framework.name === "Django") {
        try {
          const hasManage = await this.getFileContent(owner, name, "manage.py");
          if (hasManage && hasManage.includes("django")) {
            foundKeywords = true;
          }
        } catch (error) {
          // Arquivo não existe
        }
      }

      // Se encontrou evidências suficientes do framework
      if (foundFiles >= 2 || (foundFiles >= 1 && foundKeywords)) {
        return {
          score: framework.score,
          framework: framework.name,
          evidence: `${foundFiles} arquivos encontrados${foundKeywords ? " + dependências confirmadas" : ""}`
        };
      }
    }

    return { score: 0, framework: null };
  }

  // Nova função para detectar indicadores específicos de bibliotecas
  async checkLibraryIndicators(owner, name, isWebAppCandidate = false) {
    let penalty = 0;
    const indicators = [];

    try {
      const packageJson = await this.getFileContent(owner, name, "package.json");
      if (packageJson) {
        const pkg = JSON.parse(packageJson);
        if (pkg.main || pkg.module || pkg.exports) {
          penalty += 20;
          indicators.push("package.json com entry points de biblioteca");
        }
        if (pkg.keywords && Array.isArray(pkg.keywords)) {
          const libraryKeywords = ["library", "component", "utility", "helper", "tool", "cli", "framework"];
          if (pkg.keywords.some(k => libraryKeywords.some(lk => k.toLowerCase().includes(lk)))) {
            penalty += 15;
            indicators.push("keywords de biblioteca no package.json");
          }
        }
      }
    } catch { }

    if (isWebAppCandidate) {
      penalty = Math.max(0, penalty - 15); // reduz penalidade para candidatos a webapp
    }

    return { penalty: Math.min(penalty, 60), indicators };
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

  // Função para testar a verificação de idade (para debugging)
  testAgeVerification() {
    const testCases = [
      {
        name: "Repo recente (setembro 2024)",
        pushedAt: new Date('2024-09-15T10:00:00Z').toISOString(),
        stargazerCount: 50,
        expected: false
      },
      {
        name: "Repo no limite (agosto 2024)",
        pushedAt: new Date('2024-08-15T10:00:00Z').toISOString(),
        stargazerCount: 100,
        expected: false
      },
      {
        name: "Repo antigo (julho 2024)",
        pushedAt: new Date('2024-07-15T10:00:00Z').toISOString(),
        stargazerCount: 200,
        expected: true
      },
      {
        name: "Repo muito antigo (janeiro 2024)",
        pushedAt: new Date('2024-01-15T10:00:00Z').toISOString(),
        stargazerCount: 300,
        expected: true
      },
      {
        name: "Repo sem pushedAt (fallback para updatedAt setembro 2024)",
        updatedAt: new Date('2024-09-10T10:00:00Z').toISOString(),
        stargazerCount: 150,
        expected: false
      }
    ];

    console.log("\n🧪 TESTANDO VERIFICAÇÃO DE IDADE:");
    testCases.forEach(testCase => {
      const result = this.checkRepositoryAge(testCase);
      const status = result.shouldSkip === testCase.expected ? "✅" : "❌";
      console.log(`${status} ${testCase.name}: ${result.reason} (shouldSkip: ${result.shouldSkip})`);
    });
    console.log("");
  }


  // Encontrar o último commit feito por um usuário real (não bot)
  getLastHumanCommitDate(repo) {
    try {
      const defaultBranch = repo.defaultBranchRef;
      if (!defaultBranch || !defaultBranch.target) {
        return null; // Sem informações de commit
      }

      // Padrões que indicam bots
      const botPatterns = [
        "dependabot", "renovate", "greenkeeper", "[bot]"
      ];

      const isBot = (author) => {
        if (!author) return false;
        const name = (author.name || "").toLowerCase();
        const email = (author.email || "").toLowerCase();
        const login = author.user ? (author.user.login || "").toLowerCase() : "";

        return botPatterns.some(pattern =>
          name.includes(pattern) || email.includes(pattern) || login.includes(pattern)
        );
      };

      // Verificar histórico de commits
      const commits = defaultBranch.target.history?.nodes || [];

      // Procurar o primeiro commit que não seja de bot
      for (const commit of commits) {
        if (!isBot(commit.author)) {
          return {
            date: commit.committedDate,
            author: commit.author?.name || commit.author?.user?.login || 'usuário'
          };
        }
      }

      // Se todos os commits recentes são de bots, usar o último mesmo assim
      return {
        date: defaultBranch.target.committedDate,
        author: 'bot (sem commits humanos recentes)'
      };

    } catch (error) {
      return null;
    }
  }

  // Verificação inteligente de idade do repositório
  checkRepositoryAge(repo) {
    const createdAtStr = repo.createdAt || repo.created_at || null;
    const stars = repo.stargazerCount || repo.stargazers_count || 0;

    // Tentar obter o último commit humano (ignorando bots)
    const humanCommit = this.getLastHumanCommitDate(repo);

    let lastCommit, commitType, authorInfo = "";

    if (humanCommit && humanCommit.date) {
      // Usar último commit humano
      lastCommit = new Date(humanCommit.date);
      commitType = "último commit humano";
      authorInfo = ` por ${humanCommit.author}`;
    } else {
      // Fallback para pushedAt/updatedAt
      const lastPushStr = repo.pushedAt || repo.pushed_at || null;
      const lastUpdateStr = repo.updatedAt || repo.updated_at || null;
      const lastCommitStr = lastPushStr || lastUpdateStr;

      if (!lastCommitStr) {
        return { shouldSkip: false, reason: "sem data de commit" };
      }

      lastCommit = new Date(lastCommitStr);
      commitType = lastPushStr ? "último commit" : "última atividade";
    }

    const createdAt = createdAtStr ? new Date(createdAtStr) : null;
    const monthsSinceCreation = createdAt ? (Date.now() - createdAt) / (1000 * 60 * 60 * 24 * 30) : 0;

    // CRITÉRIO FIXO: Último commit deve ser após agosto de 2024
    const augusto2024 = new Date('2024-08-01T00:00:00Z');

    // Verificar se o último commit foi antes de agosto de 2024
    if (lastCommit < augusto2024) {
      const starsInfo = stars > 0 ? ` (${stars} ⭐)` : "";
      const ageInfo = createdAt ? `, criado há ${Math.round(monthsSinceCreation)} meses` : "";
      const commitDate = lastCommit.toLocaleDateString('pt-BR');

      return {
        shouldSkip: true,
        reason: `${commitType} em ${commitDate}${authorInfo} (mais de um ano)${starsInfo}${ageInfo}`
      };
    }

    const commitDate = lastCommit.toLocaleDateString('pt-BR');
    return { shouldSkip: false, reason: `${commitType}${authorInfo} (${commitDate})` };
  }

  // FASE 1: Verificar se é obviamente uma biblioteca
  async isObviousLibrary(repo, owner, repoName) {
    const description = (repo.description || "").toLowerCase();
    const name = (repo.name || "").toLowerCase();

    const libraryNamePatterns = [
      /^react-/, /^vue-/, /^angular-/, /^@[^/]+\//, /-lib$/, /-utils$/, /-cli$/, /^lib-/, /^utils-/
    ];

    const obviousLibraryKeywords = [
      "npm package", "javascript library", "react library", "vue library",
      "cli tool", "utility library", "helper library", "component library"
    ];

    const isTemplateOrStarter = description.includes("template") || description.includes("starter kit");

    let libraryScore = 0;
    const reasons = [];

    if (libraryNamePatterns.some(p => p.test(name))) {
      libraryScore += 3;
      reasons.push("nome típico de biblioteca");
    }

    const foundKeywords = obviousLibraryKeywords.filter(k => description.includes(k));
    if (foundKeywords.length > 0) {
      libraryScore += foundKeywords.length * 2;
      reasons.push(`palavras definitivas: ${foundKeywords.join(", ")}`);
    }

    if (isTemplateOrStarter) {
      reasons.push("template/starter kit detectado");
    }

    return { isLibrary: libraryScore >= 3 && !isTemplateOrStarter, reasons, score: libraryScore };
  }

  // FASE 2: Verificar evidências de aplicação web
  async checkWebAppEvidences(repo, owner, repoName) {
    const strong = [];
    const medium = [];

    // Adaptar topics para formato unificado
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map(n => (n?.topic?.name || "").toLowerCase());
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map(t => (t || "").toLowerCase());
    }

    const description = (repo.description || "").toLowerCase();
    const name = (repo.name || "").toLowerCase();
    const homepage = (repo.homepageUrl || repo.homepage || "").toLowerCase();
    const allContent = [description, name, topics.join(" "), homepage].join(" ");

    // ------------------------
    // 🟢 Evidências Fortes
    // ------------------------
    const strongKeywords = [
      "web application", "dashboard", "admin panel", "cms", "ecommerce",
      "management system", "erp", "crm"
    ];
    if (strongKeywords.some(k => allContent.includes(k))) {
      strong.push(`palavras específicas: ${strongKeywords.filter(k => allContent.includes(k)).join(", ")}`);
    }

    // Arquivos de deploy
    const deployFiles = [
      "Dockerfile", "docker-compose.yml", "Procfile", "vercel.json", "netlify.toml",
      "firebase.json", "serverless.yml", "deployment.yaml"
    ];
    for (const file of deployFiles) {
      try {
        const content = await this.getFileContent(owner, repoName, file);
        if (content) {
          strong.push(`deploy: ${file}`);
          break; // basta um para considerar
        }
      } catch { }
    }

    // Estrutura backend detectável
    const backendIndicators = [
      { path: "app", type: "folder" },
      { path: "src/controllers", type: "folder" },
      { path: "routes", type: "folder" },
      { path: "src/server", type: "folder" },
      { path: "api", type: "folder" },
      { path: "server.js", type: "file" },
      { path: "app.py", type: "file" },
      { path: "index.php", type: "file" },
      { path: "main.go", type: "file" }
    ];
    for (const indicator of backendIndicators) {
      try {
        if (indicator.type === "folder") {
          const contents = await this.getRepositoryContents(owner, repoName, indicator.path);
          if (contents.length > 0) {
            strong.push(`backend: ${indicator.path}`);
            break;
          }
        } else {
          const content = await this.getFileContent(owner, repoName, indicator.path);
          if (content) {
            strong.push(`backend: ${indicator.path}`);
            break;
          }
        }
      } catch { }
    }

    // Homepage funcional
    const homepagePatterns = ["app.", "dashboard.", "portal.", "login."];
    if (homepage && homepagePatterns.some(p => homepage.includes(p))) {
      strong.push(`homepage funcional: ${homepage}`);
    }

    // Integração com APIs (no código)
    const apiCallPatterns = ["fetch(", "axios.", "XMLHttpRequest", "graphql"];
    for (const pattern of apiCallPatterns) {
      try {
        const packageJson = await this.getFileContent(owner, repoName, "package.json");
        if (packageJson && packageJson.toLowerCase().includes(pattern)) {
          strong.push(`uso de API: ${pattern}`);
          break;
        }
      } catch { }
    }

    // ------------------------
    // 🟡 Evidências Médias
    // ------------------------
    const cssFiles = [
      "style.css", "main.css", "app.css", "tailwind.config.js", "postcss.config.js"
    ];
    for (const file of cssFiles) {
      try {
        const content = await this.getFileContent(owner, repoName, file);
        if (content) {
          medium.push(`CSS/frontend: ${file}`);
          break;
        }
      } catch { }
    }

    // Arquivos HTML
    const htmlFolders = ["public", "templates", "views"];
    for (const folder of htmlFolders) {
      try {
        const contents = await this.getRepositoryContents(owner, repoName, folder);
        if (contents.some(f => f.name.endsWith(".html"))) {
          medium.push(`HTML: ${folder}`);
          break;
        }
      } catch { }
    }

    // Pasta public/static
    const staticFolders = ["public", "static"];
    for (const folder of staticFolders) {
      try {
        const contents = await this.getRepositoryContents(owner, repoName, folder);
        if (contents.length > 0) {
          medium.push(`assets: ${folder}`);
          break;
        }
      } catch { }
    }

    // Topics relacionados
    const webAppTopics = ["webapp", "web-app", "website", "dashboard", "cms", "saas", "platform"];
    if (topics.some(t => webAppTopics.includes(t))) {
      medium.push(`topics: ${topics.filter(t => webAppTopics.includes(t)).join(", ")}`);
    }

    // Palavras-chave gerais
    const generalKeywords = ["frontend", "fullstack", "pwa", "single page application", "spa"];
    if (generalKeywords.some(k => allContent.includes(k))) {
      medium.push(`palavras gerais: ${generalKeywords.filter(k => allContent.includes(k)).join(", ")}`);
    }

    // Homepage genérica
    if (homepage && homepage.startsWith("http") && !homepagePatterns.some(p => homepage.includes(p))) {
      medium.push(`homepage genérica: ${homepage}`);
    }

    // Scripts de build frontend
    const buildScripts = ["vite.config.js", "webpack.config.js", "rollup.config.js", "gulpfile.js"];
    for (const file of buildScripts) {
      try {
        const content = await this.getFileContent(owner, repoName, file);
        if (content) {
          medium.push(`build script: ${file}`);
          break;
        }
      } catch { }
    }

    // Pastas de interface
    const uiFolders = ["src/components", "src/pages", "ui"];
    for (const folder of uiFolders) {
      try {
        const contents = await this.getRepositoryContents(owner, repoName, folder);
        if (contents.length > 0) {
          medium.push(`UI folder: ${folder}`);
          break;
        }
      } catch { }
    }

    // ------------------------
    // Decisão final
    // ------------------------
    const hasStrongEvidence = strong.length > 0;
    const hasMediumEvidence = medium.length >= 2;

    if (hasStrongEvidence || hasMediumEvidence) {
      console.log(`   ✅ Confirmado como webapp - ${strong.length ? `FORTE: ${strong.join(", ")}` : ""} ${medium.length ? `MÉDIA: ${medium.join(", ")}` : ""}`);
      return { strong, medium };
    } else {
      console.log(`   🔍 Não é webapp - evidências insuficientes: ${[...strong, ...medium].join(", ") || "nenhuma"}`);
      return { strong, medium };
    }
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

  // Nova estratégia simplificada - Sistema Híbrido
  async isWebApplication(repo) {
    const owner = (repo.owner && repo.owner.login) || "";
    const repoName = repo.name || "";

    // FASE 1: FILTROS ELIMINATÓRIOS - Se é obviamente uma biblioteca, rejeitar
    const libraryCheck = await this.isObviousLibrary(repo, owner, repoName);
    if (libraryCheck.isLibrary) {
      console.log(`   📚 Biblioteca detectada: ${libraryCheck.reasons.join(", ")}`);
      return false;
    }

    // FASE 2: EVIDÊNCIAS POSITIVAS - Precisa de pelo menos 1 evidência forte
    const evidences = await this.checkWebAppEvidences(repo, owner, repoName);

    const hasStrongEvidence = evidences.strong.length > 0;
    const hasMediumEvidence = evidences.medium.length >= 2;

    const isWebApp = hasStrongEvidence || hasMediumEvidence;

    // Log simplificado
    if (!isWebApp) {
      const allEvidences = [...evidences.strong, ...evidences.medium];
      console.log(`   🔍 Não é webapp - evidências insuficientes: ${allEvidences.join(", ") || "nenhuma"}`);
    } else {
      const strongList = evidences.strong.length > 0 ? `FORTE: ${evidences.strong.join(", ")}` : "";
      const mediumList = evidences.medium.length > 0 ? `MÉDIA: ${evidences.medium.join(", ")}` : "";
      console.log(`   ✅ Confirmado como webapp - ${[strongList, mediumList].filter(x => x).join(" | ")}`);
    }

    return isWebApp;
  }

  async checkRepositoryAbout(repo, foundTools) {
    const description = (repo.description || "");
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map(n => (n?.topic?.name || ""));
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map(t => t || "");
    }
    const homepage = (repo.homepageUrl || repo.homepage || "");

    const aboutContent = [description, topics.join(" "), homepage].join(" ").toLowerCase();

    this.searchToolsInContent(aboutContent, foundTools);

    const accessibilityKeywords = [
      "accessibility", "accessible", "a11y", "wcag", "aria", "screen reader",
      "keyboard navigation", "color contrast", "accessibility testing",
      "accessibility audit", "accessibility compliance", "web accessibility",
      "inclusive design", "universal design", "disability", "assistive technology",
      "usability", "color blindness", "contrast checker", "508 compliance"
    ];

    if (accessibilityKeywords.some(k => aboutContent.includes(k))) {
      console.log(`     ♿ Menção de acessibilidade encontrada na descrição/about`);
    }

    // Buscar no README também
    try {
      const readme = await this.getReadmeContent(repo.owner?.login || "", repo.name || "");
      if (readme) {
        this.searchToolsInContent(readme.toLowerCase(), foundTools);
      }
    } catch { }
  }

  async analyzeRepository(repo) {
    const owner = repo.owner?.login || "";
    const name = repo.name || "";
    const fullName = repo.nameWithOwner || `${owner}/${name}`;
    this.stats.analyzed++;

    const ageCheck = this.checkRepositoryAge(repo);
    if (ageCheck.shouldSkip) {
      this.stats.skipped++;
      return null;
    }

    let foundTools = this.quickToolScan(repo);
    if (!Object.values(foundTools).some(Boolean)) {
      this.stats.skipped++;
      return null;
    }

    // 3. Verificação completa de biblioteca
    if (await this.isLibraryRepository(repo)) {
      this.stats.skipped++;
      return null;
    }

    // 4. Verificação completa de aplicação web
    if (!(await this.isWebApplication(repo))) {
      this.stats.skipped++;
      return null;
    }

    // 5. Busca detalhada de ferramentas
    await this.checkRepositoryAbout(repo, foundTools);
    await this.checkConfigFiles(owner, name, foundTools);
    await this.checkDependencyFiles(owner, name, foundTools);
    await this.checkWorkflows(owner, name, foundTools);

    // 6. Decisão final
    if (Object.values(foundTools).some(Boolean)) {
      this.stats.saved++;
      return {
        repository: fullName,
        stars: repo.stargazerCount || 0,
        lastCommit: repo.pushedAt || repo.updatedAt || "",
        ...foundTools
      };
    }

    this.stats.skipped++;
    return null;
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

      // Build tools e bundlers
      "vite.config.js",
      "vite.config.ts",
      "webpack.config.js",
      "rollup.config.js",
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

  quickToolScan(repo) {
    const foundTools = {
      AXE: false,
      Pa11y: false,
      WAVE: false,
      AChecker: false,
      Lighthouse: false,
      Asqatasun: false,
      HTML_CodeSniffer: false
    };

    // Combina descrição, topics e homepage
    let topics = [];
    if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
      topics = repo.repositoryTopics.nodes.map(n => (n?.topic?.name || ""));
    } else if (Array.isArray(repo.topics)) {
      topics = repo.topics.map(t => t || "");
    }

    const homepage = (repo.homepageUrl || repo.homepage || "");
    const aboutContent = [
      repo.description || "",
      topics.join(" "),
      homepage
    ].join(" ").toLowerCase();

    // Busca ferramentas na string combinada
    this.searchToolsInContent(aboutContent, foundTools);

    return foundTools;
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

    // Testar verificação de idade
    this.testAgeVerification();


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
