/**
 * 公共组件加载器
 * 用于动态加载 header.html 和 footer.html
 */

(function() {
    'use strict';

    const COMPONENT_CACHE_PREFIX = 'shared-component-cache:';
    const DEFAULT_SITE_CONFIG = {
        siteName: '发票工具箱',
        home: {
            heroTitle: '发票工具箱',
            heroDescription: '批量处理发票文件，提取信息、智能重命名、格式转换，一站式解决'
        },
        tools: []
    };

    function getSiteConfig() {
        return window.SITE_CONFIG || DEFAULT_SITE_CONFIG;
    }

    function getToolConfigs() {
        const config = getSiteConfig();
        return Array.isArray(config.tools) ? config.tools : [];
    }

    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalizePathname(pathname) {
        if (!pathname) return '/';

        let normalized = pathname.replace(/\/index\.html$/i, '/');
        if (normalized.length > 1) {
            normalized = normalized.replace(/\/+$/, '');
        }

        return normalized || '/';
    }

    function getCurrentPage() {
        const path = normalizePathname(window.location.pathname);
        const matchedTool = getToolConfigs().find(tool => (
            path.includes(`/${tool.path}/`) || path.endsWith(`/${tool.path}`)
        ));

        return matchedTool ? matchedTool.id : 'index';
    }

    function getBasePath() {
        return getCurrentPage() === 'index' ? 'static/' : '../static/';
    }

    function getRootPath() {
        return getCurrentPage() === 'index' ? '' : '../';
    }

    function getComponentCacheKey(filePath) {
        return COMPONENT_CACHE_PREFIX + filePath;
    }

    function getCachedComponent(filePath) {
        try {
            return sessionStorage.getItem(getComponentCacheKey(filePath));
        } catch (error) {
            return null;
        }
    }

    function setCachedComponent(filePath, html) {
        try {
            sessionStorage.setItem(getComponentCacheKey(filePath), html);
        } catch (error) {
            // 忽略缓存写入失败
        }
    }

    function renderHeaderNavigation() {
        const rootPath = getRootPath();
        const siteConfig = getSiteConfig();
        const logo = document.getElementById('navLogo');
        const logoText = document.querySelector('#navLogo span');
        const navMenu = document.getElementById('navMenu') || document.querySelector('#header-container .nav-menu');
        const navTools = getToolConfigs().filter(tool => tool.showInNav !== false);

        if (logo) {
            logo.href = rootPath + 'index.html';
        }

        if (logoText) {
            logoText.textContent = siteConfig.siteName || DEFAULT_SITE_CONFIG.siteName;
        }

        if (!navMenu) return;

        navMenu.innerHTML = navTools.map(tool => `
            <li class="nav-item">
                <a
                    href="${rootPath}${tool.path}"
                    class="nav-link"
                    data-page="${escapeHtml(tool.id)}"
                    data-path="${escapeHtml(tool.path)}"
                >${escapeHtml(tool.navLabel || tool.homeName || tool.id)}</a>
            </li>
        `).join('');
    }

    function renderHomeTools() {
        const toolsGrid = document.getElementById('homeToolsGrid');
        if (!toolsGrid) return;

        const rootPath = getRootPath();
        const homeTools = getToolConfigs().filter(tool => tool.showOnHome !== false);

        toolsGrid.innerHTML = homeTools.map(tool => `
            <a href="${rootPath}${tool.path}" class="tool-card">
                <div class="tool-icon">
                    ${tool.iconSvg || ''}
                </div>
                <h2 class="tool-name">${escapeHtml(tool.homeName || tool.navLabel || tool.id)}</h2>
                <p class="tool-desc">${escapeHtml(tool.homeDescription || '')}</p>
                <span class="tool-arrow">
                    开始使用
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </span>
            </a>
        `).join('');
    }

    function renderHomeContent() {
        const siteConfig = getSiteConfig();
        const homeConfig = siteConfig.home || DEFAULT_SITE_CONFIG.home;
        const heroTitle = document.getElementById('homeHeroTitle');
        const heroDesc = document.getElementById('homeHeroDesc');

        if (heroTitle) {
            heroTitle.textContent = homeConfig.heroTitle || DEFAULT_SITE_CONFIG.home.heroTitle;
        }

        if (heroDesc) {
            heroDesc.textContent = homeConfig.heroDescription || DEFAULT_SITE_CONFIG.home.heroDescription;
        }
    }

    function renderComponent(selector, html) {
        const container = document.querySelector(selector);
        if (!container || !html) return false;

        const isSameMarkup = container.__componentMarkup === html;

        if (!isSameMarkup) {
            container.innerHTML = html;
            container.__componentMarkup = html;
            container.__componentInitialized = false;
        }

        if (selector === '#header-container' && !container.__componentInitialized) {
            renderHeaderNavigation();
            highlightCurrentPage();
            initNavLoadingState();
            container.__componentInitialized = true;
        }

        return true;
    }

    async function loadComponent(selector, filePath) {
        const container = document.querySelector(selector);
        if (!container) return;

        const basePath = getBasePath();
        const fullPath = basePath + filePath;
        const cachedHtml = getCachedComponent(filePath);

        if (cachedHtml) {
            renderComponent(selector, cachedHtml);
        }

        try {
            const response = await fetch(fullPath);
            if (!response.ok) throw new Error(`Failed to load ${fullPath}`);
            const html = await response.text();
            setCachedComponent(filePath, html);
            renderComponent(selector, html);
        } catch (error) {
            if (!cachedHtml) {
                console.error('加载组件失败:', error);
            }
        }
    }

    function highlightCurrentPage() {
        const currentPage = getCurrentPage();
        const logo = document.getElementById('navLogo');
        const header = document.querySelector('#header-container .header');

        if (header) {
            header.classList.remove('is-transitioning');
        }

        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active', 'is-loading');
            link.removeAttribute('aria-busy');
            if (link.dataset.page === currentPage) {
                link.classList.add('active');
            }
        });

        if (currentPage === 'index' && logo) {
            logo.classList.add('active');
        }

        if (logo) {
            logo.classList.remove('is-loading');
            logo.removeAttribute('aria-busy');
            if (currentPage !== 'index') {
                logo.classList.remove('active');
            }
        }
    }

    function isModifiedClick(event) {
        return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
    }

    function initNavLoadingState() {
        const header = document.querySelector('#header-container .header');
        if (!header) return;

        const navTargets = header.querySelectorAll('#navLogo, .nav-link');

        navTargets.forEach(link => {
            link.addEventListener('click', (event) => {
                if (event.defaultPrevented || isModifiedClick(event)) return;
                if (link.target && link.target !== '_self') return;
                if (link.hasAttribute('download')) return;

                const href = link.getAttribute('href');
                if (!href || href.startsWith('#')) return;

                const targetUrl = new URL(link.href, window.location.href);
                const currentPath = normalizePathname(window.location.pathname);
                const targetPath = normalizePathname(targetUrl.pathname);

                if (currentPath === targetPath) return;
                if (header.classList.contains('is-transitioning')) {
                    event.preventDefault();
                    return;
                }

                event.preventDefault();
                header.classList.add('is-transitioning');
                link.classList.add('is-loading');
                link.setAttribute('aria-busy', 'true');

                window.setTimeout(() => {
                    window.location.assign(targetUrl.href);
                }, 120);
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    function init() {
        renderHomeContent();
        renderHomeTools();

        if (document.getElementById('header-container')) {
            loadComponent('#header-container', 'components/header.html');
        }
        if (document.getElementById('footer-container')) {
            loadComponent('#footer-container', 'components/footer.html');
        }
    }
})();
