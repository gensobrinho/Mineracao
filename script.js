const fs = require('fs');
const https = require('https');
const path = require('path');

// Configuração da API do GitHub
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BASE_URL = 'https://api.github.com';
const GRAPHQL_URL = 'https://api.github.com/graphql';
const CSV_FILE = 'repositorios_acessibilidade.csv';
const STATE_FILE = 'mining_state.json';

// Ferramentas de acessibilidade a serem procuradas
const ACCESSIBILITY_TOOLS = [
    'AXE',
    'Pa11y',
    'WAVE',
    'AChecker',
    'Lighthouse',
    'Asqatasun',
    'HTML_CodeSniffer'
];

// Arquivos específicos que indicam presença das ferramentas
const TOOL_FILES = [
    '.pa11yci.json',
    '.lighthouseci.json',
    '.html_codesniffer.json',
    'pa11y.json',
    'lighthouse.json',
    'axe.json',
    'wave.json',
    '.pa11y.json',
    '.lighthouse.json',
    '.axe.json',
    '.wave.json',
    'pa11y.js',
    'pa11yci.js'
];

// Arquivos de dependências a serem analisados
const DEPENDENCY_FILES = [
    'package.json',
    'composer.json',
    'requirements.txt',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'yarn.lock',
    'package-lock.json'
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
        this.analyzedCount = 0;
        this.savedCount = 0;
        this.processedRepos = new Set();
        this.currentCursor = null;
        this.loadState();
        this.initializeCSV();
    }

    // Carrega o estado anterior da mineração
    loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                this.currentCursor = state.cursor;
                this.processedRepos = new Set(state.processedRepos || []);
                console.log(`Estado carregado: ${this.processedRepos.size} repositórios já processados`);
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
                processedRepos: Array.from(this.processedRepos),
                lastRun: new Date().toISOString()
            };
            fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        } catch (error) {
            console.error('Erro ao salvar estado:', error);
        }
    }

    // Inicializa o arquivo CSV se não existir
    initializeCSV() {
        if (!fs.existsSync(CSV_FILE)) {
            const header = [
                'Repositório',
                'Estrelas',
                'Último Commit',
                ...ACCESSIBILITY_TOOLS.map(tool => tool)
            ].join(',') + '\n';
            fs.writeFileSync(CSV_FILE, header);
        }
    }

    // Faz requisições HTTP com tratamento de erro e retry
    async makeRequest(url, options = {}) {
        const maxRetries = 3;
        let retries = 0;

        while (retries < maxRetries) {
            try {
                return await this._httpRequest(url, options);
            } catch (error) {
                retries++;
                if (error.status === 403) {
                    console.log('Rate limit atingido, aguardando...');
                    await this.sleep(60000); // Aguarda 1 minuto
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
                    'Authorization': `token ${GITHUB_TOKEN}`,
                    'User-Agent': 'GitHub-Accessibility-Miner',
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
                            resolve(JSON.parse(data));
                        } else {
                            reject({ status: res.statusCode, message: data });
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

    // Busca repositórios usando GraphQL
    async searchRepositories(cursor = null) {
        const query = `
            query searchRepos($cursor: String) {
                search(
                    query: "pushed:>2024-09-01 is:public language:JavaScript OR language:TypeScript OR language:HTML OR language:PHP OR language:Python",
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
                            primaryLanguage {
                                name
                            }
                            repositoryTopics(first: 10) {
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
                        }
                    }
                }
            }
        `;

        try {
            const result = await this.graphqlQuery(query, { cursor });
            
            if (result.errors) {
                console.error('Erros na consulta GraphQL:', result.errors);
                throw new Error('Erro na consulta GraphQL');
            }
            
            console.log(`📊 Total de repositórios encontrados na busca: ${result.data.search.repositoryCount}`);
            return result.data.search;
        } catch (error) {
            console.error('Erro na consulta GraphQL:', error);
            throw error;
        }
    }

    // Verifica se o repositório é uma biblioteca/framework
    isLibrary(repo) {
        const description = (repo.description || '').toLowerCase();
        const name = repo.nameWithOwner.toLowerCase();
        const topics = repo.repositoryTopics?.nodes?.map(t => t.topic.name.toLowerCase()) || [];

        // Palavras-chave mais específicas para bibliotecas
        const libraryKeywords = [
            'library', 'framework', 'plugin', 'component', 'util', 'utils',
            'helper', 'helpers', 'boilerplate', 'template', 'starter', 'kit',
            'cli', 'tool', 'tools', 'awesome', 'collection', 'list',
            'examples', 'example', 'tutorial', 'tutorials', 'demo', 'demos',
            'sample', 'samples', 'docs', 'documentation', 'guide', 'guides',
            'npm package', 'pip package', 'gem', 'composer package',
            'ui kit', 'design system', 'components library',
            'react component', 'vue component', 'angular component'
        ];

        // Apps não-web mais específicos
        const nonWebKeywords = [
            'mobile app', 'android app', 'ios app', 'desktop app',
            'electron app', 'native app', 'flutter app', 'react native',
            'xamarin', 'unity', 'game', 'cli tool', 'command line',
            'terminal', 'console', 'api only', 'backend only',
            'microservice', 'rest api', 'graphql api', 'server only'
        ];

        // Verifica palavras-chave na descrição e nome
        const hasLibraryKeywords = libraryKeywords.some(keyword =>
            description.includes(keyword) || name.includes(keyword)
        );

        const hasNonWebKeywords = nonWebKeywords.some(keyword =>
            description.includes(keyword) || name.includes(keyword)
        );

        // Verifica tópicos que indicam bibliotecas
        const hasLibraryTopics = topics.some(topic =>
            libraryKeywords.some(keyword => topic.includes(keyword)) ||
            topic === 'library' ||
            topic === 'framework' ||
            topic === 'component' ||
            topic === 'plugin' ||
            topic === 'cli' ||
            topic === 'npm-package' ||
            topic === 'package'
        );

        // Padrões específicos no nome que indicam bibliotecas
        const libraryNamePatterns = [
            /^awesome-/,
            /^.*-awesome$/,
            /^.*-template$/,
            /^template-/,
            /^.*-boilerplate$/,
            /^boilerplate-/,
            /^.*-starter$/,
            /^starter-/,
            /^.*-kit$/,
            /^.*-utils$/,
            /^.*-helpers$/,
            /^.*-components$/,
            /^.*-ui$/,
            /^ui-/,
            /^.*-cli$/,
            /^.*-tool$/,
            /-examples?$/,
            /-samples?$/,
            /-demo$/,
            /-tutorial$/
        ];

        const hasLibraryNamePattern = libraryNamePatterns.some(pattern => 
            pattern.test(name)
        );

        const isLibrary = hasLibraryKeywords || hasLibraryTopics || hasLibraryNamePattern || hasNonWebKeywords;

        if (isLibrary) {
            const reasons = [];
            if (hasLibraryKeywords) reasons.push('palavras-chave de biblioteca');
            if (hasNonWebKeywords) reasons.push('palavras-chave não-web');
            if (hasLibraryTopics) reasons.push('tópicos de biblioteca');
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
        const toolsFound = {};
        ACCESSIBILITY_TOOLS.forEach(tool => toolsFound[tool] = false);

        try {
            // 1. Verifica arquivos específicos das ferramentas
            await this.checkToolFiles(repo, toolsFound);

            // 2. Verifica arquivos de dependências
            await this.checkDependencyFiles(repo, toolsFound);

            // 3. Verifica workflows do GitHub Actions
            await this.checkWorkflowFiles(repo, toolsFound);

            return toolsFound;
        } catch (error) {
            console.error(`Erro ao verificar ferramentas: ${repo.nameWithOwner}`, error);
            return toolsFound;
        }
    }

    // Verifica arquivos específicos das ferramentas
    async checkToolFiles(repo, toolsFound) {
        for (const file of TOOL_FILES) {
            try {
                const url = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/${file}`;
                await this.makeRequest(url);

                // Mapeia o arquivo para a ferramenta correspondente
                if (file.includes('pa11y')) toolsFound['Pa11y'] = true;
                if (file.includes('lighthouse')) toolsFound['Lighthouse'] = true;
                if (file.includes('axe')) toolsFound['AXE'] = true;
                if (file.includes('wave')) toolsFound['WAVE'] = true;
                if (file.includes('html_codesniffer')) toolsFound['HTML_CodeSniffer'] = true;

            } catch (error) {
                // Arquivo não encontrado, continua
                continue;
            }
        }
    }

    // Verifica arquivos de dependências
    async checkDependencyFiles(repo, toolsFound) {
        for (const file of DEPENDENCY_FILES) {
            try {
                const url = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/${file}`;
                const response = await this.makeRequest(url);

                if (response.content) {
                    const content = Buffer.from(response.content, 'base64').toString('utf8');
                    this.analyzeDependencyContent(content, toolsFound);
                }
            } catch (error) {
                // Arquivo não encontrado, continua
                continue;
            }
        }
    }

    // Analisa conteúdo dos arquivos de dependências
    analyzeDependencyContent(content, toolsFound) {
        const lowerContent = content.toLowerCase();

        if (lowerContent.includes('axe-core') || lowerContent.includes('@axe-core')) {
            toolsFound['AXE'] = true;
        }
        if (lowerContent.includes('pa11y')) {
            toolsFound['Pa11y'] = true;
        }
        if (lowerContent.includes('lighthouse')) {
            toolsFound['Lighthouse'] = true;
        }
        if (lowerContent.includes('wave') && lowerContent.includes('accessibility')) {
            toolsFound['WAVE'] = true;
        }
        if (lowerContent.includes('achecker')) {
            toolsFound['AChecker'] = true;
        }
        if (lowerContent.includes('asqatasun')) {
            toolsFound['Asqatasun'] = true;
        }
        if (lowerContent.includes('html_codesniffer') || lowerContent.includes('htmlcs')) {
            toolsFound['HTML_CodeSniffer'] = true;
        }
    }

    // Verifica workflows do GitHub Actions
    async checkWorkflowFiles(repo, toolsFound) {
        try {
            const url = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/.github/workflows`;
            const workflows = await this.makeRequest(url);

            for (const workflow of workflows) {
                if (workflow.name.endsWith('.yml') || workflow.name.endsWith('.yaml')) {
                    try {
                        const workflowUrl = `${BASE_URL}/repos/${repo.nameWithOwner}/contents/${workflow.path}`;
                        const workflowData = await this.makeRequest(workflowUrl);

                        if (workflowData.content) {
                            const content = Buffer.from(workflowData.content, 'base64').toString('utf8');
                            this.analyzeDependencyContent(content, toolsFound);
                        }
                    } catch (error) {
                        continue;
                    }
                }
            }
        } catch (error) {
            // Sem workflows, continua
        }
    }

    // Salva repositório no CSV
    saveToCSV(repo, toolsFound) {
        const lastCommit = repo.defaultBranchRef?.target?.committedDate || repo.pushedAt;
        const row = [
            `"${repo.nameWithOwner}"`,
            repo.stargazerCount,
            lastCommit,
            ...ACCESSIBILITY_TOOLS.map(tool => toolsFound[tool] ? 'Sim' : 'Não')
        ].join(',') + '\n';

        fs.appendFileSync(CSV_FILE, row);
        this.savedCount++;
        console.log(`✅ Salvo: ${repo.nameWithOwner} (${repo.stargazerCount} ⭐)`);
    }

    // Função de sleep para aguardar
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Função principal de mineração
    async mine() {
        console.log('🚀 Iniciando mineração de repositórios do GitHub...');

        try {
            let hasNextPage = true;
            let cursor = this.currentCursor;

            while (hasNextPage) {
                console.log(`\n📊 Buscando repositórios... (cursor: ${cursor || 'inicial'})`);

                const searchResult = await this.searchRepositories(cursor);
                const repositories = searchResult.nodes || [];

                console.log(`🔍 Encontrados ${repositories.length} repositórios para análise`);

                for (const repo of repositories) {
                    // Pula se já foi processado
                    if (this.processedRepos.has(repo.nameWithOwner)) {
                        continue;
                    }

                    this.analyzedCount++;
                    this.processedRepos.add(repo.nameWithOwner);

                    console.log(`\n🔄 Analisando: ${repo.nameWithOwner} (${repo.stargazerCount} ⭐)`);

                    // Verifica se tem commits após setembro de 2024
                    const lastCommit = new Date(repo.defaultBranchRef?.target?.committedDate || repo.pushedAt);
                    if (lastCommit < new Date('2024-09-01')) {
                        console.log(`⏭️  Pulando: commits muito antigos`);
                        continue;
                    }

                    // Verifica se é biblioteca/framework
                    if (this.isLibrary(repo)) {
                        console.log(`⏭️  Pulando: é uma biblioteca/framework`);
                        continue;
                    }

                    // Verifica se é aplicação web
                    const isWebApp = await this.isWebApplication(repo);
                    if (!isWebApp) {
                        console.log(`⏭️  Pulando: não é uma aplicação web`);
                        continue;
                    }

                    console.log(`✨ É uma aplicação web! Verificando ferramentas de acessibilidade...`);

                    // Verifica ferramentas de acessibilidade
                    const toolsFound = await this.checkAccessibilityTools(repo);
                    const hasAccessibilityTools = Object.values(toolsFound).some(found => found);

                    if (hasAccessibilityTools) {
                        this.saveToCSV(repo, toolsFound);
                        const foundTools = Object.keys(toolsFound).filter(tool => toolsFound[tool]);
                        console.log(`🎯 Ferramentas encontradas: ${foundTools.join(', ')}`);
                    } else {
                        console.log(`❌ Nenhuma ferramenta de acessibilidade encontrada`);
                    }

                    // Pequena pausa para evitar rate limiting
                    await this.sleep(100);
                }

                // Atualiza cursor e estado
                hasNextPage = searchResult.pageInfo.hasNextPage;
                cursor = searchResult.pageInfo.endCursor;
                this.currentCursor = cursor;

                // Salva estado a cada página
                this.saveState();

                console.log(`\n📈 Progresso: ${this.analyzedCount} analisados, ${this.savedCount} salvos`);

                // Pausa entre páginas
                await this.sleep(1000);
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
