const fs = require('fs');
const https = require('https');
const path = require('path');

// Configuração da API do GitHub - Suporte para múltiplos tokens
const TOKENS = [
    process.env.GITHUB_TOKEN,
].filter(Boolean);

const BASE_URL = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const CSV_FILE = 'repositorios_acessibilidade.csv';
const STATE_FILE = 'mining_state.json';
const PROCESSED_REPOS_FILE = 'processed_repos.json';

// Ferramentas de acessibilidade (multi-linguagem) - Versão expandida
const ACCESSIBILITY_TOOLS = {
    AXE: [
        // JavaScript/Node.js
        'axe-core', 'axe', '@axe-core', 'react-axe', 'axe-selenium',
        'cypress-axe', 'jest-axe', 'axe-playwright', 'axe-webdriverjs', 'vue-axe',
        // Python
        'axe-selenium-python', 'pytest-axe', 'axe-core-python',
        // Java
        'axe-selenium-java', 'axe-core-maven', 'axe-core-api',
        // C#
        'selenium.axe', 'axe.core', 'axe-core-nuget',
        // Ruby
        'axe-core-rspec', 'axe-matchers', 'axe-core-capybara',
        // PHP
        'axe-core-php', 'dmore/chrome-mink-driver'
    ],
    Pa11y: [
        // JavaScript/Node.js
        'pa11y', 'pa11y-ci', '@pa11y', 'pa11y-webdriver', 'pa11y-reporter-cli',
        // Python
        'pa11y-python', 'accessibility-checker-python',
        // Outros
        'pa11y-dashboard', 'koa-pa11y'
    ],
    WAVE: ['wave', 'wave-cli', 'wave-accessibility', 'webaim-wave'],
    AChecker: [
        'achecker', 'accessibility-checker', 'ibma/equal-access',
        'equal-access', 'accessibility-checker-engine'
    ],
    Lighthouse: [
        // JavaScript/Node.js
        'lighthouse', '@lighthouse', 'lighthouse-ci', 'lhci',
        'lighthouse-batch', 'lighthouse-plugin-accessibility', 'lighthouse-ci-action',
        // Python
        'pylighthouse', 'lighthouse-python',
        // Outros
        'lighthouse-badges', 'lighthouse-keeper'
    ],
    Asqatasun: ['asqatasun', 'asqata-sun', 'tanaguru', 'contrast-finder'],
    HTML_CodeSniffer: [
        'html_codesniffer', 'htmlcs', 'squizlabs/html_codesniffer',
        'pa11y-reporter-htmlcs', 'htmlcodesniffer', 'html-codesniffer'
    ]
};

// Arquivos específicos que indicam presença das ferramentas
const TOOL_FILES = [
    '.pa11yci.json', '.pa11yci.yaml', '.lighthouseci.json', '.html_codesniffer.json',
    'pa11y.json', 'lighthouse.json', 'axe.json', 'wave.json',
    '.pa11y.json', '.lighthouse.json', '.axe.json', '.wave.json',
    'pa11y.js', 'pa11yci.js', '.pa11yrc', '.pa11yrc.json', 'lhci.json'
];

// Arquivos de dependências a serem analisados (expandido para múltiplas linguagens)
const DEPENDENCY_FILES = [
    // JavaScript/Node.js
    'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
    // Python
    'requirements.txt', 'requirements.in', 'Pipfile', 'Pipfile.lock',
    'pyproject.toml', 'setup.py', 'setup.cfg', 'poetry.lock',
    // PHP
    'composer.json', 'composer.lock',
    // Java
    'pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.properties',
    // C# / .NET
    'packages.config', 'project.json', '*.csproj', '*.fsproj', '*.vbproj',
    'Directory.Build.props', 'Directory.Packages.props',
    // Ruby
    'Gemfile', 'Gemfile.lock', '*.gemspec',
    // Go
    'go.mod', 'go.sum', 'Gopkg.toml', 'Gopkg.lock',
    // Rust
    'Cargo.toml', 'Cargo.lock',
    // Dart/Flutter
    'pubspec.yaml', 'pubspec.lock',
    // Swift
    'Package.swift', 'Podfile', 'Podfile.lock',
    // Outros
    'Makefile', 'CMakeLists.txt', 'meson.build'
];

// Arquivos de workflow que podem indicar uso das ferramentas
const WORKFLOW_FILES = [
    '.github/workflows'
];

// Indicadores de que é uma aplicação web
const WEB_APP_INDICATORS = [
    // Arquivos HTML principais
    'public/index.html',
    'src/index.html',
    'index.html',
    'dist/index.html',
    
    // Configurações de bundlers web
    'webpack.config.js',
    'vite.config.js',
    'rollup.config.js',
    'parcel.config.js',
    
    // Frameworks web específicos
    'next.config.js',
    'nuxt.config.js',
    'vue.config.js',
    'angular.json',
    'gatsby-config.js',
    'svelte.config.js',
    'remix.config.js',
    
    // Arquivos de servidor web
    'server.js',
    'app.js',
    'main.js',
    'index.js',
    
    // Estruturas típicas de web apps
    'public/',
    'static/',
    'assets/',
    'www/',
    'build/',
    'dist/',
    
    // Arquivos de configuração web
    'babel.config.js',
    'postcss.config.js',
    'tailwind.config.js',
    '.babelrc',
    
    // Docker para web apps
    'Dockerfile',
    'docker-compose.yml'
];

// Palavras-chave que indicam bibliotecas (para filtrar)
const LIBRARY_KEYWORDS = [
    'library',
    'framework',
    'plugin',
    'component',
    'util',
    'helper',
    'boilerplate',
    'template',
    'starter',
    'kit',
    'cli',
    'tool',
    'awesome',
    'mobile',
    'android',
    'ios',
    'desktop',
    'electron',
    'native',
    'flutter',
    'react-native'
];

class GitHubMiner {
    constructor() {
        this.tokens = TOKENS;
        this.tokenIndex = 0;
        this.token = this.tokens[0];
        this.tokenLimits = Array(this.tokens.length).fill(null);
        
        this.analyzedCount = 0;
        this.savedCount = 0;
        this.errorCount = 0;
        this.skippedCount = 0;
        
        this.processedRepos = this.loadProcessedRepos();
        this.currentCursor = null;
        this.startTime = Date.now();
        
        // Carrega repositórios já salvos no CSV para evitar duplicatas
        this.loadReposFromCSV();
        this.loadState();
        this.initializeCSV();

        console.log(`🔑 Configurados ${this.tokens.length} tokens do GitHub`);
        console.log(`📊 ${this.processedRepos.size} repositórios já processados`);
    }

    // Carrega repositórios processados do JSON
    loadProcessedRepos() {
        try {
            if (fs.existsSync(PROCESSED_REPOS_FILE)) {
                const data = JSON.parse(fs.readFileSync(PROCESSED_REPOS_FILE, 'utf8'));
                console.log(`📋 Carregados ${data.length} repositórios já processados`);
                return new Set(data);
            }
        } catch (error) {
            console.log(`⚠️ Erro ao carregar repositórios processados: ${error.message}`);
        }
        return new Set();
    }

    // Salva repositórios processados no JSON
    saveProcessedRepos() {
        try {
            fs.writeFileSync(PROCESSED_REPOS_FILE, JSON.stringify([...this.processedRepos], null, 2));
        } catch (error) {
            console.log(`⚠️ Erro ao salvar repositórios processados: ${error.message}`);
        }
    }

    // Carrega repositórios já salvos do CSV
    loadReposFromCSV() {
        try {
            if (fs.existsSync(CSV_FILE)) {
                const csvContent = fs.readFileSync(CSV_FILE, 'utf8');
                const lines = csvContent.split('\n');
                
                for (let i = 1; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line) {
                        const columns = line.split(',');
                        const repoName = columns[0].replace(/"/g, '');
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

    // Carrega o estado anterior da mineração
    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                this.currentCursor = state.cursor;
                console.log(`Estado carregado com cursor: ${this.currentCursor ? 'Sim' : 'Não'}`);
            }
        } catch (error) {
            console.error('Erro ao carregar estado:', error);
        }
    }

    // Salva o estado atual da mineração
    saveState() {
        try {
            const state = {
                cursor: this.currentCursor,
                lastRun: new Date().toISOString(),
                analyzedCount: this.analyzedCount,
                savedCount: this.savedCount
            };
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
            this.saveProcessedRepos();
        } catch (error) {
            console.error('Erro ao salvar estado:', error);
        }
    }

    // Gerenciamento de tokens múltiplos
    nextToken() {
        this.tokenIndex = (this.tokenIndex + 1) % this.tokens.length;
        this.token = this.tokens[this.tokenIndex];
        console.log(`🔄 Trocando para token ${this.tokenIndex + 1}`);
    }

    switchTokenIfNeeded(rateLimit) {
        if (rateLimit !== null && rateLimit <= 100) {
            let startIndex = this.tokenIndex;
            let found = false;
            
            for (let i = 1; i <= this.tokens.length; i++) {
                let nextIndex = (startIndex + i) % this.tokens.length;
                if (!this.tokenLimits[nextIndex] || this.tokenLimits[nextIndex] > 100) {
                    this.tokenIndex = nextIndex;
                    this.token = this.tokens[this.tokenIndex];
                    found = true;
                    console.log(`🔄 Mudando para token ${nextIndex + 1} (rate limit baixo: ${rateLimit})`);
                    break;
                }
            }
            
            if (!found && this.tokens.length > 1) {
                console.log('⏳ Todos os tokens com rate limit baixo, aguardando...');
                return true; // Indica que deve aguardar
            }
        }
        return false;
    }

    // Inicializa o arquivo CSV se não existir
    initializeCSV() {
        if (!fs.existsSync(CSV_FILE)) {
            const toolNames = Object.keys(ACCESSIBILITY_TOOLS);
            const header = [
                'Repositório',
                'Estrelas',
                'Último Commit',
                ...toolNames
            ].join(',') + '\n';
            fs.writeFileSync(CSV_FILE, header);
            console.log(`📁 Arquivo CSV criado: ${CSV_FILE}`);
            console.log(`🔧 Ferramentas que serão detectadas: ${toolNames.join(', ')}`);
        } else {
            console.log(`📁 Usando arquivo CSV existente: ${CSV_FILE}`);
        }
    }

    // Faz requisições HTTP com tratamento de erro, retry e múltiplos tokens
    async makeRequest(url, options = {}) {
        const maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                const response = await this._httpRequest(url, options);
                
                // Captura rate limit dos headers
                if (response.headers) {
                    const rateLimit = parseInt(response.headers['x-ratelimit-remaining']);
                    const resetTime = parseInt(response.headers['x-ratelimit-reset']);
                    
                    if (!isNaN(rateLimit)) {
                        this.tokenLimits[this.tokenIndex] = rateLimit;
                        
                        // Trocar token se rate limit baixo
                        if (this.switchTokenIfNeeded(rateLimit)) {
                            const waitTime = Math.max(resetTime * 1000 - Date.now() + 5000, 10000);
                            console.log(`⏳ Aguardando ${Math.ceil(waitTime / 1000)}s para reset do rate limit...`);
                            await this.sleep(waitTime);
                        }
                    }
                }
                
                return response.data;
            } catch (error) {
                retries++;
                
                if (error.status === 403) {
                    console.log('Rate limit atingido, tentando próximo token...');
                    this.nextToken();
                    await this.sleep(5000);
                } else if (error.status === 401) {
                    console.log('Token inválido, tentando próximo...');
                    this.nextToken();
                } else if (retries === maxRetries) {
                    throw error;
                } else {
                    await this.sleep(1000 * retries); // Backoff exponencial
                }
            }
        }
    }

    // Função auxiliar para fazer requisições HTTP
    _httpRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const requestOptions = {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'User-Agent': 'GitHub-Accessibility-Miner-Action',
                    'Accept': 'application/vnd.github.v3+json',
                    ...options.headers
                },
                timeout: 30000
            };

            if (options.method === 'POST') {
                requestOptions.method = 'POST';
            }

            const req = https.request(url, requestOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    try {
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve({
                                data: JSON.parse(data),
                                headers: res.headers
                            });
                        } else {
                            reject({ 
                                status: res.statusCode, 
                                message: data,
                                headers: res.headers
                            });
                        }
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', reject);
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            if (options.body) {
                req.write(JSON.stringify(options.body));
            }

            req.end();
        });
    }

    // Faz consulta GraphQL
    async graphqlQuery(query, variables = {}) {
        const url = GRAPHQL_URL;
        const options = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: {
                query,
                variables
            }
        };

        return await this.makeRequest(url, options);
    }

    // Busca conteúdo de arquivos do repositório
    async getFileContent(owner, repo, filePath) {
        try {
            const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${filePath}`;
            const content = await this.makeRequest(url);
            if (content && content.content) {
                return Buffer.from(content.content, 'base64').toString('utf8');
            }
        } catch (error) {
            return null;
        }
        return null;
    }

    // Busca conteúdo do README
    async getReadmeContent(owner, repo) {
        // 1. Tenta via endpoint oficial do GitHub para README principal
        try {
            const apiUrl = `${BASE_URL}/repos/${owner}/${repo}/readme`;
            const content = await this.makeRequest(apiUrl);
            if (content && content.content) {
                return Buffer.from(content.content, 'base64').toString('utf8');
            }
        } catch (e) {
            // Se não encontrar, tenta varredura README.*
        }
        
        // 2. Tenta buscar README.* na raiz
        try {
            const rootContents = await this.getRepositoryContents(owner, repo);
            for (const file of rootContents) {
                if (file && typeof file.name === 'string' && /^README\.[^/]+$/i.test(file.name)) {
                    try {
                        const content = await this.getFileContent(owner, repo, file.name);
                        if (content) return content;
                    } catch (e) {
                        continue;
                    }
                }
            }
        } catch (e) {
            // ignora erro ao listar arquivos do root
        }
        return null;
    }

    // Busca conteúdo de diretórios do repositório
    async getRepositoryContents(owner, repo, path = '') {
        const url = `${BASE_URL}/repos/${owner}/${repo}/contents/${path}`;
        
        try {
            const contents = await this.makeRequest(url);
            return Array.isArray(contents) ? contents : [contents];
        } catch (error) {
            if (error.status === 404) {
                return [];
            }
            throw error;
        }
    }

    // Busca repositórios usando GraphQL com query específica
    async searchRepositories(query = null, cursor = null) {
        // Query padrão se não fornecida
        const searchQuery = query || "pushed:>2024-09-01 is:public language:JavaScript OR language:TypeScript OR language:HTML OR language:PHP OR language:Python";
        
        const graphqlQuery = `
            query searchRepos($query: String!, $cursor: String) {
                search(
                    query: $query,
                    type: REPOSITORY,
                    first: 50,
                    after: $cursor
                ) {
                    repositoryCount
                    pageInfo {
                        hasNextPage
                        endCursor
                    }
                    nodes {
                        ... on Repository {
                            nameWithOwner
                            stargazerCount
                            pushedAt
                            description
                            homepageUrl
                            primaryLanguage {
                                name
                            }
                            repositoryTopics(first: 20) {
                                nodes {
                                    topic {
                                        name
                                    }
                                }
                            }
                            defaultBranchRef {
                                name
                                target {
                                    ... on Commit {
                                        committedDate
                                    }
                                }
                            }
                            owner {
                                login
                            }
                            isArchived
                            isFork
                        }
                    }
                }
                rateLimit {
                    remaining
                    resetAt
                }
            }
        `;

        try {
            const result = await this.graphqlQuery(graphqlQuery, { 
                query: `${searchQuery} sort:stars-desc`,
                cursor 
            });
            
            if (result.errors) {
                console.error('Erros na consulta GraphQL:', result.errors);
                throw new Error('Erro na consulta GraphQL');
            }
            
            // Log do rate limit GraphQL
            if (result.rateLimit) {
                console.log(`   📊 Rate limit GraphQL: ${result.rateLimit.remaining} restantes`);
                this.tokenLimits[this.tokenIndex] = result.rateLimit.remaining;
            }
            
            console.log(`📊 Total de repositórios encontrados na busca: ${result.search.repositoryCount}`);
            
            return {
                items: result.search.nodes || [],
                pageInfo: result.search.pageInfo,
                totalCount: result.search.repositoryCount
            };
        } catch (error) {
            console.error('Erro na consulta GraphQL:', error);
            throw error;
        }
    }

    // Verifica se o repositório é uma biblioteca/framework usando README
    async isLibrary(repo) {
        const owner = (repo.owner && repo.owner.login) || '';
        const name = (repo.name || repo.nameWithOwner || '').toLowerCase();
        const fullName = (repo.nameWithOwner || '').toLowerCase();
        const description = (repo.description || '').toLowerCase();

        // Adapta topics para GraphQL
        let topicsArr = [];
        if (repo.repositoryTopics && Array.isArray(repo.repositoryTopics.nodes)) {
            topicsArr = repo.repositoryTopics.nodes.map(
                (n) => ((n && n.topic && n.topic.name) || '').toLowerCase()
            );
        } else if (Array.isArray(repo.topics)) {
            topicsArr = repo.topics.map((t) => (t || '').toLowerCase());
        }

        const homepage = (repo.homepageUrl || repo.homepage || '').toLowerCase();

        // Tenta buscar o README
        let readmeContent = '';
        try {
            const repoName = repo.name || repo.nameWithOwner.split('/')[1];
            const readme = await this.getReadmeContent(owner, repoName);
            if (readme) {
                readmeContent = readme.toLowerCase();
            } else {
                console.log(`   ⚠️ README não encontrado, pulando repositório por segurança`);
                return true;
            }
        } catch (e) {
            console.log(`   ⚠️ Erro ao buscar README, pulando repositório por segurança`);
            return true;
        }

        // Verificações diretas no README
        if (readmeContent.includes('library') || 
            readmeContent.includes('biblioteca') ||
            readmeContent.includes('lib') ||
            readmeContent.includes('gui') ||
            readmeContent.includes('graphical user interface') ||
            name === 'turbo') {
            console.log(`   📚 Biblioteca/GUI detectada no README (menção direta)`);
            return true;
        }

        // Filtro genérico para bibliotecas/frameworks
        if (readmeContent) {
            const firstLinesArr = readmeContent.split('\n').slice(0, 15);
            const firstLines = firstLinesArr.join(' ');
            
            const libIndicators = [
                'is a library', 'is a framework', 'component library', 'ui library',
                'framework for', 'toolkit for', 'library for', 'framework that',
                'for building', 'for developers', 'npm package', 'node module',
                'react library', 'vue library', 'angular library', 'plugin for'
            ];
            
            const appIndicators = [
                'this is a web application', 'live demo', 'try it online',
                'production site', 'hosted at', 'visit the app'
            ];
            
            const isLib = libIndicators.some(phrase => firstLines.includes(phrase));
            const isApp = appIndicators.some(phrase => firstLines.includes(phrase));
            
            if (isLib && !isApp) {
                console.log(`   📚 Biblioteca/framework detectada por frases genéricas no README`);
                return true;
            }
        }

        // Combina informações para análise final
        const combinedText = [description, name, fullName, topicsArr.join(' '), homepage, readmeContent].join(' ');

        // Palavras-chave definitivas de bibliotecas
        const strongLibraryKeywords = [
            'library', 'framework', 'plugin', 'component', 'util', 'utils',
            'helper', 'helpers', 'boilerplate', 'template', 'starter', 'kit',
            'cli', 'tool', 'tools', 'awesome', 'collection', 'list',
            'examples', 'example', 'tutorial', 'tutorials', 'demo', 'demos',
            'sample', 'samples', 'docs', 'documentation', 'guide', 'guides',
            'npm package', 'pip package', 'gem', 'composer package',
            'ui kit', 'design system', 'components library'
        ];

        // Apps não-web específicos
        const nonWebKeywords = [
            'mobile app', 'android app', 'ios app', 'desktop app',
            'electron app', 'native app', 'flutter app', 'react native',
            'xamarin', 'unity', 'game', 'cli tool', 'command line',
            'terminal', 'console', 'api only', 'backend only',
            'microservice', 'rest api', 'graphql api', 'server only'
        ];

        // Padrões no nome
        const libraryNamePatterns = [
            /^awesome-/, /^.*-awesome$/, /^.*-template$/, /^template-/,
            /^.*-boilerplate$/, /^boilerplate-/, /^.*-starter$/, /^starter-/,
            /^.*-kit$/, /^.*-utils$/, /^.*-helpers$/, /^.*-components$/,
            /^.*-ui$/, /^ui-/, /^.*-cli$/, /^.*-tool$/
        ];

        const hasLibraryKeywords = strongLibraryKeywords.some(keyword => combinedText.includes(keyword));
        const hasNonWebKeywords = nonWebKeywords.some(keyword => combinedText.includes(keyword));
        const hasLibraryNamePattern = libraryNamePatterns.some(pattern => pattern.test(name) || pattern.test(fullName));

        const isLibrary = hasLibraryKeywords || hasNonWebKeywords || hasLibraryNamePattern;

        if (isLibrary) {
            const reasons = [];
            if (hasLibraryKeywords) reasons.push('palavras-chave de biblioteca');
            if (hasNonWebKeywords) reasons.push('palavras-chave não-web');
            if (hasLibraryNamePattern) reasons.push('padrão de nome de biblioteca');
            console.log(`   📚 É biblioteca/framework: ${reasons.join(', ')}`);
        }

        return isLibrary;
    }

    // Verifica se é uma aplicação web
    async isWebApplication(repo) {
        try {
            // Primeiro verifica se tem indicadores óbvios de apps não-web
            const description = (repo.description || '').toLowerCase();
            const name = repo.nameWithOwner.toLowerCase();
            const language = repo.primaryLanguage?.name?.toLowerCase() || '';
            
            // Rejeita explicitamente apps móveis/desktop
            const nonWebKeywords = ['mobile', 'android', 'ios', 'desktop', 'electron', 'native', 'flutter', 'react-native', 'xamarin', 'unity', 'cli', 'command line', 'terminal', 'api only', 'backend only'];
            const isNonWebApp = nonWebKeywords.some(keyword => 
                description.includes(keyword) || name.includes(keyword)
            );
            
            if (isNonWebApp) {
                console.log(`   🚫 Rejeitado por palavras-chave não-web`);
                return false;
            }

            // Linguagens que frequentemente indicam aplicações web
            const webLanguages = ['javascript', 'typescript', 'html', 'css', 'php', 'python', 'ruby', 'vue', 'svelte'];
            const isWebLanguage = webLanguages.includes(language);

            // Verifica arquivos que indicam aplicação web
            let webIndicatorFound = false;
            for (const file of WEB_APP_INDICATORS.slice(0, 10)) { // Verifica apenas os primeiros 10 para economizar requests
                try {
                    const url = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/${file}`;
                    await this.makeRequest(url);
                    console.log(`   📁 Encontrado arquivo web: ${file}`);
                    webIndicatorFound = true;
                    break; // Se encontrou um, já é suficiente
                } catch (error) {
                    // Arquivo não encontrado, continua procurando
                    continue;
                }
            }

            if (webIndicatorFound) return true;

            // Verifica package.json para dependências web
            try {
                const packageUrl = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/package.json`;
                const packageData = await this.makeRequest(packageUrl);
                
                if (packageData.content) {
                    const content = Buffer.from(packageData.content, 'base64').toString('utf8');
                    const packageJson = JSON.parse(content);
                    
                    // Verifica dependências típicas de web apps
                    const webDependencies = [
                        'react', 'vue', 'angular', 'svelte', 'next', 'nuxt', 'gatsby',
                        'express', 'fastify', 'koa', 'hapi', 'nestjs',
                        'webpack', 'vite', 'rollup', 'parcel',
                        'react-dom', 'vue-router', 'react-router',
                        'axios', 'fetch', 'cors', 'helmet',
                        'tailwindcss', 'bootstrap', 'material-ui', 'chakra-ui'
                    ];
                    
                    const dependencies = {
                        ...(packageJson.dependencies || {}),
                        ...(packageJson.devDependencies || {})
                    };
                    
                    const hasWebDeps = webDependencies.some(dep => 
                        Object.keys(dependencies).some(key => key.includes(dep))
                    );
                    
                    if (hasWebDeps) {
                        console.log(`   📦 Encontradas dependências web no package.json`);
                        return true;
                    }
                    
                    // Verifica scripts típicos de web apps
                    const scripts = packageJson.scripts || {};
                    const webScripts = ['build', 'start', 'dev', 'serve', 'preview'];
                    const hasWebScripts = webScripts.some(script => scripts[script]);
                    
                    if (hasWebScripts) {
                        console.log(`   🔧 Encontrados scripts web no package.json`);
                        return true;
                    }
                }
            } catch (error) {
                // package.json não encontrado ou inválido
            }

            // Verifica se tem estrutura típica de web app no diretório raiz
            try {
                const contentsUrl = `${BASE_URL}/repos/${repo.nameWithOwner}/contents`;
                const contents = await this.makeRequest(contentsUrl);

                const webFolders = ['public', 'src', 'static', 'assets', 'www', 'client', 'frontend', 'web', 'app'];
                const hasWebStructure = contents.some(item => 
                    item.type === 'dir' && webFolders.includes(item.name.toLowerCase())
                );
                
                const webFiles = contents.some(item =>
                    item.name.toLowerCase().includes('webpack') ||
                    item.name.toLowerCase().includes('vite') ||
                    item.name.toLowerCase().includes('rollup') ||
                    item.name.toLowerCase().includes('babel') ||
                    item.name === 'index.html' ||
                    item.name.endsWith('.html')
                );

                if (hasWebStructure || webFiles) {
                    console.log(`   🏗️  Encontrada estrutura de web app`);
                    return true;
                }
            } catch (error) {
                // Erro ao listar conteúdo
            }

            // Fallback: se for JavaScript/TypeScript e não foi explicitamente rejeitado, considera como possível web app
            if (isWebLanguage && !isNonWebApp) {
                console.log(`   🌐 Considerado web app por linguagem: ${language}`);
                return true;
            }

            console.log(`   ❌ Não identificado como web app`);
            return false;
        } catch (error) {
            console.error(`Erro ao verificar se é web app: ${repo.nameWithOwner}`, error);
            return false;
        }
    }

    // Verifica a presença de ferramentas de acessibilidade
    async checkAccessibilityTools(repo) {
        console.log(`   🔍 Iniciando busca por ferramentas de acessibilidade...`);
        
        const toolsFound = {};
        // Inicializa com todas as ferramentas como false
        Object.keys(ACCESSIBILITY_TOOLS).forEach(tool => toolsFound[tool] = false);

        try {
            // 1. Busca ferramentas nos arquivos
            const detectedTools = await this.searchAccessibilityTools(repo);
            
            // Marca as ferramentas encontradas
            detectedTools.forEach(tool => {
                if (toolsFound.hasOwnProperty(tool)) {
                    toolsFound[tool] = true;
                } else {
                    // Tenta mapear para nomes padronizados
                    const mappedTool = this.mapToolName(tool);
                    if (mappedTool && toolsFound.hasOwnProperty(mappedTool)) {
                        toolsFound[mappedTool] = true;
                    }
                }
            });

            // 2. Verifica workflows do GitHub Actions
            await this.checkWorkflowFiles(repo, toolsFound);

            const foundTools = Object.keys(toolsFound).filter(tool => toolsFound[tool]);
            if (foundTools.length > 0) {
                console.log(`   ✅ Ferramentas de acessibilidade confirmadas: ${foundTools.join(', ')}`);
            } else {
                console.log(`   ❌ Nenhuma ferramenta de acessibilidade confirmada`);
            }

            return toolsFound;
        } catch (error) {
            console.error(`   ⚠️ Erro ao verificar ferramentas: ${error.message}`);
            return toolsFound;
        }
    }

    // Mapeia nomes de ferramentas para os nomes padronizados
    mapToolName(tool) {
        const mapping = {
            'axe': 'AXE',
            'axe-core': 'AXE',
            'pa11y': 'Pa11y',
            'lighthouse': 'Lighthouse',
            'wave': 'WAVE',
            'achecker': 'AChecker',
            'asqatasun': 'Asqatasun',
            'html_codesniffer': 'HTML_CodeSniffer',
            'htmlcs': 'HTML_CodeSniffer'
        };
        
        return mapping[tool.toLowerCase()] || null;
    }

    // Busca ferramentas de acessibilidade nos arquivos
    async searchAccessibilityTools(repo) {
        const tools = [];
        const totalFiles = TOOL_FILES.length + DEPENDENCY_FILES.length;
        let checkedFiles = 0;

        console.log(`   🔍 Analisando ${totalFiles} tipos de arquivos para detectar ferramentas...`);

        // Verifica arquivos de ferramentas diretas
        for (const file of TOOL_FILES) {
            checkedFiles++;
            if (checkedFiles % 5 === 0 || checkedFiles === totalFiles) {
                console.log(`   📋 Progresso: ${checkedFiles}/${totalFiles} tipos verificados`);
            }

            try {
                const content = await this.getFileContent(repo, file);
                if (content) {
                    console.log(`   ✅ Arquivo ${file} encontrado`);
                    
                    // Analisa o conteúdo para detectar ferramentas específicas
                    const detectedTools = this.detectToolsInContent(content, file);
                    tools.push(...detectedTools);
                }
            } catch (error) {
                // Arquivo não encontrado, continua
            }
        }

        // Verifica arquivos de dependência
        for (const file of DEPENDENCY_FILES) {
            checkedFiles++;
            if (checkedFiles % 5 === 0 || checkedFiles === totalFiles) {
                console.log(`   📋 Progresso: ${checkedFiles}/${totalFiles} tipos verificados`);
            }

            try {
                const content = await this.getFileContent(repo, file);
                if (content) {
                    console.log(`   ✅ Arquivo ${file} encontrado`);
                    const detectedTools = this.detectDependencyTools(content, file);
                    tools.push(...detectedTools);
                }
            } catch (error) {
                // Arquivo não encontrado, continua
            }
        }

        // Remove duplicatas
        const uniqueTools = [...new Set(tools)];
        
        if (uniqueTools.length > 0) {
            console.log(`   🎯 Ferramentas detectadas: ${uniqueTools.join(', ')}`);
        } else {
            console.log(`   ❌ Nenhuma ferramenta de acessibilidade detectada`);
        }

        return uniqueTools;
    }

    // Detecta ferramentas em arquivos diretos (configs, scripts)
    detectToolsInContent(content, filename) {
        const tools = [];
        const contentLower = content.toLowerCase();
        
        // Para cada categoria de ferramenta
        for (const [toolName, variations] of Object.entries(ACCESSIBILITY_TOOLS)) {
            // Verifica se alguma variação da ferramenta está presente
            const found = variations.some(variation => contentLower.includes(variation.toLowerCase()));
            
            if (found) {
                tools.push(toolName);
                console.log(`     🔧 ${toolName} detectada em ${filename}`);
            }
        }
        
        return tools;
    }

    // Detecta ferramentas em arquivos de dependência
    detectDependencyTools(content, filename) {
        const tools = [];
        
        try {
            let dependencies = {};
            
            if (filename.includes('package.json')) {
                const parsed = JSON.parse(content);
                dependencies = {
                    ...parsed.dependencies,
                    ...parsed.devDependencies,
                    ...parsed.peerDependencies,
                    ...parsed.optionalDependencies
                };
            } else if (filename.includes('requirements.txt')) {
                const lines = content.split('\n');
                for (const line of lines) {
                    const pkg = line.trim().split(/[>=<]/)[0];
                    if (pkg) dependencies[pkg] = true;
                }
            } else if (filename.includes('Gemfile')) {
                const lines = content.split('\n');
                for (const line of lines) {
                    const match = line.match(/gem\s+['"]([^'"]+)['"]/);
                    if (match) dependencies[match[1]] = true;
                }
            } else if (filename.includes('composer.json')) {
                const parsed = JSON.parse(content);
                dependencies = {
                    ...parsed.require,
                    ...parsed['require-dev']
                };
            } else if (filename.includes('pom.xml')) {
                // Busca por dependências Maven
                const artifactMatches = content.match(/<artifactId>([^<]+)<\/artifactId>/g);
                if (artifactMatches) {
                    for (const match of artifactMatches) {
                        const artifactId = match.replace(/<\/?artifactId>/g, '');
                        dependencies[artifactId] = true;
                    }
                }
            } else if (filename.includes('build.gradle')) {
                // Busca por dependências Gradle
                const gradleMatches = content.match(/['"]([^:'"]+:[^:'"]+:[^'"]+)['"]/g);
                if (gradleMatches) {
                    for (const match of gradleMatches) {
                        const parts = match.replace(/['"]/g, '').split(':');
                        if (parts.length >= 2) {
                            dependencies[parts[1]] = true;
                        }
                    }
                }
            }
            
            // Verifica se alguma dependência corresponde a uma ferramenta de acessibilidade
            for (const [toolName, variations] of Object.entries(ACCESSIBILITY_TOOLS)) {
                const found = Object.keys(dependencies).some(dep => 
                    variations.some(variation => 
                        dep.toLowerCase().includes(variation.toLowerCase()) ||
                        variation.toLowerCase().includes(dep.toLowerCase())
                    )
                );
                
                if (found) {
                    tools.push(toolName);
                    console.log(`     📦 ${toolName} detectada como dependência em ${filename}`);
                }
            }
            
        } catch (error) {
            console.log(`     ⚠️ Erro ao analisar dependências em ${filename}: ${error.message}`);
        }
        
        return tools;
    }

    // Verifica workflows do GitHub Actions
    async checkWorkflowFiles(repo, toolsFound) {
        try {
            console.log(`   🔄 Verificando workflows do GitHub Actions...`);
            const workflowsUrl = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/.github/workflows`;
            const workflows = await this.makeRequest(workflowsUrl);

            for (const workflow of workflows) {
                if (workflow.name.endsWith('.yml') || workflow.name.endsWith('.yaml')) {
                    try {
                        console.log(`   📁 Analisando workflow: ${workflow.name}`);
                        const workflowContent = await this.getFileContent(repo, workflow.path);

                        if (workflowContent) {
                            // Analisa usando o novo sistema de detecção
                            const detectedTools = this.detectToolsInContent(workflowContent, workflow.name);
                            
                            // Marca as ferramentas encontradas
                            detectedTools.forEach(tool => {
                                const mappedTool = this.mapToolName(tool);
                                if (mappedTool && toolsFound.hasOwnProperty(mappedTool)) {
                                    toolsFound[mappedTool] = true;
                                    console.log(`     ✅ ${mappedTool} detectada no workflow ${workflow.name}`);
                                }
                            });
                        }
                    } catch (error) {
                        console.log(`     ⚠️ Erro ao analisar workflow ${workflow.name}: ${error.message}`);
                        continue;
                    }
                }
            }
        } catch (error) {
            console.log(`   ℹ️ Sem workflows ou erro ao acessá-los: ${error.message}`);
        }
    }

    // Salva repositório no CSV
    saveToCSV(repo, toolsFound) {
        const lastCommit = repo.defaultBranchRef?.target?.committedDate || repo.pushedAt;
        
        // Usa as chaves do objeto ACCESSIBILITY_TOOLS para manter a ordem
        const toolNames = Object.keys(ACCESSIBILITY_TOOLS);
        
        const row = [
            `"${repo.nameWithOwner}"`,
            repo.stargazerCount,
            lastCommit,
            ...toolNames.map(tool => toolsFound[tool] ? 'Sim' : 'Não')
        ].join(',') + '\n';

        fs.appendFileSync(CSV_FILE, row);
        this.savedCount++;
        
        const foundTools = toolNames.filter(tool => toolsFound[tool]);
        console.log(`✅ Salvo: ${repo.nameWithOwner} (${repo.stargazerCount} ⭐) - Ferramentas: ${foundTools.join(', ')}`);
    }

    // Função de sleep para aguardar
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Função principal de mineração
    async mine() {
        console.log('🚀 Iniciando mineração de repositórios do GitHub...');
        console.log(`🔑 Usando ${this.tokens.length} token(s) para rotação`);

        // Estratégias de consulta mais abrangentes
        const queryStrategies = [
            'web application accessibility testing',
            'accessibility audit tool',
            'a11y testing framework',
            'web accessibility checker',
            'axe-core accessibility',
            'pa11y accessibility testing',
            'lighthouse accessibility audit',
            'accessibility compliance testing',
            'web accessibility automation',
            'WCAG testing tool'
        ];

        try {
            for (const query of queryStrategies) {
                console.log(`\n🔍 Executando consulta: "${query}"`);
                
                let hasNextPage = true;
                let cursor = null;

                while (hasNextPage) {
                    console.log(`\n📊 Buscando repositórios... (cursor: ${cursor || 'inicial'})`);

                    const searchResult = await this.searchRepositories(query, cursor);
                    const repositories = searchResult.data?.search?.nodes || [];

                    console.log(`🔍 Encontrados ${repositories.length} repositórios para análise`);

                    for (const repo of repositories) {
                        // Pula se já foi processado
                        if (this.processedRepos.has(repo.nameWithOwner)) {
                            console.log(`   ⏭️ Já processado: ${repo.nameWithOwner}`);
                            continue;
                        }

                        this.analyzedCount++;
                        this.processedRepos.add(repo.nameWithOwner);

                        console.log(`\n🔄 Analisando: ${repo.nameWithOwner} (${repo.stargazerCount} ⭐)`);

                        // Verifica se tem commits após setembro de 2024
                        const lastCommit = new Date(repo.defaultBranchRef?.target?.committedDate || repo.pushedAt);
                        if (lastCommit < new Date('2024-09-01')) {
                            console.log(`   ⏭️ Pulando: commits muito antigos (${lastCommit.toISOString().split('T')[0]})`);
                            continue;
                        }

                        // Verifica se é biblioteca/framework
                        const isLib = await this.isLibrary(repo);
                        if (isLib) {
                            console.log(`   ⏭️ Pulando: é uma biblioteca/framework`);
                            continue;
                        }

                        // Verifica se é aplicação web
                        const isWebApp = await this.isWebApplication(repo);
                        if (!isWebApp) {
                            console.log(`   ⏭️ Pulando: não é uma aplicação web`);
                            continue;
                        }

                        console.log(`   ✨ É uma aplicação web! Verificando ferramentas de acessibilidade...`);

                        // Verifica ferramentas de acessibilidade
                        const toolsFound = await this.checkAccessibilityTools(repo);
                        const hasAccessibilityTools = Object.values(toolsFound).some(found => found);

                        if (hasAccessibilityTools) {
                            this.saveToCSV(repo, toolsFound);
                            const foundTools = Object.keys(toolsFound).filter(tool => toolsFound[tool]);
                            console.log(`   🎯 Ferramentas encontradas: ${foundTools.join(', ')}`);
                        } else {
                            console.log(`   ❌ Nenhuma ferramenta de acessibilidade encontrada`);
                        }

                        // Pequena pausa para evitar rate limiting
                        await this.sleep(100);
                    }

                    // Atualiza cursor e estado
                    hasNextPage = searchResult.data?.search?.pageInfo?.hasNextPage || false;
                    cursor = searchResult.data?.search?.pageInfo?.endCursor;

                    // Salva estado a cada página
                    this.saveState();

                    console.log(`\n📈 Progresso: ${this.analyzedCount} analisados, ${this.savedCount} salvos`);

                    // Pausa entre páginas
                    await this.sleep(1000);

                    // Para evitar consultas infinitas, limita a 50 repositórios por query
                    if (repositories.length < 10) {
                        console.log(`   ℹ️ Poucos resultados encontrados, passando para próxima consulta...`);
                        break;
                    }
                }

                // Pausa maior entre diferentes consultas
                await this.sleep(2000);
            }

        } catch (error) {
            console.error('❌ Erro durante a mineração:', error);
            this.saveState();
        }

        this.printSummary();
    }

    // Imprime resumo final
    printSummary() {
        console.log('\n🎉 Mineração concluída!');
        console.log(`📊 Resumo:`);
        console.log(`   • Repositórios analisados: ${this.analyzedCount}`);
        console.log(`   • Repositórios salvos: ${this.savedCount}`);
        console.log(`   • Taxa de sucesso: ${this.analyzedCount > 0 ? ((this.savedCount / this.analyzedCount) * 100).toFixed(2) : 0}%`);
        console.log(`   • Arquivo gerado: ${CSV_FILE}`);
        
        if (fs.existsSync(CSV_FILE)) {
            const fileSize = fs.statSync(CSV_FILE).size;
            console.log(`   • Tamanho do arquivo: ${(fileSize / 1024).toFixed(2)} KB`);
        }
    }
}

// Execução principal
async function main() {
    if (!GITHUB_TOKEN) {
        console.error('❌ Token do GitHub não encontrado. Configure a variável de ambiente GITHUB_TOKEN');
        process.exit(1);
    }

    const miner = new GitHubMiner();
    await miner.mine();
}

// Tratamento de sinais para salvar estado antes de encerrar
process.on('SIGINT', () => {
    console.log('\n🛑 Interrompido pelo usuário. Salvando estado...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Processo terminado. Salvando estado...');
    process.exit(0);
});

// Inicia a mineração
if (require.main === module) {
    main().catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = GitHubMiner;
