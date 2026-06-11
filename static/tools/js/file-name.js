/**
 * 文件名提取工具
 * 依赖: CommonUtils (common.js)
 */
(function() {
    'use strict';

    // 状态管理
    let uploadedFiles = [];
    let extractedNames = [];

    // DOM 元素
    const elements = {
        fileInput: document.getElementById('fileInput'),
        uploadArea: document.getElementById('uploadArea'),
        uploadSection: document.getElementById('uploadSection'),
        resultsSection: document.getElementById('resultsSection'),
        emptyState: document.getElementById('emptyState'),
        resultsBody: document.getElementById('resultsBody'),
        totalFiles: document.getElementById('totalFiles'),
        uniqueNames: document.getElementById('uniqueNames'),
        copyBtn: document.getElementById('copyBtn'),
        downloadTxtBtn: document.getElementById('downloadTxtBtn'),
        downloadExcelBtn: document.getElementById('downloadExcelBtn'),
        clearBtn: document.getElementById('clearBtn'),
        settingsBtn: document.getElementById('settingsBtn'),
        settingsModal: document.getElementById('settingsModal'),
        modalOverlay: document.getElementById('modalOverlay'),
        modalClose: document.getElementById('modalClose'),
        modalCancel: document.getElementById('modalCancel'),
        modalConfirm: document.getElementById('modalConfirm'),
        removeExtension: document.getElementById('removeExtension'),
        removeDuplicates: document.getElementById('removeDuplicates'),
        sortNames: document.getElementById('sortNames'),
        toast: document.getElementById('toast'),
        toastMessage: document.getElementById('toastMessage')
    };

    /**
     * 获取文件扩展名
     */
    function getFileExtension(filename) {
        const parts = filename.split('.');
        return parts.length > 1 ? parts.pop().toLowerCase() : '';
    }

    /**
     * 提取文件名（可选移除扩展名）
     */
    function extractFileName(filename, removeExtension) {
        if (removeExtension) {
            const lastDotIndex = filename.lastIndexOf('.');
            return lastDotIndex > 0 ? filename.substring(0, lastDotIndex) : filename;
        }
        return filename;
    }

    /**
     * 打开模态框
     */
    function openModal() {
        elements.settingsModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    /**
     * 关闭模态框
     */
    function closeModal() {
        elements.settingsModal.classList.remove('show');
        document.body.style.overflow = '';
    }

    /**
     * 处理文件上传
     */
    function handleFiles(files) {
        const fileArray = Array.from(files);
        if (fileArray.length === 0) return;

        uploadedFiles = [...uploadedFiles, ...fileArray];
        
        extractFileNames();
        updateEmptyState();
        
        CommonUtils.showToast(`已添加 ${fileArray.length} 个文件`, 'success');
    }

    /**
     * 提取文件名
     */
    function extractFileNames() {
        if (uploadedFiles.length === 0) {
            CommonUtils.showToast('请先上传文件', 'error');
            return;
        }

        const removeExt = elements.removeExtension.checked;
        const removeDup = elements.removeDuplicates.checked;
        const sort = elements.sortNames.checked;

        // 提取文件名
        let results = uploadedFiles.map((file, index) => {
            const extractedName = extractFileName(file.name, removeExt);
            return {
                index: index + 1,
                extractedName: extractedName,
                extension: getFileExtension(file.name),
                size: file.size
            };
        });

        // 排序
        if (sort) {
            results.sort((a, b) => a.extractedName.localeCompare(b.extractedName, 'zh-CN'));
            results.forEach((item, index) => {
                item.index = index + 1;
            });
        }

        // 去重
        if (removeDup) {
            const seen = new Set();
            results = results.filter(item => {
                if (seen.has(item.extractedName)) {
                    return false;
                }
                seen.add(item.extractedName);
                return true;
            });
            results.forEach((item, index) => {
                item.index = index + 1;
            });
        }

        extractedNames = results;

        // 更新统计信息
        elements.totalFiles.textContent = uploadedFiles.length;
        elements.uniqueNames.textContent = results.length;

        // 渲染表格
        renderResults(results);

        // 显示结果区域
        elements.resultsSection.style.display = 'block';
        elements.copyBtn.disabled = false;
        elements.downloadTxtBtn.disabled = false;
        elements.downloadExcelBtn.disabled = false;

        CommonUtils.showToast(`成功提取 ${results.length} 个文件名`, 'success');
    }

    /**
     * 渲染结果表格
     */
    function renderResults(results) {
        elements.resultsBody.innerHTML = '';

        results.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.index}</td>
                <td class="extracted-name">${item.extractedName}</td>
                <td>
                    ${item.extension ? `<span class="file-extension">${item.extension}</span>` : '-'}
                </td>
                <td class="file-size">${CommonUtils.formatFileSize(item.size)}</td>
                <td>
                    <button class="delete-btn" data-index="${index}" aria-label="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                    </button>
                </td>
            `;
            elements.resultsBody.appendChild(tr);
        });

        // 添加删除按钮事件监听
        elements.resultsBody.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.currentTarget.getAttribute('data-index'));
                deleteItem(index);
            });
        });
    }

    /**
     * 删除单条记录
     */
    function deleteItem(index) {
        extractedNames.splice(index, 1);
        uploadedFiles.splice(index, 1);
        
        extractedNames.forEach((item, idx) => {
            item.index = idx + 1;
        });
        
        elements.totalFiles.textContent = uploadedFiles.length;
        elements.uniqueNames.textContent = extractedNames.length;
        
        renderResults(extractedNames);
        
        if (extractedNames.length === 0) {
            elements.resultsSection.style.display = 'none';
            elements.copyBtn.disabled = true;
            elements.downloadTxtBtn.disabled = true;
            elements.downloadExcelBtn.disabled = true;
        }
        
        CommonUtils.showToast('已删除该条记录', 'success');
    }

    /**
     * 一键复制文件名
     */
    async function copyToClipboard() {
        if (extractedNames.length === 0) {
            CommonUtils.showToast('没有可复制的文件名', 'error');
            return;
        }

        const content = extractedNames.map(item => item.extractedName).join('\n');

        try {
            await navigator.clipboard.writeText(content);
            CommonUtils.showToast(`已复制 ${extractedNames.length} 个文件名`, 'success');
        } catch (err) {
            // 降级方案：使用传统方式复制
            const textarea = document.createElement('textarea');
            textarea.value = content;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                CommonUtils.showToast(`已复制 ${extractedNames.length} 个文件名`, 'success');
            } catch (err) {
                CommonUtils.showToast('复制失败，请手动复制', 'error');
            }
            document.body.removeChild(textarea);
        }
    }

    /**
     * 下载 TXT 文件
     */
    function downloadTxt() {
        if (extractedNames.length === 0) {
            CommonUtils.showToast('没有可导出的文件名', 'error');
            return;
        }

        const content = extractedNames.map(item => item.extractedName).join('\n');
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = '文件名列表.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);

        CommonUtils.showToast('TXT 文件下载成功', 'success');
    }

    /**
     * 下载 Excel 文件
     */
    function downloadExcel() {
        if (extractedNames.length === 0) {
            CommonUtils.showToast('没有可导出的文件名', 'error');
            return;
        }

        if (typeof XLSX === 'undefined') {
            CommonUtils.showToast('Excel 库未加载', 'error');
            return;
        }

        // 准备数据
        const headers = ['序号', '文件名', '文件类型', '文件大小'];
        const rows = extractedNames.map(item => [
            item.index,
            item.extractedName,
            item.extension || '-',
            CommonUtils.formatFileSize(item.size)
        ]);

        // 创建工作簿
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

        // 设置列宽
        ws['!cols'] = [
            { wch: 8 },
            { wch: 40 },
            { wch: 12 },
            { wch: 12 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, '文件名列表');
        XLSX.writeFile(wb, '文件名列表.xlsx');

        CommonUtils.showToast('Excel 文件下载成功', 'success');
    }

    /**
     * 清空列表
     */
    function clearAll() {
        uploadedFiles = [];
        extractedNames = [];
        elements.fileInput.value = '';
        elements.copyBtn.disabled = true;
        elements.downloadTxtBtn.disabled = true;
        elements.downloadExcelBtn.disabled = true;
        elements.resultsSection.style.display = 'none';
        updateEmptyState();
        CommonUtils.showToast('已清空列表', 'success');
    }

    /**
     * 更新空状态显示
     */
    function updateEmptyState() {
        if (uploadedFiles.length === 0) {
            elements.emptyState.style.display = 'block';
        } else {
            elements.emptyState.style.display = 'none';
        }
    }

    /**
     * 初始化拖拽上传
     */
    function initDragDrop() {
        const uploadArea = elements.uploadArea;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, preventDefaults, false);
            document.body.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.add('dragover');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => {
                uploadArea.classList.remove('dragover');
            }, false);
        });

        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            handleFiles(files);
        }, false);
    }

    /**
     * 初始化事件监听
     */
    function initEventListeners() {
        elements.fileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        elements.uploadArea.addEventListener('click', () => {
            elements.fileInput.click();
        });

        elements.settingsBtn.addEventListener('click', openModal);

        elements.modalClose.addEventListener('click', closeModal);
        elements.modalCancel.addEventListener('click', closeModal);
        elements.modalOverlay.addEventListener('click', closeModal);

        elements.modalConfirm.addEventListener('click', () => {
            closeModal();
            if (uploadedFiles.length > 0) {
                extractFileNames();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && elements.settingsModal.classList.contains('show')) {
                closeModal();
            }
        });

        elements.copyBtn.addEventListener('click', copyToClipboard);

        elements.downloadTxtBtn.addEventListener('click', downloadTxt);
        elements.downloadExcelBtn.addEventListener('click', downloadExcel);

        elements.clearBtn.addEventListener('click', clearAll);
    }

    /**
     * 初始化
     */
    function init() {
        initEventListeners();
        initDragDrop();
        updateEmptyState();
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
