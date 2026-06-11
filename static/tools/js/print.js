/**
 * 发票合并打印工具
 * 核心功能：多张发票 N-up 合并排版到 A4，预览、打印、导出 PDF
 * 依赖: CommonUtils (common.js), pdf.js, jsPDF
 */
(function() {
    'use strict';

    // PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://s4.zstatic.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    // A4 尺寸 (pt, 1pt = 1/72 inch)
    const A4_PORTRAIT  = { width: 595.28, height: 841.89 };
    const A4_LANDSCAPE = { width: 841.89, height: 595.28 };

    // 边距映射 (pt)
    const MARGIN_MAP = { none: 0, small: 14.17, normal: 28.35, large: 56.69 };
    // 间距映射 (pt) - 也用作分割线两侧留白
    const GAP_MAP = { none: 0, small: 8.5, normal: 14.17, large: 28.35 };

    // 状态
    let invoiceItems = [];   // { file, pdfDoc, renderedPages: [canvas], name, ext }
    let mergedPages = [];    // 合并后的每页 canvas 数组
    let currentPreviewPage = 1;

    // DOM
    const el = {
        fileInput:       document.getElementById('fileInput'),
        uploadArea:      document.getElementById('uploadArea'),
        fileListSection: document.getElementById('fileListSection'),
        emptyState:      document.getElementById('emptyState'),
        fileItems:       document.getElementById('fileItems'),
        fileCount:       document.getElementById('fileCount'),
        clearBtn:        document.getElementById('clearBtn'),
        marginSize:      document.getElementById('marginSize'),
        gapSize:         document.getElementById('gapSize'),
        showDivider:     document.getElementById('showDivider'),
        previewCard:     document.getElementById('previewCard'),
        previewCanvas:   document.getElementById('previewCanvas'),
        previewCanvasArea: document.getElementById('previewCanvasArea'),
        previewStats:    document.getElementById('previewStats'),
        pageInfo:        document.getElementById('pageInfo'),
        prevPageBtn:     document.getElementById('prevPageBtn'),
        nextPageBtn:     document.getElementById('nextPageBtn'),
        actionButtons:   document.getElementById('actionButtons'),
        previewEmptyState: document.getElementById('previewEmptyState'),
        exportPdfBtn:    document.getElementById('exportPdfBtn'),
        printBtn:        document.getElementById('printBtn'),
        printContainer:  document.getElementById('printContainer'),
        toast:           document.getElementById('toast'),
        toastMessage:    document.getElementById('toastMessage')
    };

    /* ============ 工具函数 ============ */

    function getExt(name) {
        const p = name.split('.');
        return p.length > 1 ? p.pop().toLowerCase() : '';
    }

    function getPerPage() {
        const checked = document.querySelector('input[name="perPage"]:checked');
        return checked ? parseInt(checked.value) : 1;
    }

    function getPageSize() {
        // 每页4张用横向A4，其余用纵向
        const perPage = getPerPage();
        return perPage === 4 ? A4_LANDSCAPE : A4_PORTRAIT;
    }

    function getMargin() { return MARGIN_MAP[el.marginSize.value] || 28.35; }
    function getGap()    { return GAP_MAP[el.gapSize.value] || 14.17; }

    /* ============ 文件上传 ============ */

    async function handleFiles(files) {
        const arr = Array.from(files);
        if (!arr.length) return;

        for (const file of arr) {
            const ext = getExt(file.name);
            const item = { file, pdfDoc: null, renderedPages: [], name: file.name, ext };

            if (ext === 'pdf') {
                try {
                    const buf = await file.arrayBuffer();
                    item.pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
                } catch (e) {
                    console.error('PDF 加载失败:', file.name, e);
                    CommonUtils.showToast(`加载失败: ${file.name}`, 'error');
                    continue;
                }
            }
            invoiceItems.push(item);
        }

        // 异步渲染所有页面（不阻塞 UI）
        renderAllInvoicePages().then(() => {
            updateFileList();
            rebuildMergedPreview();
        });

        CommonUtils.showToast(`已添加 ${arr.length} 个文件`, 'success');
        // 先立即更新列表显示
        updateFileList();
        el.emptyState.style.display = 'none';
    }

    /**
     * 渲染所有发票的每一页到 canvas 缓存
     */
    async function renderAllInvoicePages() {
        for (const item of invoiceItems) {
            if (item.renderedPages.length > 0) continue; // 已渲染过

            if (item.ext === 'pdf' && item.pdfDoc) {
                for (let p = 1; p <= item.pdfDoc.numPages; p++) {
                    const page = await item.pdfDoc.getPage(p);
                    // 用 2x 渲染以获得清晰效果
                    const vp = page.getViewport({ scale: 2 });
                    const canvas = document.createElement('canvas');
                    canvas.width = vp.width;
                    canvas.height = vp.height;
                    const ctx = canvas.getContext('2d');
                    await page.render({ canvasContext: ctx, viewport: vp }).promise;
                    item.renderedPages.push(canvas);
                }
            } else if (['png', 'jpg', 'jpeg'].includes(item.ext)) {
                const canvas = await renderImageToCanvas(item.file);
                if (canvas) item.renderedPages.push(canvas);
            }
        }
    }

    function renderImageToCanvas(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                resolve(canvas);
            };
            img.onerror = () => resolve(null);
            img.src = URL.createObjectURL(file);
        });
    }

    /* ============ 文件列表 ============ */

    function updateFileList() {
        el.fileItems.innerHTML = '';
        el.fileCount.textContent = invoiceItems.length;

        if (invoiceItems.length === 0) {
            el.fileListSection.style.display = 'none';
            el.emptyState.style.display = 'block';
            return;
        }

        el.fileListSection.style.display = 'block';
        el.emptyState.style.display = 'none';

        invoiceItems.forEach((item, idx) => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.draggable = true;
            li.dataset.index = idx;
            li.innerHTML = `
                <span class="file-item-drag">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                </span>
                <svg class="file-item-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
                <span class="file-item-name" title="${item.name}">${item.name}</span>
                <span class="file-item-ext">${item.ext}</span>
                <button class="file-item-remove" data-index="${idx}" title="移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            `;
            el.fileItems.appendChild(li);
        });

        // 删除按钮
        el.fileItems.querySelectorAll('.file-item-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.index);
                invoiceItems.splice(idx, 1);
                updateFileList();
                rebuildMergedPreview();
            });
        });

        // 拖拽排序
        initDragSort();
    }

    /* ============ 拖拽排序 ============ */

    let dragIdx = -1;

    function initDragSort() {
        const items = el.fileItems.querySelectorAll('.file-item');
        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                dragIdx = parseInt(item.dataset.index);
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                // 延迟添加，避免拖拽镜像也变透明
                requestAnimationFrame(() => {
                    item.classList.add('dragging-fade');
                });
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dragging', 'dragging-fade');
                dragIdx = -1;
                clearDragIndicators();
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const dropIdx = parseInt(item.dataset.index);
                if (dragIdx === -1 || dragIdx === dropIdx) return;
                // 计算鼠标在目标元素的上半还是下半
                const rect = item.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const isAbove = e.clientY < midY;
                // 清除所有指示器
                clearDragIndicators();
                // 添加指示器
                if (isAbove) {
                    item.classList.add('drop-above');
                } else {
                    item.classList.add('drop-below');
                }
            });
            item.addEventListener('dragleave', () => {
                item.classList.remove('drop-above', 'drop-below');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                const dropIdx = parseInt(item.dataset.index);
                if (dragIdx !== -1 && dragIdx !== dropIdx) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    const isAbove = e.clientY < midY;
                    const [moved] = invoiceItems.splice(dragIdx, 1);
                    // 根据拖放位置计算插入索引
                    let insertIdx = dropIdx;
                    if (dragIdx < dropIdx) insertIdx--;
                    if (!isAbove) insertIdx++;
                    invoiceItems.splice(insertIdx, 0, moved);
                    updateFileList();
                    rebuildMergedPreview();
                }
                clearDragIndicators();
            });
        });
    }

    function clearDragIndicators() {
        el.fileItems.querySelectorAll('.drop-above, .drop-below').forEach(el => {
            el.classList.remove('drop-above', 'drop-below');
        });
    }

    /* ============ 合并排版核心 ============ */

    /**
     * 计算每页中每个发票的布局位置
     * @param {number} perPage - 每页张数 (2/3/4)
     * @param {object} pageSize - { width, height } in pt
     * @param {number} margin - 页边距 pt
     * @param {number} gap - 间距 pt
     * @returns {Array} 每页的 cells 数组，每个 cell: { x, y, w, h }
     */
    function calcLayout(perPage, pageSize, margin, gap) {
        const contentW = pageSize.width - margin * 2;
        const contentH = pageSize.height - margin * 2;

        if (perPage === 1) {
            // 默认：整页一张，不分割
            return [
                { x: margin, y: margin, w: contentW, h: contentH }
            ];
        }
        if (perPage === 2) {
            // 纵向：上下各一张，中间水平分割线
            const cellW = contentW;
            const cellH = (contentH - gap) / 2;
            return [
                { x: margin, y: margin, w: cellW, h: cellH },
                { x: margin, y: margin + cellH + gap, w: cellW, h: cellH }
            ];
        }
        if (perPage === 3) {
            // 纵向：3行等分，两条水平分割线
            const cellW = contentW;
            const cellH = (contentH - gap * 2) / 3;
            return [
                { x: margin, y: margin, w: cellW, h: cellH },
                { x: margin, y: margin + cellH + gap, w: cellW, h: cellH },
                { x: margin, y: margin + (cellH + gap) * 2, w: cellW, h: cellH }
            ];
        }
        // 4: 横向A4，2x2均衡排列，十字分割线
        const cellW = (contentW - gap) / 2;
        const cellH = (contentH - gap) / 2;
        return [
            { x: margin, y: margin, w: cellW, h: cellH },
            { x: margin + cellW + gap, y: margin, w: cellW, h: cellH },
            { x: margin, y: margin + cellH + gap, w: cellW, h: cellH },
            { x: margin + cellW + gap, y: margin + cellH + gap, w: cellW, h: cellH }
        ];
    }

    /**
     * 将发票页面绘制到指定 cell（等比缩放居中）
     */
    function drawCell(ctx, srcCanvas, cell) {
        const srcW = srcCanvas.width;
        const srcH = srcCanvas.height;
        const ratio = Math.min(cell.w / srcW, cell.h / srcH);
        const drawW = srcW * ratio;
        const drawH = srcH * ratio;
        const offsetX = cell.x + (cell.w - drawW) / 2;
        const offsetY = cell.y + (cell.h - drawH) / 2;

        ctx.drawImage(srcCanvas, offsetX, offsetY, drawW, drawH);
    }

    /**
     * 绘制分割线（在相邻 cell 之间画线）
     * @param {number} perPage - 每页排版数 (2/3/4)，决定布局结构
     * @param {number} actualCount - 该页实际发票数量
     * @param {Array} cells - 该页的 cells 数组
     * @param {object} pageSize - 页面尺寸
     * @param {number} margin - 页边距
     */
    function drawDividers(ctx, perPage, actualCount, cells, pageSize, margin) {
        ctx.strokeStyle = '#d1d5db';
        ctx.lineWidth = 0.75;

        if (perPage === 1) {
            // 默认模式不画分割线
            return;
        }
        if (perPage === 2) {
            // 1列2行：1张以上时画中间水平线
            if (actualCount >= 2) {
                const y = (cells[0].y + cells[0].h + cells[1].y) / 2;
                ctx.beginPath();
                ctx.moveTo(margin, y);
                ctx.lineTo(pageSize.width - margin, y);
                ctx.stroke();
            }
        } else if (perPage === 3) {
            // 1列3行：按实际数量画水平线
            if (actualCount >= 2) {
                const y1 = (cells[0].y + cells[0].h + cells[1].y) / 2;
                ctx.beginPath();
                ctx.moveTo(margin, y1);
                ctx.lineTo(pageSize.width - margin, y1);
                ctx.stroke();
            }
            if (actualCount >= 3) {
                const y2 = (cells[1].y + cells[1].h + cells[2].y) / 2;
                ctx.beginPath();
                ctx.moveTo(margin, y2);
                ctx.lineTo(pageSize.width - margin, y2);
                ctx.stroke();
            }
        } else if (perPage === 4) {
            // 2列2行：按行列是否有内容决定画线
            // 右列有内容(>=2)时画垂直线
            // 下行有内容(>=3)时画水平线
            const midX = (cells[0].x + cells[0].w + cells[1].x) / 2;
            const midY = (cells[0].y + cells[0].h + cells[2].y) / 2;

            ctx.beginPath();
            if (actualCount >= 2) {
                // 垂直线：左右两列都有内容
                ctx.moveTo(midX, margin);
                ctx.lineTo(midX, pageSize.height - margin);
            }
            if (actualCount >= 3) {
                // 水平线：上下两行都有内容
                ctx.moveTo(margin, midY);
                ctx.lineTo(pageSize.width - margin, midY);
            }
            ctx.stroke();
        }
    }

    /**
     * 重建合并预览
     */
    async function rebuildMergedPreview() {
        // 确保所有页面都已渲染
        await renderAllInvoicePages();

        // 收集所有发票页面
        const allPages = [];
        for (const item of invoiceItems) {
            for (const c of item.renderedPages) {
                allPages.push(c);
            }
        }

        if (allPages.length === 0) {
            el.previewCard.style.display = 'none';
            el.actionButtons.style.display = 'none';
            el.previewEmptyState.style.display = 'block';
            mergedPages = [];
            return;
        }

        const perPage = getPerPage();
        const pageSize = getPageSize();
        const margin = getMargin();
        const gap = getGap();
        const showDivider = el.showDivider.checked;
        const cells = calcLayout(perPage, pageSize, margin, gap);

        // 用 2 倍渲染以获得清晰预览
        const scale = 2;
        mergedPages = [];

        const totalPages = Math.ceil(allPages.length / perPage);

        for (let p = 0; p < totalPages; p++) {
            const canvas = document.createElement('canvas');
            canvas.width = pageSize.width * scale;
            canvas.height = pageSize.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.scale(scale, scale);

            // 白色背景
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, pageSize.width, pageSize.height);

            for (let c = 0; c < cells.length; c++) {
                const pageIdx = p * perPage + c;
                if (pageIdx >= allPages.length) break;
                drawCell(ctx, allPages[pageIdx], cells[c]);
            }

            // 绘制分割线（仅在实际填入的发票数量 > 1 时才画）
            if (showDivider) {
                const actualCount = Math.min(perPage, allPages.length - p * perPage);
                if (actualCount > 1) {
                    drawDividers(ctx, perPage, actualCount, cells, pageSize, margin);
                }
            }

            mergedPages.push(canvas);
        }

        // 显示预览
        currentPreviewPage = 1;
        el.previewCard.style.display = 'block';
        el.actionButtons.style.display = 'flex';
        el.previewEmptyState.style.display = 'none';
        renderCurrentPreview();

        el.previewStats.textContent = perPage === 1
            ? `共 ${allPages.length} 张发票，每页1张（原始尺寸）`
            : `共 ${allPages.length} 张发票，合并为 ${totalPages} 页 A4`;
    }

    function renderCurrentPreview() {
        if (mergedPages.length === 0) return;

        const src = mergedPages[currentPreviewPage - 1];
        const displayCanvas = el.previewCanvas;

        // 缩放到预览区域宽度
        const maxW = el.previewCanvasArea.clientWidth - 24;
        const ratio = Math.min(maxW / src.width, 600 / src.height, 1);
        displayCanvas.width = src.width * ratio;
        displayCanvas.height = src.height * ratio;

        const ctx = displayCanvas.getContext('2d');
        ctx.drawImage(src, 0, 0, displayCanvas.width, displayCanvas.height);

        el.pageInfo.textContent = `${currentPreviewPage} / ${mergedPages.length}`;
        el.prevPageBtn.disabled = currentPreviewPage <= 1;
        el.nextPageBtn.disabled = currentPreviewPage >= mergedPages.length;
    }

    /* ============ 导出 PDF ============ */

    async function exportPdf() {
        if (mergedPages.length === 0) {
            CommonUtils.showToast('没有可导出的内容', 'error');
            return;
        }

        CommonUtils.showToast('正在生成 PDF...', 'success');

        const { jsPDF } = window.jspdf;
        const pageSize = getPageSize();
        const isLandscape = pageSize.width > pageSize.height;
        const pdf = new jsPDF({
            orientation: isLandscape ? 'l' : 'p',
            unit: 'pt',
            format: 'a4'
        });

        for (let i = 0; i < mergedPages.length; i++) {
            if (i > 0) pdf.addPage();

            const canvas = mergedPages[i];
            const imgData = canvas.toDataURL('image/jpeg', 0.92);
            pdf.addImage(imgData, 'JPEG', 0, 0, pageSize.width, pageSize.height);
        }

        pdf.save('发票合并打印.pdf');
        CommonUtils.showToast('PDF 导出成功', 'success');
    }

    /* ============ 打印 ============ */

    async function printMerged() {
        if (mergedPages.length === 0) {
            CommonUtils.showToast('没有可打印的内容', 'error');
            return;
        }

        const container = el.printContainer;
        container.innerHTML = '';
        container.style.display = 'block';

        const pageSize = getPageSize();
        const margin = getMargin();
        const isLandscape = pageSize.width > pageSize.height;

        // 动态打印样式
        let style = document.getElementById('dynamic-print-style');
        if (!style) {
            style = document.createElement('style');
            style.id = 'dynamic-print-style';
            document.head.appendChild(style);
        }

        const marginMM = (margin / 72 * 25.4).toFixed(1);
        style.textContent = `
            @media print {
                @page { size: A4 ${isLandscape ? 'landscape' : 'portrait'}; margin: ${marginMM}mm; }
                body > *:not(#printContainer) { display: none !important; }
                #printContainer { display: block !important; }
                .print-page { page-break-after: always; width: 100%; height: 100vh; display: flex; align-items: center; justify-content: center; }
                .print-page:last-child { page-break-after: auto; }
                .print-page img { max-width: 100%; max-height: 100%; object-fit: contain; }
            }
        `;

        // 创建所有图片并等待加载完成
        const loadPromises = [];
        for (const canvas of mergedPages) {
            const div = document.createElement('div');
            div.className = 'print-page';
            const img = document.createElement('img');
            img.src = canvas.toDataURL('image/png');
            const loadP = new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
            });
            loadPromises.push(loadP);
            div.appendChild(img);
            container.appendChild(div);
        }

        // 等待所有图片加载完毕再打印
        await Promise.all(loadPromises);

        // 短暂延迟确保渲染完成
        await new Promise(r => setTimeout(r, 100));
        window.print();

        setTimeout(() => {
            container.innerHTML = '';
            container.style.display = 'none';
        }, 1000);
    }

    /* ============ 清空 ============ */

    function clearAll() {
        invoiceItems = [];
        mergedPages = [];
        currentPreviewPage = 1;
        el.fileInput.value = '';
        el.previewCard.style.display = 'none';
        el.actionButtons.style.display = 'none';
        el.previewEmptyState.style.display = 'block';
        updateFileList();
        CommonUtils.showToast('已清空', 'success');
    }

    /* ============ 拖拽上传 ============ */

    function initDragDrop() {
        const area = el.uploadArea;
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

    /* ============ UI 辅助 ============ */

    function updateDividerVisibility() {
        const perPage = getPerPage();
        const isSingle = perPage === 1;
        const dividerRow = el.showDivider.closest('.setting-row');
        if (dividerRow) {
            dividerRow.style.display = isSingle ? 'none' : '';
        }
        const gapRow = el.gapSize.closest('.setting-row');
        if (gapRow) {
            gapRow.style.display = isSingle ? 'none' : '';
        }
    }

    /* ============ 事件绑定 ============ */

    function initEvents() {
        el.fileInput.addEventListener('change', e => handleFiles(e.target.files));
        el.uploadArea.addEventListener('click', () => el.fileInput.click());
        el.clearBtn.addEventListener('click', clearAll);

        // 设置变更时自动重建预览
        document.querySelectorAll('input[name="perPage"]').forEach(r => {
            r.addEventListener('change', () => {
                updateDividerVisibility();
                rebuildMergedPreview();
            });
        });
        el.marginSize.addEventListener('change', () => rebuildMergedPreview());
        el.gapSize.addEventListener('change', () => rebuildMergedPreview());
        el.showDivider.addEventListener('change', () => rebuildMergedPreview());

        // 预览翻页
        el.prevPageBtn.addEventListener('click', () => {
            if (currentPreviewPage > 1) { currentPreviewPage--; renderCurrentPreview(); }
        });
        el.nextPageBtn.addEventListener('click', () => {
            if (currentPreviewPage < mergedPages.length) { currentPreviewPage++; renderCurrentPreview(); }
        });

        // 导出和打印
        el.exportPdfBtn.addEventListener('click', exportPdf);
        el.printBtn.addEventListener('click', printMerged);
    }

    /* ============ 初始化 ============ */

    function init() {
        initEvents();
        initDragDrop();
        updateDividerVisibility();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
