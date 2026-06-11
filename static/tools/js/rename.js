// PDF电子发票批量重命名工具
(function() {
    'use strict';

    // DOM 元素
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');
    const parseBtn = document.getElementById('parseBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const clearBtn = document.getElementById('clearBtn');
    const ruleInput = document.getElementById('ruleInput');

    const resultsBody = document.getElementById('resultsBody');

    // 状态
    let uploadedFiles = [];
    let parsedResults = [];
    let isProcessing = false;
    let preloadedFiles = [];

    // 性能配置
    const PERFORMANCE_CONFIG = {
        getConcurrency() {
            const cores = navigator.hardwareConcurrency || 4;
            return Math.min(Math.max(cores * 2, 4), 10);
        },
        PRELOAD_BATCH_SIZE: 20,
        USE_WEB_WORKER: false
    };


    /**
     * 初始化
     */
    function init() {
        if (typeof InvoiceExtractor !== 'undefined') {
            InvoiceExtractor.init();
        }

        bindEvents();
    }

    /**
     * 绑定事件
     */
    function bindEvents() {
        // 文件上传
        uploadArea.addEventListener('click', () => fileInput.click());

        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            const files = Array.from(e.dataTransfer.files).filter(f => 
                f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
            );
            handleFiles(files);
        });

        fileInput.addEventListener('change', (e) => {
            handleFiles(Array.from(e.target.files));
        });

        // 按钮事件
        parseBtn.addEventListener('click', startParsing);
        downloadBtn.addEventListener('click', downloadAllFiles);
        clearBtn.addEventListener('click', clearAll);

        // 占位符点击插入
        document.querySelectorAll('.placeholder-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                insertAtCursor(ruleInput, code);
            });
        });

        // 快速规则
        document.querySelectorAll('.quick-rule').forEach(rule => {
            rule.addEventListener('click', () => {
                ruleInput.value = rule.dataset.rule;
            });
        });
    }

    /**
     * 处理文件
     */
    async function handleFiles(files) {
        const pdfFiles = files.filter(f => 
            f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
        );

        if (pdfFiles.length === 0) {
            CommonUtils.showToast('请选择 PDF 文件', 'error');
            return;
        }

        uploadedFiles = [...uploadedFiles, ...pdfFiles];
        parsedResults = [...parsedResults, ...new Array(pdfFiles.length).fill(undefined)];
        preloadedFiles = [...preloadedFiles, ...new Array(pdfFiles.length).fill(undefined)];
        
        parseBtn.disabled = uploadedFiles.length === 0;
        
        renderUploadedFiles();
        preloadFilesInBackground(pdfFiles.length);
        
        CommonUtils.showToast(`已添加 ${pdfFiles.length} 个文件`, 'success');
    }

    /**
     * 后台预加载文件
     */
    async function preloadFilesInBackground(newFileCount) {
        const startIndex = preloadedFiles.length - newFileCount;
        const batchSize = PERFORMANCE_CONFIG.PRELOAD_BATCH_SIZE;
        
        for (let i = startIndex; i < preloadedFiles.length; i += batchSize) {
            const batch = [];
            for (let j = i; j < Math.min(i + batchSize, preloadedFiles.length); j++) {
                if (!preloadedFiles[j] && uploadedFiles[j]) {
                    batch.push(preloadFile(j));
                }
            }
            await Promise.all(batch);
        }
    }

    /**
     * 预加载单个文件
     */
    async function preloadFile(index) {
        try {
            const file = uploadedFiles[index];
            const buffer = await file.arrayBuffer();
            preloadedFiles[index] = buffer;
        } catch (error) {
            console.error('预加载失败:', error);
            preloadedFiles[index] = null;
        }
    }

    /**
     * 渲染上传的文件列表（未重命名状态）
     */
    function renderUploadedFiles() {
        const rule = ruleInput.value.trim() || '{{销售方名称}}-{{开票日期}}-{{含税金额}}';

        // 使用 DocumentFragment 减少 DOM 操作
        const fragment = document.createDocumentFragment();

        // 预计算所有唯一文件名（处理重名）
        const uniqueNames = resolveDuplicateNames(parsedResults, rule);

        uploadedFiles.forEach((file, index) => {
            const result = parsedResults[index];
            const isParsed = result && result.success !== undefined;
            const isSuccess = isParsed && result.success !== false;
            const newName = isSuccess ? uniqueNames[index] : '';
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="old-name" title="${CommonUtils.escapeHtml(file.name)}">
                    ${CommonUtils.escapeHtml(file.name)}
                </td>
                <td class="new-name" title="${CommonUtils.escapeHtml(newName)}">
                    ${isParsed 
                        ? (isSuccess ? CommonUtils.escapeHtml(newName) : '<span style="color: var(--color-error);">重命名失败</span>')
                        : '<span style="color: var(--color-text-tertiary);">待重命名</span>'
                    }
                </td>
                <td style="text-align: center;">
                    ${isSuccess ? `
                        <button class="btn-icon download-single" data-index="${index}" title="下载">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                <polyline points="7 10 12 15 17 10"></polyline>
                                <line x1="12" y1="15" x2="12" y2="3"></line>
                            </svg>
                        </button>
                    ` : ''}
                    <button class="btn-icon delete-single" data-index="${index}" title="删除">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            `;
            fragment.appendChild(tr);
        });
        
        resultsBody.innerHTML = '';
        resultsBody.appendChild(fragment);

        // 绑定单个下载和删除按钮事件
        resultsBody.querySelectorAll('.download-single').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                downloadSingle(index);
            });
        });

        resultsBody.querySelectorAll('.delete-single').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                removeFile(index);
            });
        });
    }

    /**
     * 生成新文件名
     */
    function generateNewName(result, rule) {
        if (!result || result.success === false) return '';

        let newName = rule;
        
        // 解析日期
        let year = '', month = '', day = '';
        if (result.invoiceDate) {
            const dateMatch = result.invoiceDate.match(/(\d{4})[\-/年](\d{1,2})[\-/月](\d{1,2})/);
            if (dateMatch) {
                year = dateMatch[1];
                month = dateMatch[2].padStart(2, '0');
                day = dateMatch[3].padStart(2, '0');
            }
        }

        // 替换占位符
        const values = {
            '{{采购方名称}}': sanitizeFileName(result.buyerName || ''),
            '{{采购方税号}}': sanitizeFileName(result.buyerTaxId || ''),
            '{{销售方名称}}': sanitizeFileName(result.sellerName || ''),
            '{{销售方税号}}': sanitizeFileName(result.sellerTaxId || ''),
            '{{不含税金额}}': result.amount || '',
            '{{发票税额}}': result.taxAmount || '',
            '{{含税金额}}': result.totalAmount || '',
            '{{发票号码}}': result.invoiceNumber || '',
            '{{开票日期}}': result.invoiceDate || '',
            '{{发票类型}}': result.invoiceType || '',
            '{{开票人}}': result.drawer || '',
            '{{备注}}': sanitizeFileName(result.remark || ''),
            '{{年}}': year,
            '{{月}}': month,
            '{{日}}': day
        };

        Object.keys(values).forEach(key => {
            newName = newName.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), values[key] || '');
        });

        // 清理文件名
        newName = newName.replace(/[_\-]+$/, '').replace(/^[\.\-_]+/, '');
        
        if (!newName) {
            newName = result.fileName || '发票';
        }
        
        return newName + '.pdf';
    }

    /**
     * 清理文件名中的非法字符
     */
    function sanitizeFileName(name) {
        return name.replace(/[<>:"/\\|?*]/g, '_').trim();
    }

    /**
     * 解析文件名和扩展名
     */
    function parseFileName(name) {
        const lastDot = name.lastIndexOf('.');
        if (lastDot <= 0) return { baseName: name, ext: '' };
        return {
            baseName: name.substring(0, lastDot),
            ext: name.substring(lastDot)
        };
    }

    /**
     * 解析重名文件，为重复的文件名添加序号后缀
     * @param {Array} results - 解析结果数组
     * @param {string} rule - 命名规则
     * @returns {Array} 每个文件对应的唯一文件名数组
     */
    function resolveDuplicateNames(results, rule) {
        // 先生成所有原始文件名
        const names = results.map(result => {
            if (!result || result.success === false) return '';
            return generateNewName(result, rule);
        });

        // 统计每个文件名出现的次数
        const nameCount = {};
        names.forEach(name => {
            if (name) {
                nameCount[name] = (nameCount[name] || 0) + 1;
            }
        });

        // 为重名文件添加序号
        const nameIndex = {};
        return names.map(name => {
            if (!name) return '';
            if (nameCount[name] <= 1) return name; // 没有重名，直接返回

            const { baseName, ext } = parseFileName(name);
            nameIndex[name] = (nameIndex[name] || 0) + 1;
            return `${baseName}(${nameIndex[name]})${ext}`;
        });
    }

    /**
     * 渲染空结果表格
     */
    function renderEmptyResults() {
        resultsBody.innerHTML = `
            <tr>
                <td colspan="3" style="text-align: center; padding: 48px 24px; color: var(--color-text-secondary);">
                    <div style="font-size: 48px; margin-bottom: 16px;">&#128203;</div>
                    <div style="font-weight: 500; margin-bottom: 8px;">暂无数据</div>
                    <div style="font-size: 14px;">上传 PDF 文件并开始重命名后，将在此显示重命名预览</div>
                </td>
            </tr>
        `;
    }

    /**
     * 开始重命名
     */
    async function startParsing() {
        if (uploadedFiles.length === 0 || isProcessing) return;

        const filesToParse = uploadedFiles.map((file, index) => ({ file, index }))
            .filter(item => !parsedResults[item.index] || parsedResults[item.index].success === undefined);

        if (filesToParse.length > 0) {
            isProcessing = true;
            parseBtn.disabled = true;
            parseBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
                    <circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle>
                </svg>
                重命名中...
            `;
            
            // 动态并发数
            const concurrency = PERFORMANCE_CONFIG.getConcurrency();
            const total = filesToParse.length;
            
            CommonUtils.showToast(`开始重命名 ${total} 个新文件...`, 'success');

            try {
                let completedCount = 0;
                const processNext = async () => {
                    while (completedCount < total) {
                        const batchIndex = completedCount;
                        completedCount++;
                        
                        const { file, index } = filesToParse[batchIndex];
                        await parseSingleFile(file, index);
                        
                        // 实时更新显示
                        renderUploadedFiles();
                    }
                };
                
                const workers = [];
                for (let i = 0; i < Math.min(concurrency, total); i++) {
                    workers.push(processNext());
                }
                
                await Promise.all(workers);

                const successCount = parsedResults.filter(r => r && r.success !== false).length;
                CommonUtils.showToast(`重命名完成！成功 ${successCount} 个`, 'success');
                
                downloadBtn.disabled = successCount === 0;

            } catch (error) {
                CommonUtils.showToast('重命名失败: ' + error.message, 'error');
            } finally {
                isProcessing = false;
                parseBtn.disabled = false;
                parseBtn.innerHTML = `
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                    </svg>
                    开始重命名
                `;
            }
        } else {
            renderUploadedFiles();
            CommonUtils.showToast('已应用新规则', 'success');
        }
    }

    /**
     * 重命名单个文件
     */
    async function parseSingleFile(file, index) {
        try {
            // 使用预加载的文件数据
            let buffer = preloadedFiles[index];
            if (!buffer) {
                buffer = await file.arrayBuffer();
                preloadedFiles[index] = buffer;
            }
            
            const result = await InvoiceExtractor.parseBuffer(buffer, file.name, file.size);
            parsedResults[index] = {
                ...result,
                originalFile: file,
                success: true
            };
        } catch (error) {
            parsedResults[index] = {
                success: false,
                fileName: file.name,
                error: error.message,
                originalFile: file
            };
        }
    }

    /**
     * 下载单个文件
     */
    function downloadSingle(index) {
        const result = parsedResults[index];
        if (!result || result.success === false) return;

        const rule = ruleInput.value.trim() || '{{销售方名称}}-{{开票日期}}-{{含税金额}}';
        const uniqueNames = resolveDuplicateNames(parsedResults, rule);
        const newName = uniqueNames[index];
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(result.originalFile);
        link.download = newName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        
        CommonUtils.showToast(`已下载: ${newName}`, 'success');
    }

    /**
     * 移除文件
     */
    function removeFile(index) {
        uploadedFiles.splice(index, 1);
        parsedResults.splice(index, 1);
        preloadedFiles.splice(index, 1);
        
        if (uploadedFiles.length === 0) {
            clearAll();
        } else {
            renderUploadedFiles();
            parseBtn.disabled = uploadedFiles.length === 0;
            downloadBtn.disabled = parsedResults.filter(r => r && r.success !== false).length === 0;
        }
        
        CommonUtils.showToast('已删除文件', 'success');
    }

    /**
     * 下载全部文件
     */
    async function downloadAllFiles() {
        const rule = ruleInput.value.trim() || '{{销售方名称}}-{{开票日期}}-{{含税金额}}';

        // 获取有效结果的索引
        const validIndices = [];
        parsedResults.forEach((r, i) => {
            if (r && r.success !== false) validIndices.push(i);
        });

        if (validIndices.length === 0) {
            CommonUtils.showToast('没有可下载的文件', 'error');
            return;
        }

        // 预计算所有唯一文件名（处理重名）
        const uniqueNames = resolveDuplicateNames(parsedResults, rule);

        if (validIndices.length > 1 && typeof JSZip !== 'undefined') {
            downloadAsZip(validIndices, uniqueNames);
        } else if (validIndices.length > 1) {
            CommonUtils.showToast('正在下载多个文件...', 'success');
            for (let i = 0; i < validIndices.length; i++) {
                const idx = validIndices[i];
                const result = parsedResults[idx];
                await downloadSingleFile(result.originalFile, uniqueNames[idx]);
                await delay(200);
            }
            CommonUtils.showToast('下载完成！', 'success');
        } else {
            const idx = validIndices[0];
            const result = parsedResults[idx];
            downloadSingleFile(result.originalFile, uniqueNames[idx]);
        }
    }

    /**
     * 下载单个文件（内部函数）
     */
    function downloadSingleFile(file, newName) {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(file);
        link.download = newName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    /**
     * 打包为 ZIP 下载
     */
    async function downloadAsZip(validIndices, uniqueNames) {
        CommonUtils.showToast('正在打包文件...', 'success');

        try {
            const zip = new JSZip();

            validIndices.forEach(idx => {
                const result = parsedResults[idx];
                zip.file(uniqueNames[idx], result.originalFile);
            });

            const content = await zip.generateAsync({type: 'blob'});
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `发票_${new Date().getTime()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            CommonUtils.showToast('打包下载完成！', 'success');
        } catch (error) {
            CommonUtils.showToast('打包失败: ' + error.message, 'error');
        }
    }

    /**
     * 清空所有
     */
    function clearAll() {
        uploadedFiles = [];
        parsedResults = [];
        preloadedFiles = [];
        renderEmptyResults();
        parseBtn.disabled = true;
        downloadBtn.disabled = true;
        fileInput.value = '';
        CommonUtils.showToast('已清空列表', 'success');
    }

    /**
     * 在光标位置插入文本
     */
    function insertAtCursor(input, text) {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const value = input.value;
        
        input.value = value.substring(0, start) + text + value.substring(end);
        input.selectionStart = input.selectionEnd = start + text.length;
        input.focus();
    }

    /**
     * 延迟函数
     */
    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            init();
            renderEmptyResults();
        });
    } else {
        init();
        renderEmptyResults();
    }
})();
