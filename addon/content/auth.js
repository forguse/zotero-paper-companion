/* SPDX-License-Identifier: MIT */
(function (root) {
  "use strict";
  const C = root.PCore || (typeof require === "function" ? require("./core.js") : null);
  class ChatGPTAuth {
    constructor(env) { this.env = env; this.refreshing = new Map(); }
    random(bytes = 32) { return C.base64url(this.env.crypto.getRandomValues(new Uint8Array(bytes))); }
    async discovery(signal) {
      const d = await this.env.json(C.ISSUER + "/.well-known/openid-configuration", { signal });
      if (d.issuer !== C.ISSUER) throw new Error("OpenAI 授权来源校验失败。");
      for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"]) {
        if (new URL(d[field]).origin !== C.ISSUER) throw new Error("OpenAI 授权地址校验失败。");
      }
      if (d.revocation_endpoint && new URL(d.revocation_endpoint).origin !== C.ISSUER) throw new Error("退出授权地址校验失败。");
      return d;
    }
    async login(accountID, signal) {
      const meta = await this.env.readMeta();
      const secrets = await this.env.readSecrets();
      const previous = accountID ? secrets.openai?.[accountID] : null;
      const known = accountID ? meta.accounts.find(a => a.clientID === accountID) : null;
      const discovery = await this.discovery(signal);
      const callback = this.env.createCallback(signal);
      const verifier = this.random(48);
      const challenge = C.base64url(new Uint8Array(await this.env.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const transaction = { redirectURI: callback.redirectURI, clientID: known?.clientID, state: this.random(), nonce: this.random(), expiresAt: Date.now() + 300000 };
      const url = new URL(discovery.authorization_endpoint);
      const params = { client_id: known?.clientID || "dynamic_agent_client", ext_agent_host_id: meta.hostID,
        redirect_uri: transaction.redirectURI, response_type: "code", scope: C.SCOPES, resource: C.OPENAI,
        state: transaction.state, nonce: transaction.nonce, code_challenge: challenge, code_challenge_method: "S256" };
      if (!known) params.agent_name_hint = "Paper Companion";
      if (previous?.id_token) params.id_token_hint = previous.id_token;
      else if (known?.email) params.login_hint = known.email;
      // Request consent only when the previously saved registration lacks plan permission.
      if (known && previous && !previous.scopes?.includes("chatgpt.tokens.use.direct")) params.prompt = "consent";
      url.search = new URLSearchParams(params).toString();
      let result;
      try {
        const incoming = callback.wait(transaction);
        this.env.launch(url.href);
        result = await incoming;
      } finally { callback.close(); }
      const token = await this.env.form(discovery.token_endpoint, {
        grant_type: "authorization_code", client_id: result.clientID, code: result.code,
        code_verifier: verifier, redirect_uri: transaction.redirectURI, resource: C.OPENAI
      }, signal);
      if (signal.aborted) throw new Error("已取消连接。");
      if (!token.id_token) throw new Error("授权未返回身份令牌。");
      const jwks = await this.env.json(discovery.jwks_uri, { signal });
      const identity = await C.verifyIDToken(token.id_token, jwks, { clientID: result.clientID, nonce: transaction.nonce, subject: known?.subject }, this.env.crypto);
      const record = this.record(token, null);
      await this.env.setAccount({ clientID: result.clientID, subject: identity.sub, email: identity.email || "ChatGPT 账号", name: identity.name || "" }, record);
      if (!record.scopes.includes("chatgpt.tokens.use.direct")) throw new Error("已登录，但未获准使用 ChatGPT 套餐。请重新授权套餐使用权限，或检查账号是否支持。");
      return { clientID: result.clientID, token: record.access_token };
    }
    record(token, old) {
      if (!token.access_token || token.token_type?.toLowerCase() !== "bearer" || !Number.isFinite(token.expires_in) || token.expires_in <= 0) throw new Error("授权响应不完整。");
      return { access_token: token.access_token, refresh_token: token.refresh_token || old?.refresh_token,
        id_token: token.id_token || old?.id_token, scopes: token.scope ? token.scope.split(/\s+/).filter(Boolean) : old?.scopes || [],
        expiresAt: Date.now() + token.expires_in * 1000, earliestRefreshAt: token.earliest_refresh_at || null };
    }
    async access(accountID, signal) {
      const secrets = await this.env.readSecrets();
      const r = secrets.openai?.[accountID];
      if (!r?.scopes?.includes("chatgpt.tokens.use.direct")) throw new Error("请先点击“重新授权”，允许使用 ChatGPT 套餐。");
      if (r.access_token && r.expiresAt > Date.now() + 30000) return r.access_token;
      if (!r.refresh_token) throw new Error("登录已过期，请点击“重新授权”。");
      if (!this.refreshing.has(accountID)) {
        const task = this.refresh(accountID, r, signal).finally(() => this.refreshing.delete(accountID));
        this.refreshing.set(accountID, task);
      }
      return this.refreshing.get(accountID);
    }
    async refresh(accountID, old, signal) {
      try {
        const token = await this.env.form(C.ISSUER + "/api/accounts/oauth/token", {
          grant_type: "refresh_token", client_id: accountID, refresh_token: old.refresh_token, resource: C.OPENAI
        }, signal);
        const record = this.record(token, old);
        if (!record.scopes.includes("chatgpt.tokens.use.direct")) throw new Error("套餐使用授权已失效，请重新授权。");
        if (token.id_token) {
          const meta = await this.env.readMeta();
          const account = meta.accounts.find(a => a.clientID === accountID);
          const discovery = await this.discovery(signal);
          const jwks = await this.env.json(discovery.jwks_uri, { signal });
          await C.verifyIDToken(token.id_token, jwks, { clientID: accountID, subject: account?.subject }, this.env.crypto);
        }
        // Persist a rotated refresh token before any subsequent requests use it.
        await this.env.setToken(accountID, record);
        return record.access_token;
      } catch (e) {
        if (["invalid_grant", "invalid_refresh_token", "token_expired", "refresh_token_expired", "refresh_token_invalidated", "refresh_token_reused"].includes(e.code)) {
          await this.env.setToken(accountID, null);
          throw new Error("登录授权已过期或被撤销，请点击“重新授权”。");
        }
        throw e;
      }
    }
    async logout(accountID, signal) {
      const secrets = await this.env.readSecrets();
      const record = secrets.openai?.[accountID];
      let warning = "";
      if (record?.refresh_token) {
        try {
          const d = await this.discovery(signal);
          if (!d.revocation_endpoint) throw new Error("未发现撤销接口");
          await this.env.form(d.revocation_endpoint, { token: record.refresh_token, token_type_hint: "refresh_token", client_id: accountID }, signal, true);
        } catch (_) { warning = "本机已退出；远端撤销未确认。可在 ChatGPT 设置中断开此应用。"; }
      }
      await this.env.setToken(accountID, null);
      return warning || "已退出当前账号，下次需要重新授权。";
    }
  }
  root.ChatGPTAuth = ChatGPTAuth;
  if (typeof module !== "undefined") module.exports = ChatGPTAuth;
})(this);
