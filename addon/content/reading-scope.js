/* SPDX-License-Identifier: MIT — pure descriptions of planned and prepared reading context. */
var PCReadingScope = (function (Core) {
  const label = (value, fallback = '') => typeof value === 'string' ? value.replace(/[\r\n]+/g, ' ').slice(0, 320) : fallback;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  function selection({ key = 'general', smartReading = false, context = null, ids = [], includePrimary } = {}) {
    if (!Array.isArray(ids) || ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) throw new Error('对比论文标识无效，请重新选择。');
    const hasPaper = key !== 'general' && !!key, comparisonIDs = hasPaper ? [...new Set(ids.map(Number))] : [];
    const primary = hasPaper && (includePrimary === true || includePrimary !== false && !context && (smartReading || comparisonIDs.length > 0));
    return { shouldPrepare: hasPaper && (primary || comparisonIDs.length > 0), includePrimary: !!primary, comparisonIDs };
  }
  function material(value, historical = false) {
    if (!value) return null;
    const images = Array.isArray(value.images) ? value.images.length : value.image ? 1 : 0;
    let kind, name;
    if (value.file) { kind = 'pdf'; name = 'PDF 原件'; }
    else if (historical && value.mode === 'pdf') { kind = 'history-note'; name = '历史文字说明（PDF 未重传）'; }
    else if (historical && value.mode === 'screenshot' && !images) { kind = 'history-note'; name = '历史文字说明（截图未重传）'; }
    else if (value.mode === 'pdf') { kind = 'pdf'; name = 'PDF 原件'; }
    else if (value.mode === 'screenshot') { kind = 'screenshot'; name = '区域截图'; }
    else if (images) { kind = 'page-images'; name = '页图' + (value.text ? '＋提取文字' : ''); }
    else if (value.mode === 'reading') { kind = 'retrieved'; name = '已选原文节选'; }
    else { kind = 'text'; name = '文字选段'; }
    return { kind, name, label: label(value.label, name), imageCount: images, file: !!value.file };
  }
  function history({ provider, model, context, session }) {
    // The website owns its conversation; local API history cannot establish it.
    if (provider === 'chatgpt-web' || !session) return { messages: null, materials: [], notice: '' };
    const messages = (session.messages || []).filter(message => ['user', 'assistant'].includes(message.role) && !['failed', 'cancelled', 'pending'].includes(message.status));
    const projected = provider === 'deepseek' ? Core.deepseekHistory({ model, context, history: messages, materials: session.materials || {} }) : { materials: session.materials || {}, notice: '' };
    const seen = new Set(), materials = [];
    for (const message of messages) {
      const value = projected.materials[message.materialID];
      if (!value || context && (value === context || value.id && value.id === context.id)) continue;
      const id = value.id || message.materialID; if (seen.has(id)) continue; seen.add(id); materials.push(material(value, true));
    }
    return { messages: messages.length, materials, notice: projected.notice };
  }
  function coverageRows(evidence) {
    return (Array.isArray(evidence?.coverage) ? evidence.coverage : []).map(row => ({ paperID: count(row.paperID), title: label(row.title, '所选论文'),
      kind: ['full-text', 'lexical', 'overview'].includes(row.kind) ? row.kind : 'unknown', brief: row.brief === true, webContext: row.webContext === true,
      zeroMatches: row.zeroMatches === true, characters: count(row.characters), snippets: count(row.snippets) }));
  }
  function describe(input = {}) {
    const { key = 'general', provider = '', model = '', context = null, session = null, evidence = null, preread = null } = input;
    const phase = ['planned', 'prepared', 'draft'].includes(input.phase) ? input.phase : 'planned', planned = phase === 'planned', webDraft = provider === 'chatgpt-web';
    const selected = selection(input), manual = material(context), old = history({ provider, model, context, session }), coverage = coverageRows(evidence);
    const references = Array.isArray(evidence?.references) ? evidence.references : [], actualIDs = new Set([...coverage.map(row => row.paperID), ...references.map(row => row?.paperID)].filter(id => id !== null && id !== undefined));
    const actualComparisons = selected.comparisonIDs.filter(id => actualIDs.has(id));
    let primaryActual = null;
    if (!planned) {
      if (!evidence) primaryActual = false;
      else if (references.some(row => row?.key === key) || count(input.paperID) !== null && actualIDs.has(input.paperID)) primaryActual = true;
      else if (!selected.includePrimary || references.some(row => typeof row?.key === 'string') || count(input.paperID) !== null && actualIDs.size > 0) primaryActual = false;
    }
    const briefUsed = !planned && coverage.some(row => row.brief), briefAvailable = preread?.state === 'ready';
    const sources = { manual: !!manual, manualKind: manual?.kind || null, primaryRequested: selected.includePrimary, primaryActual,
      comparisonIDs: [...selected.comparisonIDs], actualComparisonIDs: actualComparisons, preread: briefUsed ? 'used' : planned && selected.includePrimary && briefAvailable ? 'available' : planned && selected.includePrimary && !preread ? 'unknown' : 'not-used',
      historyMessages: old.messages, historyMaterials: old.messages === null ? null : old.materials.length };
    const parts = [], details = [], warnings = [], action = planned ? '计划提供' : webDraft ? '本机草稿包含' : '本轮请求包含';
    if (manual) {
      parts.push('手动' + manual.name); details.push(`${action}手动材料：${manual.label}。`);
      if (planned && context.mode === 'pdf' && !context.file) warnings.push('PDF 附件内容尚未就绪，发送前需要核对。');
      if (planned && provider === 'deepseek' && manual.file) warnings.push('DeepSeek 不接收 PDF 原件，请改为提取文字或页图后再发送；不会自动改用其他模型。');
      if (planned && provider === 'deepseek' && model && model !== 'deepseek-flash' && manual.imageCount) warnings.push('当前 DeepSeek 模型不接收图片，请选择支持图片的模型或改用文字；不会静默丢弃截图。');
    }
    if (planned && selected.includePrimary) {
      parts.push(briefAvailable ? '本篇提要＋原文检索' : '本篇智能检索');
      details.push(briefAvailable ? '本机有可用预读提要；发送时重新核对并结合与问题有关的原文节选。' : '发送时在本机准备本篇原文，再按问题检索；尚未确认本轮具体覆盖的章节。');
      if (preread?.state === 'stale') warnings.push('旧预读提要已失效，本轮不会自动重新调用模型预读。');
      if (preread?.state === 'unchecked') warnings.push('PDF 尚待核对，不能确认已保存的预读提要仍然有效。');
    } else if (!planned && evidence) {
      const primaryRows = coverage.filter(row => !selected.comparisonIDs.includes(row.paperID) || row.paperID === input.paperID);
      if (primaryActual === true) parts.push(primaryRows.some(row => row.brief) ? '本篇提要＋原文节选' : primaryRows.some(row => row.kind === 'full-text') ? '本篇全文文字' : primaryRows.some(row => row.kind === 'overview') ? '本篇概览节选' : primaryRows.some(row => row.kind === 'lexical') ? '本篇检索节选' : '本篇原文材料（范围待核对）');
      else if (primaryActual === null) parts.push('已准备原文材料（范围待核对）');
    }
    if (selected.comparisonIDs.length) {
      const unverified = !planned && !!evidence && !actualIDs.size;
      parts.push(planned ? `另选 ${selected.comparisonIDs.length} 篇对比论文` : unverified ? '对比材料（来源待核对）' : `对比论文 ${actualComparisons.length} 篇`);
      details.push(planned ? `发送时准备另选的 ${selected.comparisonIDs.length} 篇论文，各篇来源分别标注。` : unverified ? '本轮已准备对比材料，但缺少可核对的来源标识，不能确认具体包含哪些论文。' : `本轮原文材料中可核对到 ${actualComparisons.length} 篇选定的对比论文。`);
    }
    for (const row of coverage) {
      const scope = row.kind === 'full-text' ? '可提取的全文文字' : row.kind === 'lexical' ? '问题词汇匹配的节选' : row.kind === 'overview' ? '分散概览节选，并非全文' : '覆盖范围待核对';
      details.push(`${row.title}：${scope}${row.brief ? '＋已有预读提要' : ''}${row.snippets !== null ? `，${row.snippets} 处原文` : ''}${row.characters !== null ? `、${row.characters} 字符` : ''}。`);
      if (row.zeroMatches) warnings.push('原文检索未命中，改用概览节选；不能视为已经覆盖全文。');
    }
    if (briefUsed || planned && selected.includePrimary && briefAvailable) warnings.push('预读提要用于定位和联系上下文，不是模型永久记忆全文；本轮仍以实际提供的原文为准。');
    if (!selected.includePrimary && briefAvailable) details.push('本机虽有预读提要，本轮未选择额外读取本篇；不会自动把整篇论文加入材料。');
    if (manual && !selected.includePrimary) details.push('手动材料默认不额外读取本篇；可明确选择同时参考本篇提要和原文检索。');
    if (key === 'general' && input.ids?.length) warnings.push('当前未选择论文，本轮不会自动读取先前的对比选择。');
    if (old.messages !== null) {
      if (old.messages) details.push(`${action}既有会话中 ${old.messages} 条有效文字消息；失败、取消和未完成的回答不作为上下文。`);
      if (old.materials.length) details.push(`${action}既有会话材料 ${old.materials.length} 份：${old.materials.map(item => item.name).join('、')}。`);
    } else if (!webDraft) details.push('既有会话尚待核对；当前说明不代表历史材料已经确认。');
    for (const notice of [old.notice, input.notice]) if (notice) warnings.push(label(notice));
    if (!parts.length) parts.push(webDraft ? '网页问题草稿（未附加新材料）' : old.materials.length ? `既有会话材料 ${old.materials.length} 份` : old.messages ? '连续问答（已有文字上下文）' : old.messages === null ? '当前问题＋会话待核对' : '纯聊天（未附加论文材料）');
    if (webDraft) warnings.unshift(phase === 'draft' ? '网页草稿尚未发送；请核对附件后在网页发送，不代表网页模型已经读取。' : '将传入网页草稿，仍需在网页确认附件并发送；网站现有上下文由网站管理。');
    return { version: 1, phase, label: parts.join(' · '), details, warnings: [...new Set(warnings)], selection: selected, sources, coverage, webDraft };
  }
  return Object.freeze({ selection, describe });
})(typeof PCore !== 'undefined' ? PCore : require('./core.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = PCReadingScope;
