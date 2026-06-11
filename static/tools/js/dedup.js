/**
 * 发票查重工具
 * 支持 MD5 文件查重和发票号码查重
 * 依赖: InvoiceExtractor, CommonUtils (common.js), pdf.js
 */
(function() {
    'use strict';

    // PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://s4.zstatic.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // DOM 元素
    const elements = {
        fileInput:       document.getElementById('fileInput'),
        uploadArea:      document.getElementById('uploadArea'),
        uploadSection:   document.getElementById('uploadSection'),
        settingsSection: document.getElementById('settingsSection'),
        fileListSection: document.getElementById('fileListSection'),
        fileCount:       document.getElementById('fileCount'),
        fileItems:       document.getElementById('fileItems'),
        addMoreBtn:      document.getElementById('addMoreBtn'),
        startBtn:        document.getElementById('startBtn'),
        clearBtn:        document.getElementById('clearBtn'),
        progressSection: document.getElementById('progressSection'),
        progressFill:    document.getElementById('progressFill'),
        progressCount:   document.getElementById('progressCount'),
        progressCurrent: document.getElementById('progressCurrent'),
        resultsSection:  document.getElementById('resultsSection'),
        totalFiles:      document.getElementById('totalFiles'),
        dupGroups:       document.getElementById('dupGroups'),
        dupFiles:        document.getElementById('dupFiles'),
        noDupCard:       document.getElementById('noDupCard'),
        dupGroupsContainer: document.getElementById('dupGroupsContainer'),
        emptyState:      document.getElementById('emptyState'),
        downloadUniqueBtn: document.getElementById('downloadUniqueBtn'),
        resultsPlaceholder: document.getElementById('resultsPlaceholder'),
        toast:           document.getElementById('toast'),
        toastMessage:    document.getElementById('toastMessage')
    };

    // 状态
    let state = {
        files: [],         // { file, name, md5, invoiceNumber, invoiceType }
        results: [],       // 查重结果
        uniqueFiles: [],   // 非重复文件列表
        isProcessing: false
    };

    /* ============ 工具函数 ============ */

    function getDedupMode() {
        const checked = document.querySelector('input[name="dedupMode"]:checked');
        return checked ? checked.value : 'md5';
    }

    /**
     * 计算文件 MD5（使用 SparkMD5 或 Web Crypto API）
     */
    async function computeMD5(file) {
        // 优先使用 SparkMD5（如果可用）
        if (typeof SparkMD5 !== 'undefined' && SparkMD5.ArrayBuffer) {
            const buffer = await file.arrayBuffer();
            return SparkMD5.ArrayBuffer.hash(buffer);
        }

        // 回退：使用 Web Crypto API 的 SHA-256 作为指纹
        const buffer = await file.arrayBuffer();
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * 从 PDF 提取发票号码
     * 1. 先用 parsePDFBuffer 完整解析
     * 2. 若未提取到号码，用 _debug 接口做更宽松的提取
     */
    async function extractInvoiceNumber(file) {
        const buffer = await file.arrayBuffer();

        // 方法1：完整解析
        try {
            const result = await InvoiceExtractor.parsePDFBuffer(buffer);
            if (result && result.invoiceNumber) {
                return {
                    number: result.invoiceNumber,
                    key: result.invoiceNumber,
                    invoiceType: result.invoiceType || ''
                };
            }
        } catch (e) {
            // 解析失败，尝试备用方法
        }

        // 方法2：直接提取原始文本，宽松匹配发票号码
        try {
            const rawItems = await InvoiceExtractor._debug.extractRawItems(buffer);
            const allText = rawItems.map(i => i.text).join('');

            // 找"发票号码"关键词，取同行右侧数字
            const numKeyword = rawItems.find(i => i.text.includes('发票号码'));
            if (numKeyword) {
                const rightItems = rawItems.filter(i =>
                    i.x > numKeyword.x && Math.abs(i.y - numKeyword.y) < 10
                ).sort((a, b) => a.x - b.x);

                const rightText = rightItems.map(i => i.text).join('');
                const match = rightText.match(/(\d{8,20})/);
                if (match) {
                    return { number: match[1], key: match[1], invoiceType: '' };
                }
            }

            // 方法3：全文正则匹配长数字串（发票号码通常 8-20 位纯数字）
            // 优先匹配"发票号码"附近的数字
            const numIdx = allText.indexOf('发票号码');
            if (numIdx >= 0) {
                const nearText = allText.substring(numIdx, numIdx + 50);
                const nearMatch = nearText.match(/(\d{8,20})/);
                if (nearMatch) {
                    return { number: nearMatch[1], key: nearMatch[1], invoiceType: '' };
                }
            }

            // 最后：全文找最长的纯数字串（>=8位）
            const allNumbers = allText.match(/\d{8,20}/g);
            if (allNumbers && allNumbers.length > 0) {
                // 取最长的数字串作为发票号码
                const longest = allNumbers.reduce((a, b) => a.length >= b.length ? a : b);
                return { number: longest, key: longest, invoiceType: '' };
            }
        } catch (e) {
            // 所有方法都失败
        }

        return null;
    }

    /* ============ 文件上传 ============ */

    function handleFiles(files) {
        if (state.isProcessing) return;

        const arr = Array.from(files);
        if (!arr.length) return;

        for (const file of arr) {
            const ext = file.name.split('.').pop().toLowerCase();
            if (ext !== 'pdf') {
                CommonUtils.showToast(`跳过非PDF文件: ${file.name}`, 'error');
                continue;
            }
            state.files.push({ file, name: file.name, md5: '', invoiceNumber: '', invoiceType: '' });
        }

        updateFileList();
        elements.emptyState.style.display = 'none';
        elements.settingsSection.style.display = '';

        CommonUtils.showToast(`已添加 ${arr.length} 个文件`, 'success');
    }

    /* ============ 文件列表 ============ */

    function updateFileList() {
        elements.fileItems.innerHTML = '';
        elements.fileCount.textContent = state.files.length;

        if (state.files.length === 0) {
            elements.fileListSection.style.display = 'none';
            elements.emptyState.style.display = 'block';
            elements.settingsSection.style.display = 'none';
            return;
        }

        elements.fileListSection.style.display = 'block';
        elements.emptyState.style.display = 'none';
        elements.settingsSection.style.display = '';

        state.files.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.innerHTML = `
                <svg class="file-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <span class="file-item-name" title="${item.name}">${item.name}</span>
                <button class="file-item-remove" data-index="${idx}" title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
            elements.fileItems.appendChild(li);
        });

        // 删除按钮
        elements.fileItems.querySelectorAll('.file-item-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                if (state.isProcessing) return;
                const idx = parseInt(e.currentTarget.dataset.index);
                state.files.splice(idx, 1);
                updateFileList();
            });
        });
    }

    /* ============ 查重核心 ============ */

    async function startDedup() {
        if (state.isProcessing) return;
        if (state.files.length < 2) {
            CommonUtils.showToast('至少需要2个文件才能查重', 'info');
            return;
        }

        state.isProcessing = true;
        const mode = getDedupMode();
        const total = state.files.length;

        // 显示进度 + 加载动画
        elements.progressSection.style.display = '';
        elements.resultsSection.style.display = 'none';
        elements.resultsPlaceholder.style.display = '';
        elements.resultsPlaceholder.classList.add('loading');
        elements.startBtn.disabled = true;

        // 收集指纹（并发批处理）
        const fingerprints = []; // { idx, name, key, invoiceType?, number?, md5? }
        const CONCURRENCY = Math.min(5, total); // 并发数
        let completed = 0;

        // 更新进度的函数
        function updateProgress(idx) {
            completed++;
            elements.progressFill.style.width = `${(completed / total) * 80}%`;
            elements.progressCount.textContent = `${completed}/${total}`;
            elements.progressCurrent.textContent = state.files[idx].name;
        }

        // 处理单个文件
        async function processFile(i) {
            const item = state.files[i];

            // 同时计算 MD5 和发票号码
            const [md5Result, invoiceResult] = await Promise.all([
                computeMD5(item.file).catch(() => null),
                extractInvoiceNumber(item.file).catch(() => null)
            ]);

            // 保存到 state
            state.files[i].md5 = md5Result || '';
            state.files[i].invoiceNumber = invoiceResult ? invoiceResult.number : '';
            state.files[i].invoiceType = invoiceResult ? invoiceResult.invoiceType : '';

            // 根据查重方式选择 key
            let fp;
            if (mode === 'md5') {
                const key = md5Result || null;
                fp = { idx: i, name: item.name, key, md5: md5Result };
            } else {
                const key = invoiceResult ? invoiceResult.key : null;
                fp = {
                    idx: i,
                    name: item.name,
                    key,
                    number: invoiceResult ? invoiceResult.number : null,
                    invoiceType: invoiceResult ? invoiceResult.invoiceType : '',
                    md5: md5Result
                };
            }

            updateProgress(i);
            return fp;
        }

        // 分批并发处理
        for (let batch = 0; batch < total; batch += CONCURRENCY) {
            const batchIndices = [];
            for (let j = batch; j < Math.min(batch + CONCURRENCY, total); j++) {
                batchIndices.push(j);
            }
            const results = await Promise.all(batchIndices.map(i => processFile(i)));
            fingerprints.push(...results);

            // 让 UI 更新
            await new Promise(r => setTimeout(r, 0));
        }

        // 按 idx 排序，保持顺序
        fingerprints.sort((a, b) => a.idx - b.idx);

        // 分组
        elements.progressFill.style.width = '90%';
        elements.progressCurrent.textContent = '正在比对...';

        const groups = {};  // key -> [{ idx, name, ... }]
        const noKeyItems = []; // 无法提取信息的文件

        for (const fp of fingerprints) {
            if (!fp.key) {
                noKeyItems.push(fp);
                continue;
            }
            if (!groups[fp.key]) {
                groups[fp.key] = [];
            }
            groups[fp.key].push(fp);
        }

        // 提取重复组
        const dupGroups = [];
        for (const [key, items] of Object.entries(groups)) {
            if (items.length > 1) {
                dupGroups.push({ key, items });
            }
        }

        // 排序：重复数量多的在前
        dupGroups.sort((a, b) => b.items.length - a.items.length);

        // 统计
        const dupFileCount = dupGroups.reduce((sum, g) => sum + g.items.length, 0);

        // 计算非重复文件：不属于任何重复组的文件 + 每个重复组保留第一个
        const dupIdxSet = new Set();
        for (const group of dupGroups) {
            for (let i = 1; i < group.items.length; i++) {
                dupIdxSet.add(group.items[i].idx);
            }
        }
        // 无法提取的文件也不算非重复
        for (const item of noKeyItems) {
            dupIdxSet.add(item.idx);
        }

        state.uniqueFiles = state.files
            .filter((_, idx) => !dupIdxSet.has(idx))
            .map(item => item.file);

        // 完成
        elements.progressFill.style.width = '100%';
        elements.progressCurrent.textContent = '查重完成';

        await new Promise(r => setTimeout(r, 300));

        // 隐藏进度，显示结果
        elements.progressSection.style.display = 'none';
        elements.resultsSection.style.display = '';
        elements.resultsPlaceholder.style.display = 'none';
        elements.resultsPlaceholder.classList.remove('loading');
        elements.startBtn.disabled = false;
        state.isProcessing = false;

        // 渲染结果
        renderResults(total, dupGroups, dupFileCount, mode, noKeyItems);
    }

    /* ============ 结果渲染 ============ */

    function renderResults(total, dupGroups, dupFileCount, mode, noKeyItems) {
        elements.totalFiles.textContent = total;
        elements.dupGroups.textContent = dupGroups.length;
        elements.dupFiles.textContent = dupFileCount;

        // 下载按钮
        const hasUnique = state.uniqueFiles.length > 0;
        elements.downloadUniqueBtn.style.display = hasUnique ? '' : 'none';
        if (hasUnique) {
            elements.downloadUniqueBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                下载非重复发票 (${state.uniqueFiles.length}个)
            `;
        }

        if (dupGroups.length === 0 && noKeyItems.length === 0 && state.uniqueFiles.length === 0) {
            elements.noDupCard.style.display = '';
            elements.dupGroupsContainer.innerHTML = '';
            return;
        }

        elements.noDupCard.style.display = 'none';
        let html = '';

        // 重复组
        for (let gi = 0; gi < dupGroups.length; gi++) {
            const group = dupGroups[gi];
            const keyDisplay = mode === 'md5'
                ? `MD5: ${group.key}`
                : `发票号码: ${group.items[0].number || '-'}`;

            html += `
                <div class="dup-group">
                    <div class="dup-group-header">
                        <div class="dup-group-header-left">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                                <line x1="12" y1="9" x2="12" y2="13"></line>
                                <line x1="12" y1="17" x2="12.01" y2="17"></line>
                            </svg>
                            <span class="dup-group-title">重复组 ${gi + 1}</span>
                            <span class="dup-group-count">${group.items.length} 个文件</span>
                        </div>
                        <span class="dup-group-key">${keyDisplay}</span>
                    </div>
                    <div class="dup-group-body">`;

            for (let fi = 0; fi < group.items.length; fi++) {
                const item = group.items[fi];
                const isOriginal = fi === 0;
                html += `
                        <div class="dup-file ${isOriginal ? 'dup-file-original' : 'dup-file-duplicate'}">
                            <div class="dup-file-main">
                                <svg class="dup-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span class="dup-filename" title="${item.name}">${item.name}</span>
                                <span class="dup-tag ${isOriginal ? 'dup-tag-original' : 'dup-tag-duplicate'}">${isOriginal ? '原始' : '重复'}</span>
                            </div>
                        </div>`;
            }

            html += `
                    </div>
                </div>`;
        }

        // 无法提取信息的文件（仅发票号码模式）
        if (noKeyItems.length > 0 && mode === 'invoice') {
            html += `
                <div class="dup-group dup-group-warn">
                    <div class="dup-group-header">
                        <div class="dup-group-header-left">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"></circle>
                                <line x1="12" y1="8" x2="12" y2="12"></line>
                                <line x1="12" y1="16" x2="12.01" y2="16"></line>
                            </svg>
                            <span class="dup-group-title">无法提取发票信息</span>
                            <span class="dup-group-count">${noKeyItems.length} 个文件</span>
                        </div>
                    </div>
                    <div class="dup-group-body">`;

            for (const item of noKeyItems) {
                html += `
                        <div class="dup-file dup-file-warn">
                            <div class="dup-file-main">
                                <svg class="dup-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span class="dup-filename" title="${item.name}">${item.name}</span>
                            </div>
                        </div>`;
            }

            html += `
                    </div>
                </div>`;
        }

        // 非重复文件（在重复组下方显示）
        if (state.uniqueFiles.length > 0) {
            html += `
                <div class="dup-group dup-group-unique">
                    <div class="dup-group-header">
                        <div class="dup-group-header-left">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                            <span class="dup-group-title">非重复发票</span>
                            <span class="dup-group-count">${state.uniqueFiles.length} 个文件</span>
                        </div>
                    </div>
                    <div class="dup-group-body">`;

            for (const file of state.uniqueFiles) {
                html += `
                        <div class="dup-file dup-file-unique">
                            <div class="dup-file-main">
                                <svg class="dup-file-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                    <polyline points="14 2 14 8 20 8"></polyline>
                                </svg>
                                <span class="dup-filename" title="${file.name}">${file.name}</span>
                            </div>
                        </div>`;
            }

            html += `
                    </div>
                </div>`;
        }

        elements.dupGroupsContainer.innerHTML = html;
    }

    /* ============ 下载非重复发票 ============ */

    async function downloadUniqueFiles() {
        if (state.uniqueFiles.length === 0) {
            CommonUtils.showToast('没有可下载的文件', 'info');
            return;
        }

        if (state.uniqueFiles.length === 1) {
            // 单个文件直接下载
            const file = state.uniqueFiles[0];
            const link = document.createElement('a');
            link.href = URL.createObjectURL(file);
            link.download = file.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);
            return;
        }

        // 多个文件打包为 ZIP
        if (typeof JSZip === 'undefined') {
            CommonUtils.showToast('ZIP库未加载，尝试逐个下载...', 'info');
            for (const file of state.uniqueFiles) {
                const link = document.createElement('a');
                link.href = URL.createObjectURL(file);
                link.download = file.name;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(link.href);
            }
            return;
        }

        CommonUtils.showToast('正在打包文件...', 'success');

        try {
            const zip = new JSZip();

            state.uniqueFiles.forEach(file => {
                zip.file(file.name, file);
            });

            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `非重复发票_${new Date().getTime()}.zip`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(link.href);

            CommonUtils.showToast(`已下载 ${state.uniqueFiles.length} 个非重复发票`, 'success');
        } catch (error) {
            CommonUtils.showToast('打包失败: ' + error.message, 'error');
        }
    }

    /* ============ 清空 ============ */

    function clearAll() {
        state.files = [];
        state.results = [];
        state.uniqueFiles = [];
        state.isProcessing = false;
        elements.fileInput.value = '';
        elements.progressSection.style.display = 'none';
        elements.resultsSection.style.display = 'none';
        elements.resultsPlaceholder.style.display = '';
        elements.resultsPlaceholder.classList.remove('loading');
        elements.settingsSection.style.display = 'none';
        elements.startBtn.disabled = false;
        updateFileList();
        CommonUtils.showToast('已清空', 'success');
    }

    /* ============ 拖拽上传 ============ */

    function initDragDrop() {
        const area = elements.uploadArea;
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(e => {
            area.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); });
            document.body.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); });
        });
        ['dragenter', 'dragover'].forEach(e => {
            area.addEventListener(e, () => area.classList.add('dragover'));
        });
        ['dragleave', 'drop'].forEach(e => {
            area.addEventListener(e, () => area.classList.remove('dragover'));
        });
        area.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    }

    /* ============ 事件绑定 ============ */

    function initEvents() {
        elements.fileInput.addEventListener('change', e => handleFiles(e.target.files));
        elements.uploadArea.addEventListener('click', () => elements.fileInput.click());
        elements.addMoreBtn.addEventListener('click', () => elements.fileInput.click());
        elements.clearBtn.addEventListener('click', clearAll);
        elements.startBtn.addEventListener('click', startDedup);
        elements.downloadUniqueBtn.addEventListener('click', downloadUniqueFiles);
    }

    /* ============ 初始化 ============ */

    function init() {
        InvoiceExtractor.init();
        initEvents();
        initDragDrop();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
