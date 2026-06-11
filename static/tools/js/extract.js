/**
 * 发票提取工具 - 主应用逻辑
 * 依赖: InvoiceExtractor, CommonUtils (common.js)
 */
(function() {
    'use strict';

    // DOM 元素
    const elements = {
        uploadArea: document.getElementById('uploadArea'),
        fileInput: document.getElementById('fileInput'),
        fileList: document.getElementById('fileList'),
        fileItems: document.getElementById('fileItems'),
        fileCount: document.getElementById('fileCount'),
        clearFiles: document.getElementById('clearFiles'),
        actions: document.getElementById('actions'),
        parseBtn: document.getElementById('parseBtn'),
        progressSection: document.getElementById('progressSection'),
        progressFill: document.getElementById('progressFill'),
        progressCount: document.getElementById('progressCount'),
        progressCurrent: document.getElementById('progressCurrent'),
        resultsSection: document.getElementById('resultsSection'),
        resultsTable: document.getElementById('resultsTable'),
        resultsBody: document.getElementById('resultsBody'),
        exportCsvBtn: document.getElementById('exportCsvBtn'),
        exportExcelBtn: document.getElementById('exportExcelBtn'),
        reuploadBtn: document.getElementById('reuploadBtn'),
        emptyState: document.getElementById('emptyState'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    // 状态
    let state = {
        files: [],
        results: [],
        isProcessing: false
    };

    /**
     * 更新文件列表
     */
    function updateFileList() {
        if (state.files.length === 0) {
            elements.fileList.style.display = 'none';
            elements.actions.style.display = 'none';
            elements.emptyState.style.display = 'block';
            elements.resultsSection.style.display = 'none';
            return;
        }

        elements.emptyState.style.display = 'none';
        elements.fileList.style.display = 'block';
        elements.actions.style.display = 'block';
        elements.fileCount.textContent = state.files.length;

        elements.fileItems.innerHTML = state.files.map((file, index) => `
            <li class="file-item">
                <div class="file-item-info">
                    <svg class="file-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <span class="file-name">${file.name}</span>
                    <span class="file-size">${CommonUtils.formatFileSize(file.size)}</span>
                </div>
                <button class="file-remove" data-index="${index}" aria-label="删除文件">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </li>
        `).join('');

        // 绑定删除按钮事件
        elements.fileItems.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const index = parseInt(btn.dataset.index);
                removeFile(index);
            });
        });
    }

    /**
     * 添加文件
     */
    function addFiles(newFiles) {
        const pdfFiles = Array.from(newFiles).filter(f => f.type === 'application/pdf');
        
        if (pdfFiles.length === 0) {
            CommonUtils.showToast('请上传 PDF 格式的文件', 'info');
            return;
        }

        // 去重并添加新文件
        let addedCount = 0;
        pdfFiles.forEach(file => {
            const exists = state.files.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
                state.files.push(file);
                state.results.push(null);
                addedCount++;
            }
        });

        if (addedCount > 0) {
            CommonUtils.showToast(`已添加 ${addedCount} 个文件`, 'success');
        }

        updateFileList();
    }

    /**
     * 删除文件
     */
    function removeFile(index) {
        state.files.splice(index, 1);
        state.results.splice(index, 1);
        updateFileList();
    }

    /**
     * 清空文件
     */
    function clearFiles() {
        state.files = [];
        state.results = [];
        updateFileList();
    }

    /**
     * 处理拖放
     */
    function handleDragOver(e) {
        e.preventDefault();
        elements.uploadArea.classList.add('dragover');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        elements.uploadArea.classList.remove('dragover');
    }

    function handleDrop(e) {
        e.preventDefault();
        elements.uploadArea.classList.remove('dragover');
        addFiles(e.dataTransfer.files);
    }

    /**
     * 开始解析
     */
    async function startParsing() {
        if (state.files.length === 0 || state.isProcessing) return;

        const filesToParse = state.files.map((file, index) => ({ file, index }))
            .filter(item => !state.results[item.index] || state.results[item.index] === null);

        if (filesToParse.length === 0) {
            CommonUtils.showToast('所有文件已解析', 'info');
            if (state.results.some(r => r !== null)) {
                displayResults();
            }
            return;
        }

        state.isProcessing = true;
        
        elements.fileList.style.display = 'none';
        elements.actions.style.display = 'none';
        elements.progressSection.style.display = 'block';
        elements.resultsSection.style.display = 'none';
        elements.parseBtn.disabled = true;
        elements.parseBtn.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin">
                <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle>
            </svg>
            提取中...
        `;

        const startTime = Date.now();
        const totalNew = filesToParse.length;

        try {
            let currentIndex = 0;
            const newResults = await InvoiceExtractor.parsePDFs(
                filesToParse.map(item => item.file), 
                (current, total, result) => {
                    currentIndex++;
                    const percent = (currentIndex / totalNew) * 100;
                    elements.progressFill.style.width = percent + '%';
                    elements.progressCount.textContent = `${currentIndex}/${totalNew}`;
                    elements.progressCurrent.textContent = result.fileName;
                }, 
                { concurrency: 4, preserveOrder: true }
            );

            filesToParse.forEach((item, idx) => {
                state.results[item.index] = newResults[idx];
            });

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            const successCount = state.results.filter(r => r && r.success).length;
            
            CommonUtils.showToast(`提取完成：${successCount}/${state.files.length} 成功，用时 ${elapsed} 秒`, 'success');
            displayResults();

        } catch (error) {
            console.error('解析错误:', error);
            CommonUtils.showToast('提取过程中发生错误', 'error');
        } finally {
            state.isProcessing = false;
            elements.parseBtn.disabled = false;
            elements.parseBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                开始提取
            `;
        }
    }

    /**
     * 转义 HTML 特殊字符
     */
    function escapeHtml(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * 显示结果
     */
    function displayResults() {
        const validResults = state.results.filter(r => r !== null);
        if (validResults.length === 0) return;

        elements.progressSection.style.display = 'none';
        elements.resultsSection.style.display = 'block';

        elements.resultsBody.innerHTML = state.results.map(result => {
            if (result === null) {
                return '';
            }
            if (!result.success) {
                return `
                    <tr>
                        <td>${escapeHtml(result.fileName)}</td>
                        <td colspan="13">-</td>
                        <td><span class="status status-error">失败</span></td>
                    </tr>
                `;
            }

            // 备注中的换行符转换为 <br>
            const remark = result.remark ? escapeHtml(result.remark).replace(/\n/g, '<br>') : '-';

            return `
                <tr>
                    <td title="${escapeHtml(result.fileName)}">${escapeHtml(result.fileName)}</td>
                    <td>${escapeHtml(result.invoiceType) || '-'}</td>
                    <td>${escapeHtml(result.invoiceNumber) || '-'}</td>
                    <td>${escapeHtml(result.invoiceDate) || '-'}</td>
                    <td title="${escapeHtml(result.buyerName)}">${escapeHtml(result.buyerName) || '-'}</td>
                    <td>${escapeHtml(result.buyerTaxId) || '-'}</td>
                    <td title="${escapeHtml(result.sellerName)}">${escapeHtml(result.sellerName) || '-'}</td>
                    <td>${escapeHtml(result.sellerTaxId) || '-'}</td>
                    <td>${escapeHtml(result.amount) || '-'}</td>
                    <td>${escapeHtml(result.taxAmount) || '-'}</td>
                    <td>${escapeHtml(result.totalAmount) || '-'}</td>
                    <td>${escapeHtml(result.totalAmountCn) || '-'}</td>
                    <td style="white-space: pre-wrap; min-width: 150px;">${remark}</td>
                    <td>${escapeHtml(result.drawer) || '-'}</td>
                    <td><span class="status status-success">成功</span></td>
                </tr>
            `;
        }).join('');

        elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ========== 导出功能 ==========

    const FIELD_LABELS = InvoiceExtractor.getFieldLabels();

    /**
     * 生成CSV内容
     */
    function generateCSVContent(results) {
        const validResults = results.filter(r => r.success !== false);

        if (validResults.length === 0) {
            throw new Error('没有成功解析的发票数据');
        }

        const headers = ['文件名', ...Object.keys(FIELD_LABELS).map(key => FIELD_LABELS[key])];

        const clean = (val) => val ? String(val).replace(/,/g, ' ') : '';

        // 防止纯数字在 Excel 中显示为科学计数法：在数字前加 tab 前缀强制文本
        const forceText = (val) => {
            if (!val) return '';
            const str = String(val).replace(/,/g, ' ');
            return /^\d+$/.test(str) ? `"\t${str}"` : `"${str.replace(/"/g, '""')}"`;
        };

        const rows = validResults.map(r => [
            `"${clean(r.fileName).replace(/"/g, '""')}"`,
            forceText(r.invoiceNumber),
            `"${clean(r.invoiceType).replace(/"/g, '""')}"`,
            `"${clean(r.invoiceDate).replace(/"/g, '""')}"`,
            `"${clean(r.buyerName).replace(/"/g, '""')}"`,
            forceText(r.buyerTaxId),
            `"${clean(r.sellerName).replace(/"/g, '""')}"`,
            forceText(r.sellerTaxId),
            `"${clean(r.amount).replace(/"/g, '""')}"`,
            `"${clean(r.taxAmount).replace(/"/g, '""')}"`,
            `"${clean(r.totalAmount).replace(/"/g, '""')}"`,
            `"${clean(r.totalAmountCn).replace(/"/g, '""')}"`,
            forceText(r.remark),
            `"${clean(r.drawer).replace(/"/g, '""')}"`,
        ]);

        const BOM = '\uFEFF';
        return BOM + [
            headers.join(','),
            ...rows.map(row => row.join(','))
        ].join('\n');
    }

    /**
     * 生成CSV并下载
     */
    function generateCSV(results, filename = '发票信息.csv') {
        const csvContent = generateCSVContent(results);

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        return results.filter(r => r.success !== false).length;
    }

    /**
     * 生成Excel（需要SheetJS库）
     */
    function generateExcel(results, filename = '发票信息.xlsx', options = {}) {
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel导出需要SheetJS库');
        }

        const validResults = results.filter(r => r.success !== false);

        if (validResults.length === 0) {
            throw new Error('没有成功解析的发票数据');
        }

        const clean = (val) => val ? String(val) : '';

        const headers = ['文件名', ...Object.keys(FIELD_LABELS).map(key => FIELD_LABELS[key])];

        const rows = validResults.map(r => [
            r.fileName || '',
            clean(r.invoiceType),
            clean(r.invoiceNumber),
            clean(r.invoiceDate),
            clean(r.buyerName),
            clean(r.buyerTaxId),
            clean(r.sellerName),
            clean(r.sellerTaxId),
            clean(r.amount),
            clean(r.taxAmount),
            clean(r.totalAmount),
            clean(r.totalAmountCn),
            clean(r.remark),
            clean(r.drawer)
        ]);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

        // 设置列宽
        ws['!cols'] = options.colWidths || [
            { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 14 },
            { wch: 30 }, { wch: 22 }, { wch: 30 }, { wch: 22 },
            { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 35 },
            { wch: 25 }, { wch: 10 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, '发票信息');
        XLSX.writeFile(wb, filename);

        return validResults.length;
    }

    /**
     * 导出 CSV
     */
    function exportCSV() {
        const validResults = state.results.filter(r => r !== null);
        if (validResults.length === 0) {
            CommonUtils.showToast('没有可导出的数据', 'info');
            return;
        }

        try {
            generateCSV(validResults, '发票信息.csv');
            CommonUtils.showToast('CSV 导出成功', 'success');
        } catch (error) {
            CommonUtils.showToast('导出失败: ' + error.message, 'error');
        }
    }

    /**
     * 导出 Excel
     */
    function exportExcel() {
        const validResults = state.results.filter(r => r !== null);
        if (validResults.length === 0) {
            CommonUtils.showToast('没有可导出的数据', 'info');
            return;
        }

        try {
            generateExcel(validResults, '发票信息.xlsx', {
                colWidths: [
                    { wch: 15 },
                    { wch: 9 },
                    { wch: 20 },
                    { wch: 14 },
                    { wch: 28 },
                    { wch: 20 },
                    { wch: 28 },
                    { wch: 20 },
                    { wch: 10 },
                    { wch: 8 },
                    { wch: 10 },
                    { wch: 20 },
                    { wch: 20 },
                    { wch: 10 }
                ]
            });
            CommonUtils.showToast('Excel 导出成功', 'success');
        } catch (error) {
            console.error('Excel 导出错误:', error);
            CommonUtils.showToast('Excel 库加载失败，尝试 CSV 格式', 'info');
            try {
                generateCSV(validResults, '发票信息.csv');
            } catch (e) {
                CommonUtils.showToast('导出失败: ' + e.message, 'error');
            }
        }
    }

    /**
     * 重新上传
     */
    function reupload() {
        state.files = [];
        state.results = [];
        state.isProcessing = false;
        
        elements.fileInput.value = '';
        elements.resultsSection.style.display = 'none';
        elements.progressSection.style.display = 'none';
        elements.emptyState.style.display = 'block';
        
        window.scrollTo({ top: 0, behavior: 'smooth' });
        CommonUtils.showToast('请上传新的发票文件', 'info');
    }

    /**
     * 初始化事件监听
     */
    function initEventListeners() {
        elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
        elements.fileInput.addEventListener('change', (e) => addFiles(e.target.files));

        elements.uploadArea.addEventListener('dragover', handleDragOver);
        elements.uploadArea.addEventListener('dragleave', handleDragLeave);
        elements.uploadArea.addEventListener('drop', handleDrop);

        elements.clearFiles.addEventListener('click', clearFiles);
        elements.parseBtn.addEventListener('click', startParsing);

        elements.exportCsvBtn.addEventListener('click', exportCSV);
        elements.exportExcelBtn.addEventListener('click', exportExcel);
        elements.reuploadBtn.addEventListener('click', reupload);

        // 阻止拖放到页面其他区域时打开文件
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', (e) => {
            if (e.target !== elements.uploadArea && !elements.uploadArea.contains(e.target)) {
                e.preventDefault();
            }
        });
    }

    /**
     * 初始化
     */
    function init() {
        if (typeof InvoiceExtractor !== 'undefined') {
            InvoiceExtractor.init();
        }
        
        initEventListeners();
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
