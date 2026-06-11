/**
 * 发票解析调试工具
 * 依赖: InvoiceExtractor (common.js)
 */
(function() {
    'use strict';

    // ========== 状态 ==========
    let state = {
        rawItems: [],       // 原始 textItems
        mergedItems: [],    // mergeAdjacentChars 后
        invoiceKind: '',    // 检测类型
        parseResult: null,  // 解析结果
        fileName: '',
        canvasMode: 'raw',  // raw | merged
        logs: []
    };

    // ========== 日志 ==========
    function addLog(msg, level = 'info') {
        const ts = new Date().toLocaleTimeString();
        state.logs.push({ ts, msg, level });
        const el = document.getElementById('debugLog');
        if (el) {
            const cls = level === 'warn' ? 'log-warn' : level === 'error' ? 'log-error' : level === 'success' ? 'log-success' : '';
            el.innerHTML += `<span class="${cls}">[${ts}] ${escapeH(msg)}</span>\n`;
            el.scrollTop = el.scrollHeight;
        }
    }
    window.clearLog = function() {
        state.logs = [];
        document.getElementById('debugLog').innerHTML = '';
    };
    window.exportLog = function() {
        const text = state.logs.map(l => `[${l.ts}][${l.level}] ${l.msg}`).join('\n');
        downloadText('debug-log.txt', text);
    };

    // ========== 工具 ==========
    function escapeH(s) {
        if (!s) return '';
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function downloadText(filename, text) {
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    // ========== 面板折叠 ==========
    window.togglePanel = function(bodyId) {
        const el = document.getElementById(bodyId);
        if (el) el.classList.toggle('collapsed');
    };

    // ========== 文件上传 ==========
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    uploadArea.addEventListener('click', () => fileInput.click());
    uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
    uploadArea.addEventListener('dragleave', e => { e.preventDefault(); uploadArea.classList.remove('dragover'); });
    uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files[0]) loadPDF(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) loadPDF(e.target.files[0]); });

    async function loadPDF(file) {
        if (file.type !== 'application/pdf') {
            CommonUtils.showToast('请上传 PDF 文件', 'error');
            return;
        }

        state.fileName = file.name;
        addLog(`加载文件: ${file.name} (${CommonUtils.formatFileSize(file.size)})`);

        // 显示文件信息
        const infoBar = document.getElementById('fileInfoBar');
        infoBar.style.display = 'flex';
        infoBar.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <strong>${escapeH(file.name)}</strong>
            <span style="color:var(--color-text-secondary)">${CommonUtils.formatFileSize(file.size)}</span>
        `;

        try {
            const arrayBuffer = await file.arrayBuffer();
            await debugParse(arrayBuffer, file.name, file.size);
        } catch (err) {
            addLog(`加载失败: ${err.message}`, 'error');
            CommonUtils.showToast('PDF 解析失败: ' + err.message, 'error');
        }
    }

    async function debugParse(arrayBuffer, fileName, fileSize) {
        // 检查 InvoiceExtractor 是否有 _debug 接口
        if (!InvoiceExtractor._debug) {
            addLog('InvoiceExtractor._debug 不可用，请确认 common.js 已更新', 'error');
            CommonUtils.showToast('调试接口不可用，请更新 common.js', 'error');
            return;
        }

        const debug = InvoiceExtractor._debug;

        // 1. 解析 PDF 获取原始文本项
        addLog('步骤1: 解析 PDF 文本内容...');
        let rawItems;
        try {
            rawItems = await debug.extractRawItems(arrayBuffer);
            state.rawItems = rawItems;
            addLog(`提取到 ${rawItems.length} 个原始文本项`, 'success');
        } catch (err) {
            addLog(`PDF 解析失败: ${err.message}`, 'error');
            return;
        }

        // 2. 合并
        addLog('步骤2: 执行 mergeAdjacentChars...');
        const mergedItems = debug.mergeAdjacentChars(rawItems);
        state.mergedItems = mergedItems;
        addLog(`合并后 ${mergedItems.length} 个文本项 (减少 ${rawItems.length - mergedItems.length})`, 'success');

        // 3. 类型检测
        addLog('步骤3: 检测发票类型...');
        const kind = debug.detectInvoiceType(mergedItems);
        state.invoiceKind = kind;
        addLog(`检测结果: ${kind === 'railway' ? '铁路电子客票' : '增值税发票'}`, 'info');

        // 4. 解析（仅增值税发票）
        addLog('步骤4: 使用 parseInvoiceCoords 解析...');
        let result;
        try {
            result = debug.parseInvoiceCoords(mergedItems);
            state.parseResult = result;
            addLog('解析完成', 'success');
        } catch (err) {
            addLog(`解析失败: ${err.message}`, 'error');
            state.parseResult = { error: err.message };
        }

        // 渲染所有面板
        renderDetectPanel();
        renderItemsTable('raw');
        renderItemsTable('merged');
        renderCanvas();
        renderResultPanel();

        // 显示面板
        document.getElementById('detectPanel').style.display = '';
        document.getElementById('rawPanel').style.display = '';
        document.getElementById('mergedPanel').style.display = '';
        document.getElementById('canvasPanel').style.display = '';
        document.getElementById('resultPanel').style.display = '';
        document.getElementById('logPanel').style.display = '';

        addLog('全部步骤完成，请查看各面板详情');
    }

    // ========== 渲染: 类型检测 ==========
    function renderDetectPanel() {
        const rawText = state.rawItems.map(i => i.text).join('');
        const compact = rawText.replace(/\s+/g, '');
        const checks = [
            { label: '包含"普通发票"或"专用发票"', result: compact.includes('普通发票') || compact.includes('专用发票') },
            { label: '包含"发票号码"', result: compact.includes('发票号码') },
            { label: '包含"开票日期"', result: compact.includes('开票日期') },
            { label: '包含"购买方信息"', result: compact.includes('购买方信息') },
            { label: '包含"销售方信息"', result: compact.includes('销售方信息') },
            { label: '包含"价税合计"', result: compact.includes('价税合计') },
            { label: '包含"开票人"', result: compact.includes('开票人') },
        ];

        let html = '<table class="items-table"><thead><tr><th>检测条件</th><th>结果</th></tr></thead><tbody>';
        for (const c of checks) {
            html += `<tr><td>${c.label}</td><td>${c.result ? '<span class="status-ok">✔ 匹配</span>' : '<span style="color:var(--color-text-secondary)">✘</span>'}</td></tr>`;
        }
        html += '</tbody></table>';
        html += `<p style="margin-top:var(--space-3);font-weight:600">最终类型: <span class="badge ${state.invoiceKind === 'railway' ? 'badge-warn' : 'badge-success'}">${state.invoiceKind === 'railway' ? '铁路电子客票' : '增值税发票'}</span></p>`;

        document.getElementById('detectContent').innerHTML = html;
        document.getElementById('detectBadge').textContent = state.invoiceKind === 'railway' ? '铁路客票' : '增值税';
        document.getElementById('detectBadge').className = `badge ${state.invoiceKind === 'railway' ? 'badge-warn' : 'badge-success'}`;
    }

    // ========== 渲染: 文本项表格 ==========
    function renderItemsTable(type) {
        const items = type === 'raw' ? state.rawItems : state.mergedItems;
        const tbody = document.getElementById(`${type}Body_tbody`);
        const badge = document.getElementById(`${type}Badge`);

        badge.textContent = items.length;
        badge.className = `badge ${items.length > 0 ? 'badge-success' : 'badge-error'}`;

        let html = '';
        items.forEach((item, idx) => {
            html += `<tr data-text="${escapeH(item.text)}">
                <td>${idx}</td>
                <td class="text-cell" title="${escapeH(item.text)}">${escapeH(item.text)}</td>
                <td>${item.x.toFixed(1)}</td>
                <td>${item.y.toFixed(1)}</td>
                <td>${item.w.toFixed(1)}</td>
                <td>${item.h.toFixed(1)}</td>
            </tr>`;
        });
        tbody.innerHTML = html;
    }

    // ========== 过滤表格 ==========
    window.filterTable = function(type) {
        const input = document.getElementById(`${type}Filter`);
        const keyword = input.value.trim().toLowerCase();
        const tbody = document.getElementById(`${type}Body_tbody`);
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const text = (row.dataset.text || '').toLowerCase();
            row.classList.toggle('highlight', keyword && text.includes(keyword));
            row.style.display = (!keyword || text.includes(keyword)) ? '' : 'none';
        });
    };

    // ========== 渲染: 坐标可视化 ==========
    function renderCanvas() {
        redrawCanvas();
    }

    window.redrawCanvas = function() {
        const items = state.canvasMode === 'raw' ? state.rawItems : state.mergedItems;
        const filterEl = document.getElementById('canvasFilter');
        const keyword = filterEl ? filterEl.value.trim().toLowerCase() : '';

        const canvas = document.getElementById('visCanvas');
        const ctx = canvas.getContext('2d');

        if (items.length === 0) { canvas.width = 600; canvas.height = 400; ctx.clearRect(0,0,600,400); return; }

        // PDF 坐标系: Y 从下到上，通常 Y 范围 0~842 (A4)
        const maxX = Math.max(...items.map(i => i.x + i.w), 600);
        const maxY = Math.max(...items.map(i => i.y + 20), 842);
        const scale = 0.6;

        canvas.width = Math.ceil(maxX * scale + 40);
        canvas.height = Math.ceil(maxY * scale + 40);

        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 画网格
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 0.5;
        for (let y = 0; y < maxY; y += 50) {
            const cy = canvas.height - y * scale - 20;
            ctx.beginPath(); ctx.moveTo(20, cy); ctx.lineTo(canvas.width - 20, cy); ctx.stroke();
            ctx.fillStyle = '#ccc'; ctx.font = '9px sans-serif'; ctx.fillText(String(Math.round(y)), 2, cy + 3);
        }
        for (let x = 0; x < maxX; x += 50) {
            const cx = 20 + x * scale;
            ctx.beginPath(); ctx.moveTo(cx, 10); ctx.lineTo(cx, canvas.height - 10); ctx.stroke();
        }

        // 画文本项
        items.forEach((item, idx) => {
            const cx = 20 + item.x * scale;
            const cy = canvas.height - item.y * scale - 20;
            const cw = Math.max(item.w * scale, 2);
            const ch = Math.max(item.h * scale, 8);

            const isMatch = keyword && item.text.toLowerCase().includes(keyword);

            // 矩形
            ctx.fillStyle = isMatch ? 'rgba(251,191,36,0.3)' : 'rgba(59,130,246,0.08)';
            ctx.fillRect(cx, cy - ch, cw, ch);
            ctx.strokeStyle = isMatch ? '#f59e0b' : '#93c5fd';
            ctx.lineWidth = isMatch ? 1.5 : 0.5;
            ctx.strokeRect(cx, cy - ch, cw, ch);

            // 文字
            ctx.fillStyle = isMatch ? '#b45309' : '#64748b';
            ctx.font = `${isMatch ? 9 : 7}px sans-serif`;
            const label = item.text.length > 12 ? item.text.substring(0, 12) + '...' : item.text;
            ctx.fillText(label, cx + 1, cy - ch - 2);
        });
    };

    window.toggleCanvasMode = function() {
        state.canvasMode = state.canvasMode === 'raw' ? 'merged' : 'raw';
        document.getElementById('canvasModeLabel').textContent = state.canvasMode === 'raw' ? '原始' : '合并后';
        redrawCanvas();
    };

    // ========== 渲染: 解析结果 ==========
    function renderResultPanel() {
        const result = state.parseResult;
        if (!result) return;

        const fields = [
            { key: 'invoiceType', label: '发票类型' },
            { key: 'invoiceNumber', label: '发票号码' },
            { key: 'invoiceDate', label: '开票日期' },
            { key: 'buyerName', label: '购买方名称' },
            { key: 'buyerTaxId', label: '购买方税号' },
            { key: 'sellerName', label: '销售方名称' },
            { key: 'sellerTaxId', label: '销售方税号' },
            { key: 'amount', label: '金额' },
            { key: 'taxAmount', label: '税额' },
            { key: 'totalAmount', label: '价税合计(小写)' },
            { key: 'totalAmountCn', label: '价税合计(大写)' },
            { key: 'remark', label: '备注' },
            { key: 'drawer', label: '开票人' },
        ];

        let filledCount = 0;
        let html = '';
        for (const f of fields) {
            const val = result[f.key];
            const empty = !val && val !== 0;
            if (!empty) filledCount++;
            html += `<div class="result-row">
                <div class="result-label">${f.label}</div>
                <div class="result-value ${empty ? 'empty' : ''}">${empty ? '(空)' : escapeH(String(val))}</div>
                <div class="result-status ${empty ? 'status-missing' : 'status-ok'}">${empty ? '✘' : '✔'}</div>
            </div>`;
        }

        // 错误信息
        if (result.error) {
            html += `<div class="result-row">
                <div class="result-label" style="color:#dc2626">错误</div>
                <div class="result-value" style="color:#dc2626">${escapeH(result.error)}</div>
                <div class="result-status status-missing">✘</div>
            </div>`;
        }

        document.getElementById('resultGrid').innerHTML = html;
        document.getElementById('resultBadge').textContent = `${filledCount}/${fields.length}`;
        document.getElementById('resultBadge').className = `badge ${filledCount >= fields.length * 0.8 ? 'badge-success' : filledCount >= fields.length * 0.5 ? 'badge-warn' : 'badge-error'}`;
    }

    // ========== 导出 ==========
    window.exportJSON = function(type) {
        let data;
        let filename;
        switch (type) {
            case 'raw':
                data = state.rawItems;
                filename = 'debug-raw-items.json';
                break;
            case 'merged':
                data = state.mergedItems;
                filename = 'debug-merged-items.json';
                break;
            case 'result':
                data = state.parseResult;
                filename = 'debug-parse-result.json';
                break;
            default:
                return;
        }
        downloadText(filename, JSON.stringify(data, null, 2));
        CommonUtils.showToast(`已导出 ${filename}`, 'success');
    };

    // ========== 初始化 ==========
    function init() {
        if (typeof InvoiceExtractor !== 'undefined') {
            InvoiceExtractor.init();
        }
        addLog('调试工具已初始化');
        if (!InvoiceExtractor._debug) {
            addLog('警告: InvoiceExtractor._debug 不可用，需要更新 common.js 以暴露调试接口', 'warn');
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
