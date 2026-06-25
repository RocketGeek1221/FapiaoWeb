/**
 * 发票解析通用库 - InvoiceExtractor
 * 提供PDF发票信息提取功能，不包含任何UI相关代码
 * 
 * 使用方式:
 *   const result = await InvoiceExtractor.parsePDF(file);
 *   const results = await InvoiceExtractor.parsePDFs(files, onProgress, options);
 */

(function(global) {
    'use strict';

    // 配置
    const CONFIG = {
        workerSrc: 'https://s4.zstatic.net/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
        concurrency: 4,
        preserveOrder: true
    };

    // 字段标签映射
    const FIELD_LABELS = {
        invoiceType: '发票类型',
        invoiceNumber: '发票号码',
        invoiceDate: '开票日期',
        buyerName: '购买方名称',
        buyerTaxId: '购买方税号',
        sellerName: '销售方名称',
        sellerTaxId: '销售方税号',
        amount: '金额',
        taxAmount: '税额',
        totalAmount: '总额小写',
        totalAmountCn: '总额大写',
        remark: '备注',
        drawer: '开票人'
    };

    // 需要合并的常见词组
    const MERGE_TARGETS = ['单位', '数量', '单价', '金额', '税额', '合计', '备注', '购买方信息', '销售方信息'];

    /**
     * 标准化文本 - 统一全角/半角符号
     */
    function normalizeText(text, preserveSpace = false) {
        if (!text) return '';
        let result = text;
        if (!preserveSpace) {
            result = result.replace(/\s+/g, '');  // 去除所有空格和换行
        }
        return result
            .replace(/:/g, '：')    // 半角冒号 -> 全角冒号
            .replace(/\(/g, '（')   // 半角左括号 -> 全角左括号
            .replace(/\)/g, '）')   // 半角右括号 -> 全角右括号
            .replace(/,/g, '，')    // 半角逗号 -> 全角逗号
            .replace(/\./g, '．');  // 半角点 -> 全角点
    }

    /**
     * 合并相邻的单字符（支持横向和纵向多字符合并）
     */
    function mergeAdjacentChars(textItems) {
        // 创建副本
        let items = [...textItems];
        let merged = [];
        let skipIndices = new Set();

        for (let i = 0; i < items.length; i++) {
            if (skipIndices.has(i)) continue;

            const startItem = items[i];

            // 只处理单字符起始
            if (startItem.text.length !== 1) {
                merged.push(startItem);
                continue;
            }

            // 尝试纵向多字符合并（同一X列，Y递减）
            let verticalChars = [startItem];
            let lastItem = startItem;

            for (let j = i + 1; j < items.length; j++) {
                if (skipIndices.has(j)) continue;

                const next = items[j];

                // 检查是否同列且Y坐标递减（纵向连续）
                const sameCol = Math.abs(lastItem.x - next.x) < 5;
                const yContinuous = next.y < lastItem.y && next.y > lastItem.y - lastItem.h - 50;

                if (sameCol && yContinuous && next.text.length === 1) {
                    verticalChars.push(next);
                    lastItem = next;
                } else if (next.y < lastItem.y - 50) {
                    // Y间隔太大，停止查找
                    break;
                }
            }

            // 检查纵向合并结果
            if (verticalChars.length >= 2) {
                const combined = verticalChars.map(item => item.text).join('');
                const targetMatch = MERGE_TARGETS.find(target => combined.includes(target) || target.includes(combined));

                if (targetMatch && combined.length >= 2) {
                    // 使用匹配的目标词组
                    const finalText = targetMatch;
                    const first = verticalChars[0];
                    const last = verticalChars[verticalChars.length - 1];

                    merged.push({
                        text: finalText,
                        x: first.x,
                        y: first.y,
                        w: Math.max(...verticalChars.map(c => c.w)),
                        h: first.y - last.y + last.h,
                        index: first.index
                    });

                    // 标记所有参与合并的字符
                    for (let k = 1; k < verticalChars.length; k++) {
                        const idx = items.indexOf(verticalChars[k]);
                        if (idx > -1) skipIndices.add(idx);
                    }
                    continue;
                }
            }

            // 尝试横向两字符合并
            let foundMerge = false;
            for (let j = i + 1; j < items.length; j++) {
                if (skipIndices.has(j)) continue;

                const next = items[j];

                // 横向：Y相近，X连续
                const sameRow = Math.abs(startItem.y - next.y) < 5;
                const adjacentX = next.x > startItem.x && next.x < startItem.x + startItem.w + 50;

                if (sameRow && adjacentX && next.text.length === 1) {
                    const combined = startItem.text + next.text;

                    if (MERGE_TARGETS.includes(combined)) {
                        merged.push({
                            text: combined,
                            x: startItem.x,
                            y: startItem.y,
                            w: next.x + next.w - startItem.x,
                            h: Math.max(startItem.h, next.h),
                            index: startItem.index
                        });
                        skipIndices.add(j);
                        foundMerge = true;
                        break;
                    }
                }
            }

            if (!foundMerge) {
                merged.push(startItem);
            }
        }

        // 按Y坐标降序，X坐标升序重新排序
        merged.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 5) {
                return a.x - b.x;
            }
            return b.y - a.y;
        });

        return merged;
    }

    /**
     * 从文本项中提取税号（支持合并短片段）
     */
    function extractTaxIdFromItems(items, label) {
        // 先尝试找完整税号
        for (const item of items) {
            const cleanText = normalizeText(item.text);
            if (/^[A-Za-z0-9]{15,20}$/.test(cleanText)) {
                return cleanText;
            }
        }

        // 如果没找到，尝试合并所有可能的短片段
        const alphanumericItems = items.filter(item =>
            /^[A-Za-z0-9]+$/.test(normalizeText(item.text))
        ).sort((a, b) => a.x - b.x);

        if (alphanumericItems.length >= 2) {
            // 使用多策略合并
            const strategies = [30, 50, 80];
            let bestResult = '';

            for (const maxGap of strategies) {
                let mergedText = '';
                let lastEndX = 0;

                for (const item of alphanumericItems) {
                    const cleanText = normalizeText(item.text);
                    const actualGap = item.x - lastEndX;

                    if (mergedText === '' || actualGap < maxGap) {
                        mergedText += cleanText;
                        lastEndX = item.x + item.w;
                    } else {
                        if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                            bestResult = mergedText;
                        }
                        mergedText = cleanText;
                        lastEndX = item.x + item.w;
                    }
                }

                if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                    bestResult = mergedText;
                }
            }

            if (bestResult) {
                return bestResult;
            }
        }

        return '';
    }

    /**
     * 检测发票类型
     */
    function detectInvoiceType(textItems) {
        const rawText = textItems.map(i => i.text).join('');
        const compact = rawText.replace(/\s+/g, '');
        // 检测铁路电子客票
        if (compact.includes('铁路电子客票') ||
            (compact.includes('电子客票号') && (compact.includes('票价') || rawText.includes('￥')))) {
            return 'railway';
        }
        return 'vat';
    }

    /**
     * 从PDF提取原始文本项（不含合并和解析）
     */
    async function extractRawItems(arrayBuffer) {
        if (typeof pdfjsLib === 'undefined') {
            throw new Error('PDF.js library not loaded');
        }

        // 确保 worker 已配置
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.workerSrc;
        }

        const pdf = await pdfjsLib.getDocument({
            data: arrayBuffer,
            disableAutoFetch: true,
            disableStream: true
        }).promise;

        const page = await pdf.getPage(1);
        const textContent = await page.getTextContent();

        let textItems = textContent.items.map((item, index) => ({
            text: item.str.trim().replace(/\s+/g, ''),
            x: parseFloat(item.transform[4].toFixed(2)),
            y: parseFloat(item.transform[5].toFixed(2)),
            w: parseFloat(item.width.toFixed(2)),
            h: parseFloat(item.height.toFixed(2)),
            index: index
        })).filter(item => item.text.length > 0);

        // 按 Y 降序、X 升序排序
        textItems.sort((a, b) => {
            if (Math.abs(a.y - b.y) < 5) {
                return a.x - b.x;
            }
            return b.y - a.y;
        });

        return textItems;
    }

    /**
     * 基于坐标解析发票 - 完全按照 script.js 实现
     */
    function parseInvoiceCoords(textItems) {
        const result = {
            invoiceType: '',
            invoiceNumber: '',
            invoiceDate: '',
            buyerName: '',
            buyerTaxId: '',
            sellerName: '',
            sellerTaxId: '',
            amount: '',
            taxAmount: '',
            totalAmount: '',
            totalAmountCn: '',
            remark: '',
            drawer: ''
        };

        // Helper: Find text item by exact match
        function findText(text) {
            return textItems.find(item => item.text === text);
        }

        // Helper: Find text by partial match (支持标准化后的匹配)
        function findTextPartial(partial) {
            const normalizedPartial = normalizeText(partial);
            return textItems.find(item => {
                const normalizedItem = normalizeText(item.text);
                return normalizedItem.includes(normalizedPartial);
            });
        }

        // Helper: Find all matching items (支持标准化后的匹配)
        function findAll(text) {
            const normalizedText = normalizeText(text);
            return textItems.filter(item => {
                const normalizedItem = normalizeText(item.text);
                return normalizedItem.includes(normalizedText);
            });
        }

        // Helper: 动态Y容差计算 - 根据文本高度计算同行容差范围
        function getYRange(keywordItem) {
            if (!keywordItem) return { min: 0, max: 0 };
            // 基于字体高度的动态容差：从 (y - h) 到 (y + h/2)
            return {
                min: keywordItem.y - keywordItem.h,
                max: keywordItem.y + keywordItem.h / 2
            };
        }

        // Helper: 检查item是否在keyword的同一行（使用动态容差）
        function isSameRow(item, keywordItem) {
            if (!item || !keywordItem) return false;
            const range = getYRange(keywordItem);
            const itemYCenter = item.y - item.h / 2;
            return itemYCenter >= range.min && itemYCenter <= range.max;
        }

        // Helper: Get text items to the right of a keyword (same row)
        function getRightOfKeyword(keyword, includeSameY = true, yTolerance = null) {
            const keywordItem = typeof keyword === 'string' ? findTextPartial(keyword) : keyword;
            if (!keywordItem) return [];

            const results = textItems.filter(item => {
                // 使用动态Y容差或指定的固定容差
                let yMatch = true;
                if (includeSameY) {
                    if (yTolerance === null) {
                        // 使用动态容差
                        yMatch = isSameRow(item, keywordItem);
                    } else {
                        // 使用指定固定容差
                        yMatch = Math.abs(item.y - keywordItem.y) < yTolerance;
                    }
                }
                return item.x > keywordItem.x + keywordItem.w - 2 && yMatch && item.text !== keywordItem.text;
            });

            results.sort((a, b) => a.x - b.x);
            return results;
        }

        // Helper: 查找同行文本（使用动态容差）
        function findRowText(yCenter, yTolerance = null) {
            let rowItems;
            if (yTolerance === null) {
                // 基于平均字体高度计算容差
                const avgHeight = textItems.reduce((sum, item) => sum + item.h, 0) / textItems.length || 12;
                rowItems = textItems.filter(item => Math.abs(item.y - yCenter) < avgHeight);
            } else {
                rowItems = textItems.filter(item => Math.abs(item.y - yCenter) < yTolerance);
            }
            rowItems.sort((a, b) => a.x - b.x);
            return rowItems;
        }

        // Helper: Get text items below a keyword
        function getBelowKeyword(keyword, maxDistance = 50) {
            const keywordItem = typeof keyword === 'string' ? findTextPartial(keyword) : keyword;
            if (!keywordItem) return [];

            const results = textItems.filter(item => {
                const yDiff = keywordItem.y - item.y;
                return yDiff > 0 && yDiff < maxDistance && Math.abs(item.x - keywordItem.x) < 100;
            });

            results.sort((a, b) => b.y - a.y);
            return results;
        }

        // ========== 严格按照结构分组提取字段 ==========

        // 1. 发票信息区域（Y > 320）
        const headerItems = textItems.filter(item => item.y > 320);

        // 1.1 发票类型：从"电子发票（普通发票）"提取（去除空格后匹配）
        const invoiceTypeItem = headerItems.find(item => {
            const normalizedText = normalizeText(item.text);
            return normalizedText.includes('普通发票') || normalizedText.includes('专用发票');
        });
        if (invoiceTypeItem) {
            const normalizedText = normalizeText(invoiceTypeItem.text);
            const typeMatch = normalizedText.match(/(普通发票|专用发票)/);
            if (typeMatch) {
                result.invoiceType = typeMatch[1];
            }
        }

        // 1.2 发票号码：从"发票号码："右侧提取（去除空格后匹配）
        const invoiceNumKeyword = headerItems.find(item => normalizeText(item.text).includes('发票号码'));
        if (invoiceNumKeyword) {
            // 严格Y容差（同一行），X在右侧
            const rightItems = headerItems.filter(item =>
                item.x > invoiceNumKeyword.x + invoiceNumKeyword.w - 5 && Math.abs(item.y - invoiceNumKeyword.y) < 5
            );

            // 找数字格式
            for (const item of rightItems) {
                if (/^\d{8,20}$/.test(item.text)) {
                    result.invoiceNumber = item.text;
                    break;
                }
            }

            // 如果未找到，尝试合并横向单字符数字
            if (!result.invoiceNumber && rightItems.length >= 8) {
                const sortedItems = rightItems.sort((a, b) => a.x - b.x);
                let mergedNumber = '';
                let lastX = 0;
                const xGapThreshold = 15;

                for (const item of sortedItems) {
                    const cleanText = item.text.replace(/\s/g, '');
                    if (!cleanText) continue;

                    if (/^[\d]$/.test(cleanText)) {
                        if (mergedNumber === '' || (item.x - lastX) < xGapThreshold) {
                            mergedNumber += cleanText;
                            lastX = item.x;
                        } else {
                            if (/^\d{8,20}$/.test(mergedNumber)) break;
                            mergedNumber = cleanText;
                            lastX = item.x;
                        }
                    } else if (cleanText.length > 1 && /^\d+$/.test(cleanText)) {
                        if (mergedNumber === '' || (item.x - lastX) < xGapThreshold) {
                            mergedNumber += cleanText;
                            lastX = item.x + cleanText.length * 5;
                        }
                    }
                }

                if (/^\d{8,20}$/.test(mergedNumber)) {
                    result.invoiceNumber = mergedNumber;
                }
            }
        }

        // 1.3 开票日期：从"开票日期："右侧提取（去除空格后匹配）
        const dateKeyword = headerItems.find(item => normalizeText(item.text).includes('开票日期'));
        if (dateKeyword) {
            // 严格Y容差（同一行），X在右侧（关键词宽度可能不准，从关键词x+10开始）
            const rightItems = headerItems.filter(item =>
                item.x > dateKeyword.x + 10 && Math.abs(item.y - dateKeyword.y) < 5
            ).sort((a, b) => a.x - b.x);

            // 优先：拼接右侧所有文本整体匹配日期（处理"2026年04月21"+"日"被拆分的情况）
            const combinedText = rightItems.map(i => i.text).join('');
            const combinedMatch = combinedText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
            if (combinedMatch) {
                result.invoiceDate = `${combinedMatch[1]}年${combinedMatch[2].padStart(2, '0')}月${combinedMatch[3].padStart(2, '0')}日`;
            }

            // 备用：逐项检查
            if (!result.invoiceDate) {
                for (const item of rightItems) {
                    if (item.text.includes('日')) {
                        const dateMatch = item.text.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
                        if (dateMatch) {
                            result.invoiceDate = `${dateMatch[1]}年${dateMatch[2].padStart(2, '0')}月${dateMatch[3].padStart(2, '0')}日`;
                            break;
                        }
                    }
                }
            }

            // 备用：尝试合并横向字符
            if (!result.invoiceDate && rightItems.length >= 3) {
                const sortedItems = rightItems.sort((a, b) => a.x - b.x);
                let mergedText = '';
                let lastX = 0;
                const xGapThreshold = 20;

                for (const item of sortedItems) {
                    const cleanText = item.text.replace(/\s/g, '');
                    if (!cleanText) continue;

                    if (mergedText === '' || (item.x - lastX) < xGapThreshold) {
                        mergedText += cleanText;
                        lastX = item.x;
                    } else {
                        const dateMatch = mergedText.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
                        if (dateMatch) {
                            result.invoiceDate = `${dateMatch[1]}年${dateMatch[2].padStart(2, '0')}月${dateMatch[3].padStart(2, '0')}日`;
                            break;
                        }
                        mergedText = cleanText;
                        lastX = item.x;
                    }
                }

                if (!result.invoiceDate && mergedText) {
                    const dateMatch = mergedText.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
                    if (dateMatch) {
                        result.invoiceDate = `${dateMatch[1]}年${dateMatch[2].padStart(2, '0')}月${dateMatch[3].padStart(2, '0')}日`;
                    }
                }
            }
        }

        // 备用：如果还是没找到，在header区域搜索包含"日"的日期格式
        if (!result.invoiceDate) {
            for (const item of headerItems) {
                if (normalizeText(item.text).includes('日')) {
                    const dateMatch = item.text.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
                    if (dateMatch) {
                        result.invoiceDate = `${dateMatch[1]}年${dateMatch[2].padStart(2, '0')}月${dateMatch[3].padStart(2, '0')}日`;
                        break;
                    }
                }
            }
        }

        // 2. 购买方信息区域 - 通过关键词动态检测Y范围
        // 先查找"购买方信息"关键词确定区域中心
        const buyerInfoKeyword = textItems.find(item =>
            normalizeText(item.text).includes('购买方信息') ||
            normalizeText(item.text).includes('购方信息')
        );
        let buyerMinY = 250, buyerMaxY = 320; // 默认值
        if (buyerInfoKeyword) {
            buyerMinY = buyerInfoKeyword.y - 50;
            buyerMaxY = buyerInfoKeyword.y + 20;
        }
        const buyerItems = textItems.filter(item => item.y > buyerMinY && item.y <= buyerMaxY && item.x < 350);

        // 2.1 购买方名称：从"名称："右侧提取（去除空格后匹配）
        const buyerNameKeyword = buyerItems.find(item => normalizeText(item.text).includes('名称'));
        if (buyerNameKeyword) {
            // 严格Y容差（同一行），X在右侧，限制在购买方区域内
            const rightItems = buyerItems.filter(item =>
                item.x > buyerNameKeyword.x + buyerNameKeyword.w - 5 &&
                item.x < 280 &&
                Math.abs(item.y - buyerNameKeyword.y) < 5
            );

            if (rightItems.length > 0) {
                result.buyerName = rightItems.map(i => i.text).join('');
            }
        }

        // 2.2 购买方税号：从"统一社会信用代码/纳税人识别号："右侧提取（去除空格后匹配）
        const buyerTaxKeyword = buyerItems.find(item => {
            const normalizedText = normalizeText(item.text);
            return normalizedText.includes('纳税人识别号') || normalizedText.includes('统一社会信用');
        });
        if (buyerTaxKeyword) {
            // 放宽过滤条件：只要在同一行附近（Y容差20），且在关键词右侧（X > keyword.x + 10）
            const rightItems = buyerItems.filter(item =>
                item.x > buyerTaxKeyword.x + 10 && Math.abs(item.y - buyerTaxKeyword.y) < 20
            );

            // 在右侧文本中找税号格式
            for (const item of rightItems) {
                const cleanText = normalizeText(item.text);
                if (/^[A-Za-z0-9]{15,20}$/.test(cleanText)) {
                    result.buyerTaxId = cleanText;
                    break;
                }
            }

            // 如果未找到，尝试合并横向短片段（处理税号被拆成多段的情况）
            if (!result.buyerTaxId && rightItems.length >= 2) {
                const sortedItems = rightItems.sort((a, b) => a.x - b.x);

                // 改进的合并策略：多阈值尝试
                const strategies = [30, 50, 80];
                let bestResult = '';

                for (const maxGap of strategies) {
                    let mergedText = '';
                    let lastEndX = 0;

                    for (const item of sortedItems) {
                        const cleanText = normalizeText(item.text);
                        if (!cleanText || !/^[A-Za-z0-9]+$/.test(cleanText)) continue;

                        const actualGap = item.x - lastEndX;

                        if (mergedText === '' || actualGap < maxGap) {
                            mergedText += cleanText;
                            lastEndX = item.x + item.w;
                        } else {
                            if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                                bestResult = mergedText;
                            }
                            mergedText = cleanText;
                            lastEndX = item.x + item.w;
                        }
                    }

                    if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                        bestResult = mergedText;
                    }
                }

                if (bestResult) {
                    result.buyerTaxId = bestResult;
                }
            }
        }

        // 备用：如果还是没找到，直接在buyerItems中查找税号格式的文本（也支持合并）
        if (!result.buyerTaxId) {
            result.buyerTaxId = extractTaxIdFromItems(buyerItems, '购买方');
        }

        // 3. 销售方信息区域 - 通过关键词动态检测Y范围
        // 先查找"销售方信息"关键词确定区域中心
        const sellerInfoKeyword = textItems.find(item =>
            normalizeText(item.text).includes('销售方信息') ||
            normalizeText(item.text).includes('销方信息')
        );
        let sellerMinY = 250, sellerMaxY = 320; // 默认值
        if (sellerInfoKeyword) {
            sellerMinY = sellerInfoKeyword.y - 50;
            sellerMaxY = sellerInfoKeyword.y + 20;
        }
        const sellerItems = textItems.filter(item => item.y > sellerMinY && item.y <= sellerMaxY && item.x > 280);

        // 3.1 销售方名称：从"名称："右侧提取（去除空格后匹配）
        const sellerNameKeyword = sellerItems.find(item => normalizeText(item.text).includes('名称'));
        if (sellerNameKeyword) {
            // 严格Y容差（同一行），X在右侧
            const rightItems = sellerItems.filter(item =>
                item.x > sellerNameKeyword.x + sellerNameKeyword.w - 5 && Math.abs(item.y - sellerNameKeyword.y) < 5
            );

            if (rightItems.length > 0) {
                result.sellerName = rightItems.map(i => i.text).join('');
            }
        }

        // 3.2 销售方税号：从"统一社会信用代码/纳税人识别号："右侧提取（去除空格后匹配）
        const sellerTaxKeyword = sellerItems.find(item => {
            const normalizedText = normalizeText(item.text);
            return normalizedText.includes('纳税人识别号') || normalizedText.includes('统一社会信用');
        });
        if (sellerTaxKeyword) {
            // 放宽过滤条件：只要在同一行附近（Y容差20），且在关键词右侧（X > keyword.x + 10）
            const rightItems = sellerItems.filter(item =>
                item.x > sellerTaxKeyword.x + 10 && Math.abs(item.y - sellerTaxKeyword.y) < 20
            );

            // 在右侧文本中找税号格式
            // 先尝试查找完整的税号文本
            for (const item of rightItems) {
                const cleanText = item.text.replace(/\s/g, '');
                if (/^[A-Za-z0-9]{15,20}$/.test(cleanText)) {
                    result.sellerTaxId = cleanText;
                    break;
                }
            }

            // 尝试合并横向短片段（处理税号被拆成多段的情况，如 "914" + "4" + "0101MA5ARK" + "Q" + "C" + "0X"）
            if (!result.sellerTaxId && rightItems.length >= 2) {
                const sortedItems = rightItems.sort((a, b) => a.x - b.x);

                // 改进的合并策略：多阈值尝试
                const strategies = [30, 50, 80];
                let bestResult = '';

                for (const maxGap of strategies) {
                    let mergedText = '';
                    let lastEndX = 0;

                    for (const item of sortedItems) {
                        const cleanText = normalizeText(item.text);
                        if (!cleanText || !/^[A-Za-z0-9]+$/.test(cleanText)) continue;

                        const actualGap = item.x - lastEndX;

                        if (mergedText === '' || actualGap < maxGap) {
                            mergedText += cleanText;
                            lastEndX = item.x + item.w;
                        } else {
                            if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                                bestResult = mergedText;
                            }
                            mergedText = cleanText;
                            lastEndX = item.x + item.w;
                        }
                    }

                    if (/^[A-Za-z0-9]{15,20}$/.test(mergedText) && mergedText.length > bestResult.length) {
                        bestResult = mergedText;
                    }
                }

                if (bestResult) {
                    result.sellerTaxId = bestResult;
                }
            }
        } else {
            // addDebugLog('未找到销售方"纳税人识别号"关键词，尝试直接查找税号', 'warn');
        }

        // 备用：如果还是没找到，直接在sellerItems中查找税号格式的文本（也支持合并）
        if (!result.sellerTaxId) {
            result.sellerTaxId = extractTaxIdFromItems(sellerItems, '销售方');
        }

        // 4. 合计信息区域（120 < Y <= 135）
        const subtotalItems = textItems.filter(item => item.y > 120 && item.y <= 135);

        if (subtotalItems.length > 0) {
            // 找¥符号后面的金额
            const amounts = [];

            // 4.1 尝试标准模式：¥符号后紧跟完整金额
            for (let i = 0; i < subtotalItems.length - 1; i++) {
                const item = subtotalItems[i];
                const nextItem = subtotalItems[i + 1];
                // ¥符号后面紧跟数字
                if ((item.text === '¥' || item.text === '￥') && /^[-]?\d+\.\d{2}$/.test(nextItem.text)) {
                    amounts.push(nextItem.text);
                }
            }

            // 4.2 如果未找到完整金额，尝试合并横向短片段（处理 "21." + "96" 这种情况）
            if (amounts.length === 0) {
                for (let i = 0; i < subtotalItems.length; i++) {
                    const item = subtotalItems[i];
                    if (item.text === '¥' || item.text === '￥') {
                        const rightItems = subtotalItems.filter(subItem =>
                            subItem.x > item.x && Math.abs(subItem.y - item.y) < 10
                        ).sort((a, b) => a.x - b.x);

                        let mergedAmount = '';
                        let lastX = item.x;
                        let lastWidth = 0;
                        const xGapThreshold = 20;

                        for (const rItem of rightItems) {
                            const cleanText = rItem.text.replace(/\s/g, '');
                            if (!cleanText) continue;

                            // 判断是否应该合并（考虑前一个片段的宽度）
                            const expectedGap = lastWidth * 0.8;
                            const actualGap = rItem.x - lastX;
                            const shouldMerge = mergedAmount === '' || actualGap < Math.max(xGapThreshold, expectedGap);

                            // 数字、小数点或短数字片段（如 "21.", "96", "2.", "8", "-208."）
                            if (shouldMerge && /^[-]?\d*[.]?\d*$/.test(cleanText)) {
                                mergedAmount += cleanText;
                                lastX = rItem.x;
                                lastWidth = rItem.w;
                            } else if (/^[-]?\d+\.\d{2}$/.test(cleanText)) {
                                mergedAmount = cleanText;
                                break;
                            } else {
                                break;
                            }
                        }

                        // 验证并格式化金额（确保有两位小数）
                        if (/^[-]?\d+\.\d{1,2}$/.test(mergedAmount)) {
                            // 如果只有一位小数，补零
                            if (mergedAmount.match(/\.\d$/)) {
                                mergedAmount += '0';
                            }
                            amounts.push(mergedAmount);
                        } else if (/^[-]?\d+$/.test(mergedAmount)) {
                            // 没有小数点，尝试解析为整数金额（如 286 表示 2.86）
                            if (mergedAmount.length >= 3) {
                                const formatted = mergedAmount.slice(0, -2) + '.' + mergedAmount.slice(-2);
                                amounts.push(formatted);
                            }
                        }
                    }
                }
            }

            // 4.3 金额：第一个¥后的数字
            if (amounts.length >= 1) {
                result.amount = amounts[0];
            }
            // 4.4 税额：第二个¥后的数字
            if (amounts.length >= 2) {
                result.taxAmount = amounts[1];
            }
        }

        // 5. 价税合计信息区域（100 < Y <= 120）
        const taxTotalItems = textItems.filter(item => item.y > 100 && item.y <= 120);

        // 5.1 总额大写：从"价税合计（大写）"右侧提取中文金额（去除空格后匹配）
        const daxieKeyword = taxTotalItems.find(item => {
            const normalizedText = normalizeText(item.text);
            return normalizedText.includes('大写') || normalizedText.includes('价税合计');
        });
        if (daxieKeyword) {
            const rightItems = taxTotalItems.filter(item =>
                item.x > daxieKeyword.x + daxieKeyword.w && Math.abs(item.y - daxieKeyword.y) < 10
            );
            // 找中文大写金额
            for (const item of rightItems) {
                const cleanedText = item.text.replace(/\s+/g, '');
                const cnMatch = cleanedText.match(/[零壹贰叁肆伍陆柒捌玖拾佰仟万亿圆元角分整]+/);
                if (cnMatch && cnMatch[0].length >= 2) {
                    result.totalAmountCn = cleanedText;
                    break;
                }
            }
        }

        // 5.2 总额小写：从"（小写）"右侧¥后的数字（去除空格后匹配）
        const xiaoxieKeyword = taxTotalItems.find(item => normalizeText(item.text).includes('小写'));
        if (xiaoxieKeyword) {
            const rightItems = taxTotalItems.filter(item =>
                item.x > xiaoxieKeyword.x && Math.abs(item.y - xiaoxieKeyword.y) < 5
            );

            // 尝试标准模式：¥符号后紧跟完整金额
            for (let i = 0; i < rightItems.length - 1; i++) {
                if ((rightItems[i].text === '¥' || rightItems[i].text === '￥') &&
                    /^[-]?\d+\.\d{2}$/.test(rightItems[i + 1].text)) {
                    result.totalAmount = rightItems[i + 1].text;
                    break;
                }
            }

            // 如果未找到，尝试合并横向短片段（处理 "24." + "8" + "2" 这种情况）
            if (!result.totalAmount) {
                for (let i = 0; i < rightItems.length; i++) {
                    const item = rightItems[i];
                    if (item.text === '¥' || item.text === '￥') {
                        const amountItems = rightItems.filter(subItem =>
                            subItem.x > item.x && Math.abs(subItem.y - item.y) < 10
                        ).sort((a, b) => a.x - b.x);

                        let mergedAmount = '';
                        let lastX = item.x;
                        let lastWidth = 0;
                        const xGapThreshold = 20;

                        for (const aItem of amountItems) {
                            const cleanText = aItem.text.replace(/\s/g, '');
                            if (!cleanText) continue;

                            // 判断是否应该合并（考虑前一个片段的宽度）
                            const expectedGap = lastWidth * 0.8;
                            const actualGap = aItem.x - lastX;
                            const shouldMerge = mergedAmount === '' || actualGap < Math.max(xGapThreshold, expectedGap);

                            // 数字、小数点或短数字片段（如 "21.", "96", "2.", "8", "-208."）
                            if (shouldMerge && /^[-]?\d*[.]?\d*$/.test(cleanText)) {
                                mergedAmount += cleanText;
                                lastX = aItem.x;
                                lastWidth = aItem.w;
                            } else if (/^[-]?\d+\.\d{2}$/.test(cleanText)) {
                                mergedAmount = cleanText;
                                break;
                            } else {
                                break;
                            }
                        }

                        // 验证并格式化金额（确保有两位小数）
                        if (/^[-]?\d+\.\d{1,2}$/.test(mergedAmount)) {
                            // 如果只有一位小数，补零
                            if (mergedAmount.match(/\.\d$/)) {
                                mergedAmount += '0';
                            }
                            result.totalAmount = mergedAmount;
                            break;
                        } else if (/^[-]?\d+$/.test(mergedAmount)) {
                            // 没有小数点，尝试解析为整数金额（如 286 表示 2.86）
                            if (mergedAmount.length >= 3) {
                                const formatted = mergedAmount.slice(0, -2) + '.' + mergedAmount.slice(-2);
                                result.totalAmount = formatted;
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 6. 其他信息区域（Y <= 100）：备注、开票人
        const footerItems = textItems.filter(item => item.y <= 100);

        // 6.1 备注：智能区域查找（通过多个关键词动态确定区域边界）
        // 尝试多种方式定位备注区域
        let remarkMinY, remarkMaxY, remarkMinX;

        // 方法1：通过"备"+"注"或"备注"关键词定位（保留空格匹配）
        const beiItem = footerItems.find(item => {
            const normalized = normalizeText(item.text, true); // 保留空格
            return normalized === '备' || normalized === '备注';
        });
        const xiaoxieItem2 = textItems.find(item => {
            const normalized = normalizeText(item.text); // 去除空格
            return normalized.includes('小写') && item.y > 50 && item.y < 150;
        });
        const sellerStampItem = textItems.find(item => {
            const normalized = normalizeText(item.text, true); // 保留空格
            return normalized.includes('销售方') && normalized.includes('章');
        });

        if (beiItem && xiaoxieItem2) {
            remarkMinX = beiItem.x - 20;
            // 修复：备注区域应该包含标签上方和下方的内容（考虑竖排标签的高度）
            // 购方开户银行 Y=83.44 可能在备注标签 Y=79.32 上方，需要扩展上边界
            const beiBottomY = beiItem.y - beiItem.h; // 竖排标签的底部（实际Y值更小）
            remarkMinY = Math.min(beiBottomY, beiItem.y) - 10; // 向下扩展（Y值更小的方向）
            remarkMaxY = xiaoxieItem2.y - 5;
        } else if (xiaoxieItem2 && sellerStampItem) {
            // 方法2：通过小写和销售方印章定位
            remarkMinX = xiaoxieItem2.x - 50;
            remarkMinY = sellerStampItem.y + 10;
            remarkMaxY = xiaoxieItem2.y - 5;
        } else {
            // 方法3：默认区域
            remarkMinX = 50;
            remarkMinY = 20;
            remarkMaxY = 90;
        }

        const remarkItems = textItems.filter(item => {
            return item.x >= remarkMinX &&
                   item.y >= remarkMinY &&
                   item.y <= remarkMaxY &&
                   item.text !== '备' &&
                   item.text !== '注' &&
                   item.text !== '备注' &&
                   !item.text.includes('价税') &&
                   !item.text.includes('大写') &&
                   !item.text.includes('小写') &&
                   !item.text.includes('¥') &&
                   !item.text.includes('￥') &&
                   !item.text.includes('销售方') &&
                   !item.text.includes('章');
        });

        if (remarkItems.length > 0) {
            // 按 Y 坐标分组（同行判断：Y 差值小于平均字体高度）
            const avgHeight = remarkItems.reduce((sum, item) => sum + item.h, 0) / remarkItems.length || 10;
            const lines = [];
            let currentLine = [];
            let lastY = null;

            // 已按 Y 降序排序，相同 Y 的在同一行
            for (const item of remarkItems) {
                if (lastY !== null && Math.abs(item.y - lastY) > avgHeight) {
                    // Y 差距大，换行
                    if (currentLine.length > 0) {
                        lines.push(currentLine.map(i => i.text).join(''));
                    }
                    currentLine = [item];
                } else {
                    currentLine.push(item);
                }
                lastY = item.y;
            }
            if (currentLine.length > 0) {
                lines.push(currentLine.map(i => i.text).join(''));
            }

            result.remark = lines.join('\n');
        }

        // 6.2 开票人：从"开票人："右侧提取（保留空格匹配）
        const drawerKeyword = footerItems.find(item => {
            const normalized = normalizeText(item.text); // 去除空格
            return normalized.includes('开票人');
        });
        if (drawerKeyword) {
            // 放宽过滤条件：只要在同一行附近（Y容差20），且在关键词右侧（X > keyword.x + 5）
            const rightItems = footerItems.filter(item =>
                item.x > drawerKeyword.x + 5 && Math.abs(item.y - drawerKeyword.y) < 20
            );

            // 在右侧文本中找人名
            for (const item of rightItems) {
                const cleanText = item.text.trim();
                if (/^[\u4e00-\u9fa5]{2,4}$/.test(cleanText)) {
                    result.drawer = cleanText;
                    break;
                }
            }
            // 如果没找到，取第一个非空文本
            if (!result.drawer && rightItems.length > 0) {
                const firstValid = rightItems.find(i => i.text.trim().length > 0);
                if (firstValid) {
                    result.drawer = firstValid.text.trim();
                }
            }
        }

        // 备用：如果还是没找到，在footer区域直接搜索可能的人名
        if (!result.drawer) {
            for (const item of footerItems) {
                const cleanText = item.text.trim();
                if (/^[\u4e00-\u9fa5]{2,4}$/.test(cleanText)) {
                    result.drawer = cleanText;
                    break;
                }
            }
        }

        // 生成原始文本用于备用正则提取
        const rawText = textItems.map(item => item.text).join(' ');

        // Fallback regex for missing fields
        if (!result.invoiceNumber) {
            const match = rawText.match(/\b(\d{20})\b/);
            if (match) {
                result.invoiceNumber = match[1];
            }
        }

        if (!result.buyerName) {
            const matches = rawText.match(/[\u4e00-\u9fa5]+公司/g);
            if (matches && matches.length >= 1) {
                result.buyerName = matches[0];
            }
        }

        if (!result.sellerName) {
            const matches = rawText.match(/[\u4e00-\u9fa5]+公司/g);
            if (matches && matches.length >= 2) {
                result.sellerName = matches[matches.length - 1];
            }
        }

        return result;
    }

    /**
     * 解析PDF缓冲区 - 完全按照 script.js 实现
     */
    async function parsePDFBuffer(arrayBuffer, fileName, fileSize) {
        try {
            if (typeof pdfjsLib === 'undefined') {
                throw new Error('PDF.js library not loaded');
            }

            // Use disableAutoFetch and disableStream for faster single-page parsing
            const pdf = await pdfjsLib.getDocument({
                data: arrayBuffer,
                disableAutoFetch: true,
                disableStream: true
            }).promise;

            // Get all text items with coordinates from first page
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();

            // Convert to coordinate format - 使用PDF原生坐标（与script.js一致）
            let textItems = textContent.items.map((item, index) => ({
                text: item.str.trim().replace(/\s+/g, ''),
                x: parseFloat(item.transform[4].toFixed(2)),
                y: parseFloat(item.transform[5].toFixed(2)),
                w: parseFloat(item.width.toFixed(2)),
                h: parseFloat(item.height.toFixed(2)),
                index: index
            })).filter(item => item.text.length > 0);

            // Sort by Y descending (top to bottom), then X ascending (left to right)
            textItems.sort((a, b) => {
                if (Math.abs(a.y - b.y) < 5) {
                    return a.x - b.x;
                }
                return b.y - a.y;
            });

            // 合并同行相邻的单字符（如 "单"+"位"→"单位"）
            textItems = mergeAdjacentChars(textItems);

            // Parse using coordinate algorithm
            const result = parseInvoiceCoords(textItems);

            return {
                success: true,
                fileName: fileName,
                fileSize: fileSize,
                ...result
            };
        } catch (error) {
            return {
                success: false,
                fileName: fileName,
                error: error.message
            };
        }
    }

    // 主对象
    const InvoiceExtractor = {
        /**
         * 初始化
         */
        init(options = {}) {
            if (options.workerSrc) {
                CONFIG.workerSrc = options.workerSrc;
            }
            if (typeof pdfjsLib !== 'undefined') {
                pdfjsLib.GlobalWorkerOptions.workerSrc = CONFIG.workerSrc;
            }
            return this;
        },

        /**
         * 解析单个PDF文件
         */
        async parsePDF(file) {
            const arrayBuffer = await file.arrayBuffer();
            return parsePDFBuffer(arrayBuffer, file.name, file.size);
        },

        /**
         * 解析PDF ArrayBuffer（用于预加载优化）
         */
        async parseBuffer(arrayBuffer, fileName, fileSize) {
            return parsePDFBuffer(arrayBuffer, fileName, fileSize);
        },

        /**
         * 批量解析PDF文件
         */
        async parsePDFs(files, onProgress = null, options = {}) {
            const {
                concurrency = CONFIG.concurrency,
                preserveOrder = CONFIG.preserveOrder
            } = options;

            const fileArray = Array.from(files).filter(f => f.type === 'application/pdf');

            if (fileArray.length === 0) {
                return [];
            }

            // 预加载
            const preloadedFiles = await Promise.all(
                fileArray.map(async (file) => ({
                    buffer: await file.arrayBuffer(),
                    name: file.name,
                    size: file.size
                }))
            );

            const results = preserveOrder ? new Array(preloadedFiles.length).fill(null) : [];
            let completedCount = 0;

            const processBatch = async (batch, startIndex) => {
                const batchPromises = batch.map((item, idx) => {
                    return parsePDFBuffer(item.buffer, item.name, item.size).then(result => {
                        const actualIndex = preserveOrder ? startIndex + idx : results.length;

                        if (preserveOrder) {
                            results[actualIndex] = result;
                        } else {
                            results.push(result);
                        }

                        completedCount++;
                        if (onProgress) {
                            onProgress(completedCount, preloadedFiles.length, result);
                        }

                        return result;
                    });
                });

                return Promise.all(batchPromises);
            };

            for (let i = 0; i < preloadedFiles.length; i += concurrency) {
                const batch = preloadedFiles.slice(i, i + concurrency);
                await processBatch(batch, i);
            }

            return results;
        },

        /**
         * 调试接口 - 暴露内部函数供调试页面使用
         */
        _debug: {
            extractRawItems,
            mergeAdjacentChars,
            detectInvoiceType,
            parseInvoiceCoords,
            normalizeText
        },

        /**
         * 获取字段标签
         */
        getFieldLabel(key) {
            return FIELD_LABELS[key] || key;
        },

        /**
         * 获取所有字段标签
         */
        getFieldLabels() {
            return { ...FIELD_LABELS };
        },

        /**
         * 格式化结果为文本
         */
        formatAsText(result) {
            const lines = [];
            lines.push(`发票类型：${result.invoiceType || '-'}`);
            lines.push(`发票号码：${result.invoiceNumber || '-'}`);
            lines.push(`开票日期：${result.invoiceDate || '-'}`);
            lines.push(`购买方名称：${result.buyerName || '-'}`);
            lines.push(`购买方税号：${result.buyerTaxId || '-'}`);
            lines.push(`销售方名称：${result.sellerName || '-'}`);
            lines.push(`销售方税号：${result.sellerTaxId || '-'}`);
            lines.push(`不含税金额：${result.amount || '-'}`);
            lines.push(`发票税额：${result.taxAmount || '-'}`);
            lines.push(`发票金额：${result.totalAmount || '-'}`);
            lines.push(`总额大写：${result.totalAmountCn || '-'}`);
            lines.push(`开票人：${result.drawer || '-'}`);
            lines.push(`备注：${result.remark || '-'}`);
            return lines.join('\n');
        }
    };

    // 导出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = InvoiceExtractor;
    } else {
        global.InvoiceExtractor = InvoiceExtractor;
    }

    /**
     * 公共工具函数
     * 提供各页面共享的工具方法
     */
    global.CommonUtils = {
        /**
         * 格式化文件大小
         * @param {number} bytes - 文件字节数
         * @returns {string} 格式化后的大小字符串
         */
        formatFileSize(bytes) {
            if (bytes === 0) return '0 B';
            const k = 1024;
            const sizes = ['B', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        },

        /**
         * 显示 Toast 提示
         * @param {string} message - 提示消息
         * @param {string} [type='info'] - 提示类型: 'info', 'success', 'error'
         * @param {number} [duration=3000] - 显示时长（毫秒）
         */
        showToast(message, type = 'info', duration = 3000) {
            const toast = document.getElementById('toast');
            const toastMessage = document.getElementById('toastMessage');
            if (!toast || !toastMessage) return;

            toastMessage.textContent = message;
            toast.className = 'toast show ' + type;

            setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        },

        /**
         * HTML 转义，防止 XSS
         * @param {string} text - 需要转义的文本
         * @returns {string} 转义后的安全文本
         */
        escapeHtml(text) {
            if (!text) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
    };

})(typeof window !== 'undefined' ? window : this);
