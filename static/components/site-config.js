(function(global) {
    'use strict';

    const tools = [
        {
            id: 'extract',
            path: 'extract',
            navLabel: '提取工具',
            homeName: '发票提取',
            homeDescription: '批量解析PDF发票，自动识别发票信息并导出Excel表格，支持多种发票类型',
            showInNav: true,
            showOnHome: true,
            iconSvg: `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            `
        },
        {
            id: 'rename',
            path: 'rename',
            navLabel: '重命名工具',
            homeName: '智能重命名',
            homeDescription: '根据发票信息批量重命名文件，自定义命名规则，让文件管理更高效',
            showInNav: true,
            showOnHome: true,
            iconSvg: `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
            `
        },
        {
            id: 'file-name',
            path: 'file-name',
            navLabel: '发票名提取',
            homeName: '发票名提取',
            homeDescription: '批量提取发票文件名，支持去重、排序，并导出 TXT 或 Excel 文件',
            showInNav: true,
            showOnHome: true,
            iconSvg: `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                </svg>
            `
        },
        {
            id: 'print',
            path: 'print',
            navLabel: '发票打印',
            homeName: '发票打印',
            homeDescription: '多张发票合并排版到A4纸打印，支持每页2/3/4张，可导出合并PDF',
            showInNav: true,
            showOnHome: true,
            iconSvg: `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
            `
        },
        {
            id: 'dedup',
            path: 'dedup',
            navLabel: '发票查重',
            homeName: '发票查重',
            homeDescription: '批量检测重复发票，支持MD5文件查重和发票号码查重',
            showInNav: true,
            showOnHome: true,
            iconSvg: `
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
            `
        }
    ];

    global.SITE_CONFIG = {
        siteName: '发票工具箱',
        home: {
            heroTitle: '发票工具箱',
            heroDescription: '批量处理发票文件，提取信息、智能重命名、格式转换，一站式解决'
        },
        tools
    };
})(window);
