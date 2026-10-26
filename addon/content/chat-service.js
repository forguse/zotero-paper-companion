/* SPDX-License-Identifier: MIT — conversation orchestration with explicit platform ports. */
var PCChatService = (function (PCore, ReadingScope) { return class {
  constructor(ports) { this.ports = ports; this.busy = false; this.controller = null; this.completion = null; }
  guard(ownTask = false) {
    const state = this.ports.runtime();
    if (state.closing) throw new Error('插件正在关闭，请稍后重新打开。');
    if (state.changing) throw new Error('正在切换历史对话，请稍后提问。');
    if (this.busy && !ownTask) throw new Error('请等待当前回答完成，或点击停止。');
    return state;
  }
  async ask(key, prompt, context, onDelta, readingOptions = {}) {
    const state = this.guard(), config = { ...state.settings }, provider = config.chatProvider;
    if (!['chatgpt', 'deepseek'].includes(provider)) throw new Error('请先选择问答引擎。');
    if (provider === 'chatgpt' && !state.online) throw new Error('请先连接 ChatGPT。');
    const model = provider === 'deepseek' ? config.chatDeepseekModel : config.model;
    const modelInfo = state.models.find(m => m.id === model);
    if (provider === 'chatgpt' && !PCore.reasoningEfforts(model, modelInfo?.reasoningEfforts).includes(config.chatGPTEffort)) throw new Error('当前模型不支持已选推理强度，请重新选择；不会自动降低强度。');
    if (context?.mode === 'screenshot' && provider === 'chatgpt' && !modelInfo?.inputModalities?.includes('image')) throw new Error('当前 ChatGPT 模型未声明图片能力，请选择支持图片的模型后再发送截图。');
    if (state.prereading) throw new Error('请先停止论文预读，再提问。');
    const selection = this.ports.snapshotModel({ provider, model, effort: provider === 'chatgpt' ? config.chatGPTEffort : 'default' });
    const optionsSnapshot = { ...readingOptions, ...(readingOptions.ids ? { ids: [...readingOptions.ids] } : {}) };
    const scopeInput = { key, provider, model, smartReading: !!config.smartReading, context, ids: optionsSnapshot.ids || [], includePrimary: optionsSnapshot.includePrimary };
    const reading = ReadingScope.selection(scopeInput);
    let finishChat;
    const settled = new Promise(resolve => { finishChat = resolve; }); this.completion = settled;
    const controller = new AbortController(); this.controller = controller; this.busy = true; this.ports.emit('busy');
    let user, answer;
    try {
      const session = await this.ports.session(key);
      if (controller.signal.aborted) throw new Error('已停止。');
      if (this.guard(true).prereading) throw new Error('请先停止论文预读，再提问。');
      const historySize = session.messages.reduce((n, m) => n + (m.text?.length || 0), 0);
      if (historySize + (context?.text?.length || 0) + prompt.length > 300000) throw new Error('本次对话过长，请新建对话。本版不会静默丢弃历史。');
      const channel = await this.ports.openModel(selection, controller.signal);
      let evidence;
      if (reading.shouldPrepare) {
        const previous = [...session.messages].reverse().find(m => m.role === 'user' && m.status === 'complete');
        const query = prompt + (prompt.length < 45 && previous ? '\n' + previous.text.slice(0, 1200) : '');
        evidence = await this.ports.prepare(key, query, { ...optionsSnapshot, signal: controller.signal, first: !context && !session.messages.some(m => m.status === 'complete'), includePrimary: reading.includePrimary });
      }
      if (controller.signal.aborted) throw new Error('已停止。');
      session.materials ||= {};
      const nextMaterials = context ? { ...session.materials, [context.id]: context } : session.materials;
      const materialSize = Object.values(nextMaterials).reduce((n, c) => n + (c.text?.length || 0), 0);
      if (materialSize + historySize + prompt.length + (evidence?.text.length || 0) > 350000) throw new Error('已附加的材料与对话过长，请新建对话再附加需要的材料。');
      const request = channel.prepare({ model, context, evidence, history: session.messages, materials: nextMaterials, prompt, effort: provider === 'chatgpt' ? config.chatGPTEffort : 'default' });
      const readingScope = ReadingScope.describe({ ...scopeInput, phase: 'prepared', session: { ...session, materials: nextMaterials }, evidence, notice: request.notice });
      session.materials = nextMaterials; if (context) session.lastContextID = context.id;
      user = { role: 'user', text: prompt, status: 'pending', at: Date.now(), context: [context?.label, evidence?.label, request.notice].filter(Boolean).join(' · '), materialID: context?.id, readingScope };
      answer = { role: 'assistant', provider, model, text: '', status: 'pending', at: Date.now(), references: evidence?.references || [], coverage: evidence?.coverage || [], readingScope };
      session.messages.push(user, answer); this.ports.emit('readingScope', { key, scope: readingScope, at: answer.at }); onDelta?.('');
      const text = await request.run({ onDelta: text => { answer.text = text; onDelta?.(text); }, onModel: model => { answer.model = model; }, usageFeature: 'chat', usageKey: key });
      if (controller.signal.aborted) throw new Error('已停止。');
      answer.text = this.ports.cite(text, answer.references);
      if (provider === 'chatgpt') this.ports.verified();
      user.status = answer.status = 'complete';
      if (config.autoRecord && key !== 'general') {
        try { await this.ports.record(key, prompt, answer.text); }
        catch (error) { this.ports.emit('error', { message: '回答已完成，自动记录失败：' + PCore.safeError(error.message) }); }
      }
      if (key !== 'general') {
        try { this.ports.organize(key, { question: prompt, answer: answer.text, id: String(answer.at), source: provider, context: user.context }); }
        catch (error) { this.ports.emit('error', { message: '回答已完成，重点整理失败：' + PCore.safeError(error.message) }); }
      }
      return answer.text;
    } catch (error) {
      if (user && answer) { user.status = answer.status = controller.signal.aborted ? 'cancelled' : 'failed'; answer.error = PCore.safeError(error.message); }
      throw error;
    } finally {
      try { if (user && answer) await this.ports.save(key); }
      catch (error) { error.answerComplete = answer?.status === 'complete'; throw error; }
      finally {
        this.busy = false; if (this.controller === controller) this.controller = null; this.ports.emit('busy');
        finishChat(); if (this.completion === settled) this.completion = null;
      }
    }
  }
  stop() { this.controller?.abort(); }
  async drain() { await this.completion; }
}; })(typeof PCore !== 'undefined' ? PCore : require('./core.js'), typeof PCReadingScope !== 'undefined' ? PCReadingScope : require('./reading-scope.js'));
if (typeof module !== 'undefined' && module.exports) module.exports = PCChatService;
