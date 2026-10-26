/* SPDX-License-Identifier: MIT — model protocols behind explicit, metered platform ports. */
var PCModelGateway = (function (C) {
  class ModelGateway {
    constructor({ connection, readDeepseekKey, accessToken, request }) {
      this.ports = { connection, readDeepseekKey, accessToken, request };
      for (const [name, port] of Object.entries(this.ports)) if (typeof port !== 'function') throw new TypeError('Missing model port: ' + name);
      this.snapshots = new WeakSet();
    }
    snapshot(config) {
      if (config && this.snapshots.has(config)) return config;
      const connection = this.ports.connection(), found = connection.models?.find(model => model.id === config?.model);
      const modelInfo = found ? Object.freeze({ id: found.id,
        reasoningEfforts: Array.isArray(found.reasoningEfforts) ? Object.freeze(found.reasoningEfforts.slice()) : undefined,
        inputModalities: Array.isArray(found.inputModalities) ? Object.freeze(found.inputModalities.slice()) : undefined }) : null;
      const selection = Object.freeze({ provider: config?.provider, model: config?.model, effort: config?.effort ?? 'default',
        account: connection.active, epoch: connection.epoch, modelInfo });
      this.snapshots.add(selection); return selection;
    }
    check(selection, signal) {
      if (signal?.aborted) throw new Error('已取消请求。');
      const current = this.ports.connection();
      if (current.closing) throw new Error('插件正在关闭，请稍后重新打开。');
      if (selection.provider === 'deepseek') {
        if (!['deepseek-flash', 'deepseek-v4-pro'].includes(selection.model)) throw new Error('请选择 DeepSeek Flash 或 Pro。');
        return;
      }
      if (selection.provider !== 'chatgpt') throw new Error('请选择 DeepSeek 或 ChatGPT 授权引擎。');
      if (current.state !== 'online') throw new Error('请先手动连接 ChatGPT 授权；不会自动登录或切换到其他引擎。');
      if (current.epoch !== selection.epoch || current.active !== selection.account) throw new Error('ChatGPT 连接或账号已改变，请重新发起请求。');
      if (!selection.model || !selection.modelInfo) throw new Error('请为此功能单独选择一个已授权的 ChatGPT 模型。');
    }
    async available(config) {
      const selection = this.snapshot(config); this.check(selection);
      if (selection.provider === 'deepseek') {
        const key = await this.ports.readDeepseekKey(); this.check(selection);
        if (!key) throw new Error('请在设置中填写 DeepSeek API Key；不会自动改用其他引擎。');
      }
      return true;
    }
    async open(config, signal) {
      const selection = this.snapshot(config); this.check(selection, signal);
      const token = selection.provider === 'deepseek'
        ? await this.ports.readDeepseekKey() : await this.ports.accessToken(selection.account, signal);
      this.check(selection, signal);
      if (!token) throw new Error(selection.provider === 'deepseek' ? '请在设置中填写 DeepSeek API Key；不会自动改用其他引擎。' : 'ChatGPT 授权不可用，请重新授权。');
      const send = (body, streaming, callbacks = {}) => {
        this.check(selection, signal);
        const { onDelta, onModel, usageFeature = 'summary', usageKey = '' } = callbacks;
        let lastModel;
        const observe = value => {
          const model = value?.response?.model ?? value?.model;
          if (typeof model === 'string' && model.trim() && model.length <= 160 && model !== lastModel) { lastModel = model; onModel?.(model); }
        };
        const collector = streaming ? (selection.provider === 'deepseek' ? C.deepseekCollector : C.responsesCollector)(onDelta, observe) : null;
        return this.ports.request(selection.provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : C.OPENAI + '/responses', {
          method: 'POST', provider: selection.provider === 'deepseek' ? 'DeepSeek' : 'ChatGPT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body, signal,
          ...(streaming ? { onChunk: chunk => collector.parser.push(chunk) } : {})
        }, { provider: selection.provider, feature: usageFeature, paperKey: usageKey }).then(response => {
          this.check(selection, signal);
          if (streaming) return collector.finish();
          observe(response);
          const choice = response?.choices?.[0];
          if (choice?.finish_reason !== 'stop' || !choice.message?.content) throw new Error('DeepSeek 未返回完整结果，请缩短内容或调整模型后重试。');
          onDelta?.(choice.message.content); return choice.message.content;
        });
      };
      const prepare = options => {
        this.check(selection, signal);
        if (selection.provider === 'chatgpt') {
          if (!C.reasoningEfforts(selection.model, selection.modelInfo?.reasoningEfforts).includes(selection.effort)) throw new Error('当前模型不支持已选推理强度，请重新选择；不会自动降低强度。');
          if (options.context?.mode === 'screenshot' && !selection.modelInfo?.inputModalities?.includes('image')) throw new Error('当前 ChatGPT 模型未声明图片能力，请选择支持图片的模型后再发送截图。');
        }
        const captured = { ...options, model: selection.model, effort: selection.provider === 'chatgpt' ? selection.effort : 'default' };
        const notice = selection.provider === 'deepseek' ? C.deepseekHistory(captured).notice : '';
        const body = JSON.stringify(selection.provider === 'deepseek' ? C.deepseekBody(captured) : C.responsesBody(captured));
        let running;
        return Object.freeze({ notice, run: callbacks => {
          if (!running) running = Promise.resolve().then(() => send(body, true, { usageFeature: 'chat', ...callbacks }));
          return running;
        } });
      };
      return Object.freeze({ prepare, chat: (options, callbacks) => prepare(options).run(callbacks),
        generate: (options, callbacks) => {
          const { instructions, text, images = [], maxTokens = 8192 } = options;
          if (images.length && selection.provider === 'deepseek' && selection.model !== 'deepseek-flash') throw new Error('图片识别需要 DeepSeek Flash；不会自动切换模型。');
          let body;
          if (selection.provider === 'deepseek') {
            if (!['none', 'low', 'high', 'max'].includes(selection.effort)) throw new Error('无效的 DeepSeek 思考强度。');
            if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32768) throw new Error('无效的最大输出长度。');
            const content = images.length ? [{ type: 'text', text }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : text;
            body = { model: selection.model, messages: [{ role: 'system', content: instructions }, { role: 'user', content }], stream: false,
              max_tokens: selection.effort === 'none' ? maxTokens : 32768, thinking: { type: selection.effort === 'none' ? 'disabled' : 'enabled' } };
            if (selection.effort !== 'none') body.reasoning_effort = selection.effort;
          } else {
            if (!['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(selection.effort)) throw new Error('无效的 ChatGPT 思考强度。');
            body = C.responsesBody({ model: selection.model, history: [], prompt: text,
              context: images.length ? { title: '公式截图', label: '公式识别', text: '', images } : null });
            body.instructions = instructions;
            if (selection.effort !== 'default') body.reasoning = { effort: selection.effort };
          }
          return send(JSON.stringify(body), selection.provider === 'chatgpt', callbacks);
        } });
    }
    async generate(options) {
      const captured = { ...options, ...(options.images ? { images: options.images.slice() } : {}) };
      const selection = this.snapshot(captured.selection || captured);
      for (const name of ['provider', 'model', 'effort']) if (captured[name] !== undefined && captured[name] !== selection[name]) throw new Error('模型快照与请求配置不一致，请重新发起请求。');
      // Fail incompatible image selections before requesting or refreshing credentials.
      if (captured.images?.length && selection.provider === 'deepseek' && selection.model !== 'deepseek-flash') throw new Error('图片识别需要 DeepSeek Flash；不会自动切换模型。');
      const channel = await this.open(selection, captured.signal);
      return channel.generate(captured, captured);
    }
  }
  return ModelGateway;
})(typeof PCore !== 'undefined' ? PCore : require('./core.js'));
if (typeof module !== 'undefined') module.exports = PCModelGateway;
