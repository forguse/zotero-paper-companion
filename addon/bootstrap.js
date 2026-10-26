/* SPDX-License-Identifier: MIT */
var chromeHandle;
var companionScope;

async function startup({ id, version, rootURI }) {
  // Gecko retains chrome styles/scripts across restartless add-on upgrades.
  // A versioned package gives each complete UI document a fresh resource graph.
  const uiPackage = 'paper-companion-ui-' + version.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const aom = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(Ci.amIAddonManagerStartup);
  chromeHandle = aom.registerChrome(Services.io.newURI(rootURI + "manifest.json"), [
    ["content", "paper-companion", "content/"],
    ["content", uiPackage, "content/"]
  ]);
  Components.utils.importGlobalProperties(["URL", "URLSearchParams", "TextEncoder", "TextDecoder", "crypto", "btoa", "atob", "AbortController"]);
  companionScope = { Zotero, Services, Cc, Ci, Cu: Components.utils, ChromeUtils, IOUtils, PathUtils,
    URL, URLSearchParams, TextEncoder, TextDecoder, crypto, btoa, atob, AbortController, XMLHttpRequest,
    rootURI, uiRootURI: 'chrome://' + uiPackage + '/content/', pluginID: id, pluginVersion: version };
  for (const file of ["math.js", "core.js", "persistence.js", "sessions.js", "ui.js", "edge-light.js", "appearance.js", "usage-store.js", "usage.js", "auth.js", "model-gateway.js", "reading-scope.js", "chat-service.js", "note-insertions.js", "uninstall-service.js", "sidebar.js", "webview.js", "paper-files.js", "insights.js", "formula.js", "reading.js", "preread.js", "vocabulary.js", "native.js"]) {
    Services.scriptloader.loadSubScript(rootURI + "content/" + file, companionScope);
  }
  await companionScope.PaperCompanion.init();
  Zotero.PaperCompanion = companionScope.PaperCompanion;
  for (const window of Zotero.getMainWindows()) companionScope.PaperCompanion.addWindow(window);
}

function onMainWindowLoad({ window }) { companionScope?.PaperCompanion?.addWindow(window); }
function onMainWindowUnload({ window }) { companionScope?.PaperCompanion?.removeWindow(window); }

async function shutdown() {
  if (companionScope?.PaperCompanion) await companionScope.PaperCompanion.shutdown();
  if (typeof Zotero !== "undefined") delete Zotero.PaperCompanion;
  companionScope = null;
  chromeHandle?.destruct();
  chromeHandle = null;
}
function install() {}
function uninstall() {} // User notes and saved credentials are never deleted by uninstall.
