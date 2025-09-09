const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

class GitHubAccessibilityMiner {
    constructor() {
        this.token = process.env.GITHUB_TOKEN;
        this.baseUrl = 'https://api.github.com';
        this.csvFile = 'repositorios_acessibilidade.csv';
        this.processedReposFile = 'processed_repos.json';
        this.processedRepos = this.loadProcessedRepos();
        this.perPage = 100;
        
        // Sem controle de tempo interno - o GitHub Actions já controla com timeout-minutes: 35791
        this.startTime = Date.now();
        
        // Ferramentas de acessibilidade
        this.accessibilityTools = {
            'AXE': ['axe-core', 'axe', '@axe-core', 'react-axe', 'axe-selenium', 'cypress-axe', 'jest-axe', 'axe-playwright'],
            'Pa11y': ['pa11y', 'pa11y-ci', '@pa11y'],
            'WAVE': ['wave', 'wave-cli'],
            'AChecker': ['achecker', 'accessibility-checker', 'ibma/equal-access'],
            'Lighthouse': ['lighthouse', '@lighthouse', 'lighthouse-ci', 'lhci'],
            'Asqatasun': ['asqatasun', 'asqata-sun'],
            'HTML_CodeSniffer': ['html_codesniffer', 'htmlcs', 'squizlabs/html_codesniffer', 'pa11y-reporter-htmlcs']
        };
        
        // Arquivos de configuração
        this.configFiles = [
            '.pa11yci.json', '.pa11yci.yaml', '.lighthouseci.json', '.html_codesniffer.json',
            'pa11y.json', 'lighthouse.json', 'axe.json', 'wave.json',
            '.pa11y.json', '.lighthouse.json', '.axe.json', '.wave.json',
            'pa11y.js', 'pa11yci.js', '.pa11yrc', '.pa11yrc.json', 'lhci.json'
        ];
        
        this.stats = {
            analyzed: 0,
            saved: 0,
            errors: 0,
            skipped: 0,
            startTime: new Date().toISOString()
        };
        
        // Inicializar CSV se não existir
        this.initializeCSV();
    }
    
    initializeCSV() {
        if (!fs.existsSync(this.csvFile)) {
            const headers = [
                'Repositório',
                'Número de Estrelas', 
                'Último Commit',
                'AXE',
                'Pa11y', 
                'WAVE',
                'AChecker',
                'Lighthouse',
                'Asqatasun',
                'HTML_CodeSniffer'
            ].join(',');
            fs.writeFileSync(this.csvFile, headers + '\n');
        }
    }
    
    loadProcessedRepos() {
        try {
            if (fs.existsSync(this.processedReposFile)) {
                const data = JSON.parse(fs.readFileSync(this.processedReposFile, 'utf8'));
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
            fs.writeFileSync(this.processedReposFile, JSON.stringify([...this.processedRepos], null, 2));
        } catch (error) {
            console.log(`⚠️ Erro ao salvar repositórios processados: ${error.message}`);
        }
    }
    
    async makeRequest(url) {
        const options = {
            headers: {
                'User-Agent': 'GitHub-Accessibility-Miner-Action',
                'Accept': 'application/vnd.github.v3+json',
                'Authorization': `token ${this.token}`
            },
            timeout: 30000
        };
        
        const response = await fetch(url, options);
        
        // Verificar rate limit
        const rateLimit = parseInt(response.headers.get('x-ratelimit-remaining'));
        const resetTime = parseInt(response.headers.get('x-ratelimit-reset'));
        
        if (rateLimit < 100) {
            const waitTime = Math.max((resetTime * 1000) - Date.now() + 5000, 0);
            console.log(`⏳ Rate limit baixo (${rateLimit}), aguardando ${Math.ceil(waitTime/1000)}s...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }
    
    async searchRepositories(query, page = 1) {
        const searchUrl = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&page=${page}&per_page=${this.perPage}`;
        
        try {
            console.log(`🔍 Buscando: "${query}" - Página ${page}`);
            return await this.makeRequest(searchUrl);
        } catch (error) {
            console.log(`❌ Erro na busca: ${error.message}`);
            throw error;
        }
    }
    
    async getRepositoryContents(owner, repo, path = '') {
        const url = `${this.baseUrl}/repos/${owner}/${repo}/contents/${path}`;
        
        try {
            const contents = await this.makeRequest(url);
            return Array.isArray(contents) ? contents : [contents];
        } catch (error) {
            if (error.message.includes('404')) {
                return [];
            }
            throw error;
        }
    }
    
    async getFileContent(owner, repo, filePath) {
        try {
            const content = await this.makeRequest(`${this.baseUrl}/repos/${owner}/${repo}/contents/${filePath}`);
            if (content.content) {
                return Buffer.from(content.content, 'base64').toString('utf8');
            }
        } catch (error) {
            return null;
        }
        return null;
    }
    
    isLibraryRepository(repo) {
        const description = (repo.description || '').toLowerCase();
        const name = repo.name.toLowerCase();
        
        const libraryKeywords = [
            'library', 'lib', 'biblioteca', 'component', 'componente', 'plugin',
            'framework', 'toolkit', 'boilerplate', 'template', 'starter',
            'utils', 'utilities', 'helper', 'helpers', 'sdk', 'api-client', 'wrapper',
            'package', 'module', 'tool', 'cli', 'generator', 'scaffold'
        ];
        
        // Palavras que indicam aplicação real
        const appKeywords = ['app', 'application', 'website', 'webapp', 'platform', 'dashboard', 'portal'];
        
        const hasLibraryKeywords = libraryKeywords.some(keyword => 
            description.includes(keyword) || name.includes(keyword)
        );
        
        const hasAppKeywords = appKeywords.some(keyword => 
            description.includes(keyword) || name.includes(keyword)
        );
        
        // Se tem palavras de biblioteca mas não tem de aplicação, é provavelmente uma biblioteca
        return hasLibraryKeywords && !hasAppKeywords;
    }
    
    async analyzeRepository(repo) {
        const owner = repo.owner.login;
        const name = repo.name;
        const fullName = repo.full_name;
        
        console.log(`🔬 Analisando: ${fullName} (⭐ ${repo.stargazers_count})`);
        
        try {
            // Verificar se é muito antigo
            const oneYearAgo = new Date();
            oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
            const lastUpdate = new Date(repo.updated_at);
            
            if (lastUpdate < oneYearAgo) {
                console.log(`   📅 Muito antigo, pulando...`);
                return null;
            }
            
            // Filtrar bibliotecas
            if (this.isLibraryRepository(repo)) {
                console.log(`   📚 Biblioteca detectada, pulando...`);
                return null;
            }
            
            const foundTools = {
                'AXE': false,
                'Pa11y': false,
                'WAVE': false,
                'AChecker': false,
                'Lighthouse': false,
                'Asqatasun': false,
                'HTML_CodeSniffer': false
            };
            
            // Verificar arquivos de configuração
            await this.checkConfigFiles(owner, name, foundTools);
            
            // Verificar package.json (mais comum)
            await this.checkPackageJson(owner, name, foundTools);
            
            // Verificar workflows do GitHub
            await this.checkWorkflows(owner, name, foundTools);
            
            const hasAnyTool = Object.values(foundTools).some(tool => tool);
            
            if (hasAnyTool) {
                const toolsFound = Object.keys(foundTools).filter(key => foundTools[key]);
                console.log(`   ✅ Ferramentas: ${toolsFound.join(', ')}`);
                
                return {
                    repository: fullName,
                    stars: repo.stargazers_count,
                    lastCommit: repo.updated_at,
                    ...foundTools
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
                if (this.configFiles.includes(file.name)) {
                    console.log(`     📄 Config: ${file.name}`);
                    
                    if (file.name.includes('pa11y')) foundTools['Pa11y'] = true;
                    if (file.name.includes('lighthouse') || file.name.includes('lhci')) foundTools['Lighthouse'] = true;
                    if (file.name.includes('axe')) foundTools['AXE'] = true;
                    if (file.name.includes('wave')) foundTools['WAVE'] = true;
                    if (file.name.includes('html_codesniffer')) foundTools['HTML_CodeSniffer'] = true;
                }
            }
        } catch (error) {
            // Ignorar erros de acesso
        }
    }
    
    async checkPackageJson(owner, name, foundTools) {
        try {
            const content = await this.getFileContent(owner, name, 'package.json');
            if (content) {
                console.log(`     📦 Analisando package.json`);
                this.searchToolsInContent(content, foundTools);
            }
        } catch (error) {
            // Ignorar se não existir
        }
    }
    
    async checkWorkflows(owner, name, foundTools) {
        try {
            const workflows = await this.getRepositoryContents(owner, name, '.github/workflows');
            
            for (const workflow of workflows) {
                if (workflow.name.endsWith('.yml') || workflow.name.endsWith('.yaml')) {
                    const content = await this.getFileContent(owner, name, workflow.path);
                    if (content) {
                        console.log(`     ⚙️ Workflow: ${workflow.name}`);
                        this.searchToolsInContent(content, foundTools);
                    }
                }
            }
        } catch (error) {
            // Ignorar se não tiver workflows
        }
    }
    
    searchToolsInContent(content, foundTools) {
        const contentLower = content.toLowerCase();
        
        for (const [toolName, keywords] of Object.entries(this.accessibilityTools)) {
            if (!foundTools[toolName]) {
                for (const keyword of keywords) {
                    if (contentLower.includes(keyword.toLowerCase())) {
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
        
        const csvLines = repositories.map(repo => {
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
                repo.HTML_CodeSniffer
            ].join(',');
        });
        
        fs.appendFileSync(this.csvFile, csvLines.join('\n') + '\n');
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
        console.log(`📈 Taxa de sucesso: ${((this.stats.saved / Math.max(this.stats.analyzed, 1)) * 100).toFixed(1)}%`);
        console.log(`🗃️  Total processados: ${this.processedRepos.size}\n`);
    }
    
    async run() {
        console.log('🚀 GITHUB ACCESSIBILITY MINER - EXECUÇÃO CONTÍNUA');
        console.log(`🔑 Token configurado: ${this.token ? '✅' : '❌'}`);
        console.log(`📊 Repositórios já processados: ${this.processedRepos.size}`);
        console.log(`⏰ Timeout controlado pelo GitHub Actions (35791 minutos)\n`);
        
        const queries = [
            'web application javascript typescript',
            'react app vue app angular app',
            'webapp frontend web-app',
            'web dashboard admin panel',
            'react application vue application', 
            'angular application webapp',
            'next.js app nuxt.js app',
            'fullstack web application',
            'spa single page application',
            'web platform website app'
        ];
        
        const foundRepos = [];
        let queryIndex = 0;
        let currentPage = 1;
        
        // Loop contínuo até acabar o tempo
        while (this.shouldContinueRunning()) {
            try {
                const query = queries[queryIndex % queries.length];
                
                console.log(`\n🔍 Consulta: "${query}" - Página ${currentPage}`);
                
                const searchResult = await this.searchRepositories(query, currentPage);
                
                if (!searchResult.items || searchResult.items.length === 0) {
                    console.log(`   📭 Sem resultados, próxima consulta...`);
                    queryIndex++;
                    currentPage = 1;
                    continue;
                }
                
                for (const repo of searchResult.items) {
                    if (!this.shouldContinueRunning()) break;
                    
                    this.stats.analyzed++;
                    
                    if (this.processedRepos.has(repo.full_name)) {
                        this.stats.skipped++;
                        continue;
                    }
                    
                    const analysis = await this.analyzeRepository(repo);
                    
                    if (analysis) {
                        foundRepos.push(analysis);
                        this.stats.saved++;
                        
                        // Salvar em lotes de 5 para não perder dados
                        if (foundRepos.length >= 5) {
                            this.appendToCSV(foundRepos);
                            foundRepos.forEach(r => this.processedRepos.add(r.repository));
                            this.saveProcessedRepos();
                            foundRepos.length = 0;
                        }
                    }
                    
                    this.processedRepos.add(repo.full_name);
                    
                    // Mostrar progresso a cada 50 repositórios
                    if (this.stats.analyzed % 50 === 0) {
                        this.printProgress();
                    }
                    
                    // Pausa pequena
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                
                // Próxima página ou query
                if (searchResult.items.length === this.perPage && currentPage < 10) {
                    currentPage++;
                } else {
                    queryIndex++;
                    currentPage = 1;
                }
                
                // Pausa entre consultas
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                console.log(`❌ Erro na execução: ${error.message}`);
                
                if (error.message.includes('rate limit')) {
                    console.log(`⏳ Rate limit atingido, aguardando 10 minutos...`);
                    await new Promise(resolve => setTimeout(resolve, 600000));
                } else {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
                
                this.stats.errors++;
            }
        }
        
        // Salvar repositórios restantes
        if (foundRepos.length > 0) {
            this.appendToCSV(foundRepos);
            foundRepos.forEach(r => this.processedRepos.add(r.repository));
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
miner.run().catch(error => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
});
