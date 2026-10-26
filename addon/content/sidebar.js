/* SPDX-License-Identifier: MIT */
var PCSidebar = class {
  constructor(api) { this.api = api; this.frames = new Set(); this.fitters = new Map(); this.focused = new Set(); this.schedules = new Map(); }
  init() {
    const mount = props => this.mount(props);
    this.id = Zotero.ItemPaneManager.registerSection({
      paneID: "paper-companion", pluginID,
      header: { l10nID: "paper-companion-section", icon: rootURI + "content/icon.svg" },
      sidenav: { l10nID: "paper-companion-section", icon: rootURI + "content/icon.svg" },
      onRender: mount,
      onItemChange: ({ setEnabled, tabType }) => { setEnabled(["reader", "pdf"].includes(tabType)); return true; },
      onDestroy: ({ body }) => { const f = body.querySelector("iframe"); if (f) { this.fitters.get(f)?.(); this.fitters.delete(f); this.frames.delete(f); } }
    });
  }
  mount({ body, item, tabType }) {
    if (!["reader", "pdf"].includes(tabType)) return;
    const details = body.closest("item-details");
    const ownerReader = Zotero.Reader.getByTabID(details?.tabID || details?.dataset?.tabId);
    const readerID = ownerReader?.itemID || (item?.isPDFAttachment?.() ? item.id : null);
    let frame = body.querySelector("iframe");
    if (!frame) {
      body.style.cssText = "box-sizing:border-box;padding:0;width:100%;max-width:100%;min-width:0;height:calc(100vh - 180px);min-height:160px;overflow:hidden;";
      frame = body.ownerDocument.createElementNS("http://www.w3.org/1999/xhtml", "iframe");
      frame.className = "paper-companion-sidebar";
      frame.setAttribute("aria-label", "论文伴读");
      frame.style.cssText = "box-sizing:border-box;width:100%;max-width:100%;height:100%;border:0;display:block;min-width:0;";
      frame.paperCompanionArgs = { api: this.api, embedded: true, readerID };
      frame.setAttribute("src", this.api.resourceURL('panel.xhtml'));
      this.frames.add(frame); body.append(frame);
      this.fitToContent(body, frame);
    } else if (readerID && frame.paperCompanionArgs.readerID !== readerID) {
      frame.paperCompanionArgs.readerID = readerID;
      if (frame.contentWindow?.document?.body?.dataset?.ready === 'true') {
        this.api.activatePanel(frame.contentWindow, { readerID }).catch(e => this.api.emit('error', { message: PCore.safeError(e.message) }));
      }
    }
  }
  fitToContent(body, frame) {
    const win = body.ownerDocument.defaultView;
    const rail = body.ownerDocument.getElementById('zotero-context-pane-sidenav');
    const details = body.closest?.('item-details'), pane = body.closest?.('item-pane-custom-section');
    const viewport = details?.querySelector('#zotero-view-item'), header = details?.querySelector('item-pane-header');
    let savedDisplay = null;
    const restoreHeader = () => {
      if (!savedDisplay || !header) return;
      if (savedDisplay.value) header.style.setProperty('display', savedDisplay.value, savedDisplay.priority); else header.style.removeProperty('display');
      savedDisplay = null;
    };
    let queued = 0;
    const fit = () => {
      queued = 0;
      if (!frame.isConnected) { restoreHeader(); return; }
      let host = body.getBoundingClientRect(); const nav = rail?.getBoundingClientRect();
      const bounds = viewport?.getBoundingClientRect(), section = pane?.getBoundingClientRect();
      const active = this.focused.has(frame) && bounds?.height > 0 && pane?.open !== false && section?.top <= bounds.top + 80 && host.top < bounds.bottom && host.bottom > bounds.top + 40;
      if (active && header) {
        savedDisplay ||= { value: header.style.getPropertyValue('display'), priority: header.style.getPropertyPriority('display') };
        if (header.style.getPropertyValue('display') !== 'none') header.style.setProperty('display', 'none', 'important');
      } else restoreHeader();
      host = body.getBoundingClientRect();
      if (!host.width) return;
      let width = Math.min(body.clientWidth, host.width);
      // Some native layouts put the right navigation rail over the content box.
      // Measure its actual edge instead of subtracting an assumed icon-bar width.
      if (nav?.width && nav.left > host.left && nav.left < host.right && nav.bottom > host.top && nav.top < host.bottom) width = Math.min(width, nav.left - host.left);
      const value = Math.max(0, Math.floor(width)) + 'px';
      if (frame.style.maxWidth !== value) frame.style.maxWidth = value;
      const currentBounds = viewport?.getBoundingClientRect();
      if (currentBounds?.height > 0 && host.top >= currentBounds.top - 8 && host.top < currentBounds.bottom) {
        // The native custom section can inset its iframe. Size from the actual
        // frame edge so that inset cannot push the composer below the viewport.
        const top = frame.getBoundingClientRect?.().top ?? host.top;
        const height = Math.max(160, Math.floor(Math.min(win.innerHeight, currentBounds.bottom) - top - 4)) + 'px';
        if (body.style.height !== height) body.style.height = height;
      }
    };
    // Zotero can suspend animation frames in a background reader. Layout must
    // still settle before that reader is shown again, including icon-rail moves.
    const schedule = () => { if (!queued) queued = win.setTimeout(fit, 0); };
    const observer = new win.ResizeObserver(schedule);
    observer.observe(body); if (rail) observer.observe(rail); if (viewport) observer.observe(viewport);
    win.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule, { passive:true });
    const mutation = pane && new win.MutationObserver(schedule);
    mutation?.observe(pane, { attributes:true, attributeFilter:['open','hidden','collapsed'] });
    this.schedules.set(frame, schedule);
    this.fitters.set(frame, () => { restoreHeader(); observer.disconnect(); mutation?.disconnect(); win.removeEventListener('resize', schedule); viewport?.removeEventListener('scroll', schedule); this.schedules.delete(frame); this.focused.delete(frame); if (queued) win.clearTimeout(queued); });
    fit();
  }
  setReadingFocus(panel, enabled) {
    const frame = panel.frameElement;
    if (!this.frames.has(frame)) return;
    if (enabled) this.focused.add(frame); else this.focused.delete(frame);
    this.schedules.get(frame)?.();
  }
  async open(action) {
    const win = Zotero.getMainWindow(), doc = win?.document;
    const context = doc?.getElementById("zotero-context-pane-inner") || doc?.querySelector("context-pane");
    const reader = action?.readerID ? this.api.allReaders().find(r => r.itemID === action.readerID) : this.api.followCurrentReader();
    if (!context || !reader) return false;
    if (reader.tabID && win.Zotero_Tabs.selectedID !== reader.tabID) win.Zotero_Tabs.select(reader.tabID);
    if (win.ZoteroContextPane) win.ZoteroContextPane.collapsed = false;
    context.collapsed = false;
    context.mode = "item";
    for (let i = 0; i < 40; i++) {
      const container = context.sidenav?.container;
      if (container) {
        await container.render();
        const pane = container.getPane?.(this.id);
        if (pane) {
          pane.open = true;
          await container.scrollToPane(this.id, "instant");
          const frame = pane.querySelector("iframe");
          if (frame?.contentWindow?.document?.body?.dataset?.ready === "true") {
            this.api.panel = frame.contentWindow;
            await this.api.activatePanel(frame.contentWindow, action);
            return true;
          }
        }
      }
      await Zotero.Promise.delay(50);
    }
    return false;
  }
  destroy() { for (const dispose of this.fitters.values()) dispose(); this.fitters.clear(); Zotero.ItemPaneManager.unregisterSection(this.id); this.frames.clear(); }
};
