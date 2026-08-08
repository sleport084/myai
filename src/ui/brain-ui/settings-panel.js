import { API } from "./api-client.js";
import { attachJarvisFx, isFxEnabledForVoice, setFxEnabledForVoice, getJarvisFxParams, setJarvisFxParams, resetJarvisFxParams, isFxUnlocked, tryUnlockFx } from "./tts-fx.js";
import { applyOutputSink, listOutputDevices, getOutputPreference, setOutputPreference } from "./audio-output.js";
import { isTTSStreamingEnabled, setTTSStreamingEnabled, activeTTSVoiceId } from "./tts-pipeline.js";
import { initHotspot, toggleHotspot } from "./hotspot.js";
import { initWorldcup } from "./worldcup.js";
import { initVoicePanel } from "./voice-panel.js";

const IGNORED_VERSION_KEY = "xiaobailong_ignored_update_version";
const SUPPRESS_UPDATES_KEY = "xiaobailong_suppress_update_notifications";
const MEMORY_GRAPH_STORAGE_KEY = "xiaobailong-memory-graph-enabled";

// ── TTS settings panel init ──
function initTTSSettings(API) {
  const providerSel  = document.getElementById("tts-provider-select");
  const voiceSel     = document.getElementById("tts-voice-select");
  const testBtn      = document.getElementById("tts-test-btn");
  const testStatus   = document.getElementById("tts-test-status");
  let allVoices      = [];

  function showCredSection(provider) {
    document.querySelectorAll(".tts-cred-section").forEach(el => {
      el.style.display = el.dataset.ttsProvider === provider ? "" : "none";
    });
  }

  function updateVoiceOptions(provider, savedId) {
    const voices = allVoices.filter(v => v.provider === provider);
    voiceSel.innerHTML = voices.map(v => `<option value="${v.id}">${v.label}</option>`).join("");
    if (savedId && voices.some(v => v.id === savedId)) {
      voiceSel.value = savedId;
    }
    syncFxToggle();
  }

  providerSel.addEventListener("change", () => {
    showCredSection(providerSel.value);
    updateVoiceOptions(providerSel.value);
  });

  fetch(`${API}/settings/tts`).then(r => r.json()).then(({ tts, voices }) => {
    if (voices) allVoices = voices;
    const provider = tts?.ttsProvider || "doubao";
    if (tts?.ttsProvider) providerSel.value = tts.ttsProvider;
    else providerSel.value = "doubao";
    updateVoiceOptions(provider, tts?.ttsVoiceId);
    activeTTSVoiceId = voiceSel?.value || tts?.ttsVoiceId || null;
    const appidEl = document.getElementById("tts-volcano-appid");
    if (appidEl && tts?.volcanoAppId?.value) appidEl.value = tts.volcanoAppId.value;
    const doubaoAppIdEl = document.getElementById("tts-doubao-appid");
    if (doubaoAppIdEl && tts?.doubaoAppId?.value) doubaoAppIdEl.value = tts.doubaoAppId.value;
    const doubaoResourceEl = document.getElementById("tts-doubao-resource");
    if (doubaoResourceEl && tts?.doubaoResourceId) doubaoResourceEl.value = tts.doubaoResourceId;
    const doubaoStyleEl = document.getElementById("tts-doubao-style");
    if (doubaoStyleEl && tts?.doubaoStyle) doubaoStyleEl.value = tts.doubaoStyle;
    const rateEl = document.getElementById("tts-doubao-rate");
    if (rateEl) {
      const r = Number(tts?.doubaoSpeechRate || 0) || 0;
      rateEl.value = r;
      const rv = document.getElementById("tts-doubao-rate-val");
      if (rv) rv.textContent = r === 0 ? "正常" : (r > 0 ? "+" + r : String(r));
    }
    const baseurlEl = document.getElementById("tts-openai-baseurl");
    if (baseurlEl && tts?.openaiTtsBaseURL) baseurlEl.value = tts.openaiTtsBaseURL;
    const customUrlEl = document.getElementById("tts-custom-url");
    if (customUrlEl && tts?.customTtsUrl) customUrlEl.value = tts.customTtsUrl;
    const customModelEl = document.getElementById("tts-custom-model");
    if (customModelEl && tts?.customTtsModel) customModelEl.value = tts.customTtsModel;
    showCredSection(provider);
  }).catch(() => {});

  showCredSection(providerSel.value);

  const origSaveBtn = document.getElementById("settings-save-voice");
  if (origSaveBtn) {
    origSaveBtn.addEventListener("click", () => {
      const ttsBody = { ttsProvider: providerSel.value };
      const voiceId  = voiceSel?.value?.trim();
      if (voiceId) { ttsBody.ttsVoiceId = voiceId; activeTTSVoiceId = voiceId; }
      const minimaxKey = document.getElementById("tts-minimax-key")?.value?.trim();
      if (minimaxKey) ttsBody.minimaxKey = minimaxKey;
      const doubaoKey = document.getElementById("tts-doubao-key")?.value?.trim();
      if (doubaoKey) ttsBody.doubaoKey = doubaoKey;
      const doubaoResource = document.getElementById("tts-doubao-resource")?.value?.trim();
      if (doubaoResource) ttsBody.doubaoResourceId = doubaoResource;
      const doubaoStyleEl2 = document.getElementById("tts-doubao-style");
      if (doubaoStyleEl2) ttsBody.doubaoStyle = doubaoStyleEl2.value.trim(); // 空＝清除（回中性）
      const rateEl2 = document.getElementById("tts-doubao-rate");
      if (rateEl2) ttsBody.doubaoSpeechRate = rateEl2.value;
      const doubaoAppId = document.getElementById("tts-doubao-appid")?.value?.trim();
      if (doubaoAppId) ttsBody.doubaoAppId = doubaoAppId;
      const doubaoAccessKey = document.getElementById("tts-doubao-access-key")?.value?.trim();
      if (doubaoAccessKey) ttsBody.doubaoAccessKey = doubaoAccessKey;
      const openaiKey = document.getElementById("tts-openai-key")?.value?.trim();
      if (openaiKey) ttsBody.openaiTtsKey = openaiKey;
      const baseURL = document.getElementById("tts-openai-baseurl")?.value?.trim();
      if (baseURL) ttsBody.openaiTtsBaseURL = baseURL;
      const elevenKey = document.getElementById("tts-elevenlabs-key")?.value?.trim();
      if (elevenKey) ttsBody.elevenLabsKey = elevenKey;
      const volcanoAppId = document.getElementById("tts-volcano-appid")?.value?.trim();
      if (volcanoAppId) ttsBody.volcanoAppId = volcanoAppId;
      const volcanoToken = document.getElementById("tts-volcano-token")?.value?.trim();
      if (volcanoToken) ttsBody.volcanoToken = volcanoToken;
      const customUrl = document.getElementById("tts-custom-url")?.value?.trim();
      if (customUrl) ttsBody.customTtsUrl = customUrl;
      const customKey = document.getElementById("tts-custom-key")?.value?.trim();
      if (customKey) ttsBody.customTtsKey = customKey;
      const customModel = document.getElementById("tts-custom-model")?.value?.trim();
      if (customModel) ttsBody.customTtsModel = customModel;

      fetch(`${API}/settings/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ttsBody),
      }).then(() => {
        ["tts-minimax-key", "tts-doubao-key", "tts-doubao-access-key", "tts-openai-key", "tts-elevenlabs-key", "tts-volcano-token", "tts-custom-key"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
      }).catch(() => {});
    });
  }

  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      if (testStatus) testStatus.textContent = "保存配置中…";
      try {
        const preBody = { ttsProvider: providerSel.value };
        const currentVoice = voiceSel?.value?.trim();
        if (currentVoice) { preBody.ttsVoiceId = currentVoice; activeTTSVoiceId = currentVoice; }
        const minimaxKey2 = document.getElementById("tts-minimax-key")?.value?.trim();
        if (minimaxKey2) preBody.minimaxKey = minimaxKey2;
        const doubaoKey = document.getElementById("tts-doubao-key")?.value?.trim();
        if (doubaoKey) preBody.doubaoKey = doubaoKey;
        const doubaoResource = document.getElementById("tts-doubao-resource")?.value?.trim();
        if (doubaoResource) preBody.doubaoResourceId = doubaoResource;
        const doubaoStyleEl3 = document.getElementById("tts-doubao-style");
        if (doubaoStyleEl3) preBody.doubaoStyle = doubaoStyleEl3.value.trim();
        const rateEl3 = document.getElementById("tts-doubao-rate");
        if (rateEl3) preBody.doubaoSpeechRate = rateEl3.value;
        const doubaoAppId = document.getElementById("tts-doubao-appid")?.value?.trim();
        if (doubaoAppId) preBody.doubaoAppId = doubaoAppId;
        const doubaoAccessKey = document.getElementById("tts-doubao-access-key")?.value?.trim();
        if (doubaoAccessKey) preBody.doubaoAccessKey = doubaoAccessKey;
        const openaiKey = document.getElementById("tts-openai-key")?.value?.trim();
        if (openaiKey) preBody.openaiTtsKey = openaiKey;
        const elevenKey = document.getElementById("tts-elevenlabs-key")?.value?.trim();
        if (elevenKey) preBody.elevenLabsKey = elevenKey;
        const volcanoAppId = document.getElementById("tts-volcano-appid")?.value?.trim();
        if (volcanoAppId) preBody.volcanoAppId = volcanoAppId;
        const volcanoToken = document.getElementById("tts-volcano-token")?.value?.trim();
        if (volcanoToken) preBody.volcanoToken = volcanoToken;
        await fetch(`${API}/settings/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preBody),
        });
        if (testStatus) testStatus.textContent = "合成中…";
        const ttsResp = await fetch(`${API}/tts/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "你好，这是一段语音合成测试，听起来清晰自然吗？" }),
        });
        if (!ttsResp.ok) {
          let errMsg = `合成失败（HTTP ${ttsResp.status}）`;
          try { const j = await ttsResp.json(); errMsg = j.error || errMsg; } catch {}
          if (testStatus) testStatus.textContent = errMsg;
          return;
        }
        const ttsBlob = await ttsResp.blob();
        if (ttsBlob.size === 0) {
          if (testStatus) testStatus.textContent = "合成失败：接口返回空数据，请检查 API Key 和账户配置。";
          return;
        }
        const ttsUrl = URL.createObjectURL(ttsBlob);
        const ttsAudio = new Audio(ttsUrl);
        attachJarvisFx(ttsAudio, voiceSel?.value || activeTTSVoiceId); // 试听按当前选中音色的开关决定是否叠加
        ttsAudio.onended = () => { URL.revokeObjectURL(ttsUrl); if (testStatus) testStatus.textContent = ""; };
        ttsAudio.onerror = () => { URL.revokeObjectURL(ttsUrl); if (testStatus) testStatus.textContent = "播放失败"; };
        await applyOutputSink(ttsAudio).catch(() => {}); // 试听也走同一输出路由
        await ttsAudio.play();
        if (testStatus) testStatus.textContent = "播放中";
        setTimeout(() => { if (testStatus && testStatus.textContent === "播放中") testStatus.textContent = ""; }, 8000);
      } catch {
        if (testStatus) testStatus.textContent = "失败 — 请检查配置和 API Key";
      } finally {
        testBtn.disabled = false;
      }
    });
  }
}

// ── Settings modal ──
export function initSettingsPanel(API) {
  const settingsBtn     = document.getElementById("settings-btn");
  const overlay         = document.getElementById("settings-overlay");
  const closeBtn        = document.getElementById("settings-close");
  const providerSelect  = document.getElementById("settings-provider-select");
  const modelSelect     = document.getElementById("settings-model-select");
  const llmKeyInput     = document.getElementById("settings-llm-key");
  const llmKeyToggle    = document.getElementById("settings-llm-key-toggle");
  const saveLlmBtn      = document.getElementById("settings-save-llm");
  const llmFeedback     = document.getElementById("settings-llm-feedback");
  const tempSlider      = document.getElementById("settings-temperature");
  const tempVal         = document.getElementById("settings-temperature-val");
  const saveTempBtn     = document.getElementById("settings-save-temperature");
  const tempFeedback    = document.getElementById("settings-temperature-feedback");
  const minimaxKeyInput = document.getElementById("settings-minimax-key");
  const saveMinimaxBtn  = document.getElementById("settings-save-minimax");
  const minimaxFeedback = document.getElementById("settings-minimax-feedback");
  const saveSocialBtn   = document.getElementById("settings-save-social");
  const socialFeedback  = document.getElementById("settings-social-feedback");
  const saveVoiceBtn    = document.getElementById("settings-save-voice");
  const voiceFeedback   = document.getElementById("settings-voice-feedback");
  const voiceThreshSlider = document.getElementById("settings-voice-threshold");
  const voiceThreshVal    = document.getElementById("settings-voice-threshold-val");
  const voiceMicSelect    = document.getElementById("voice-mic-select");
  const voiceRefreshMicsBtn = document.getElementById("voice-refresh-mics");
  const voiceMicStatus    = document.getElementById("voice-mic-status");
  const voiceOutputSelect    = document.getElementById("voice-output-select");
  const voiceRefreshOutputsBtn = document.getElementById("voice-refresh-outputs");
  const voiceOutputStatus    = document.getElementById("voice-output-status");

  if (!settingsBtn || !overlay) return;

  let cachedProviders = null;
  let cachedLlm = null;
  let llmKeyVisible = false;

  overlay.querySelectorAll(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => b.classList.remove("active"));
      overlay.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      overlay.querySelector(`.settings-tab[data-tab="${tab}"]`)?.classList.add("active");
      if (tab === "social") loadSocialSettings();
      if (tab === "security") loadSecuritySettings();
      if (tab === "web-search") loadWebSearchSettings();
      if (tab === "update") loadUpdateSettings();
    });
  });

  function showFeedback(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.className = "settings-feedback" + (isError ? " error" : "");
    setTimeout(() => { el.textContent = ""; el.className = "settings-feedback"; }, 3000);
  }

  function refreshConfigSummary({ llm, minimax }) {
    const cfgLlm = document.getElementById("settings-cfg-llm");
    const cfgLlmDot = document.getElementById("settings-cfg-llm-dot");
    const cfgMedia = document.getElementById("settings-cfg-media");
    const cfgMediaDot = document.getElementById("settings-cfg-media-dot");
    if (cfgLlm) cfgLlm.textContent = `${llm.provider || "—"} · ${llm.model || "—"}`;
    if (cfgLlmDot) {
      cfgLlmDot.textContent = "●";
      cfgLlmDot.className = `settings-config-dot ${llm.activated ? "active" : "inactive"}`;
      cfgLlmDot.title = llm.activated ? "Running" : "Inactive";
    }
    if (cfgMedia) cfgMedia.textContent = `minimax · ${minimax.configured ? "configured" : "not configured"}`;
    if (cfgMediaDot) {
      cfgMediaDot.textContent = "●";
      cfgMediaDot.className = `settings-config-dot ${minimax.configured ? "active" : "inactive"}`;
    }
  }

  function populateModelSelect(models, current) {
    if (!modelSelect || !models) return;
    modelSelect.innerHTML = models
      .map(m => `<option value="${m.id}"${m.deprecated ? " data-deprecated" : ""}>${m.label}</option>`)
      .join("");
    if (current) modelSelect.value = current;
  }

  function populateProviderSelect(providers, current) {
    if (!providerSelect || !providers) return;
    const selected = current || providerSelect.value || "auto";
    const options = [`<option value="auto">Auto-detect</option>`]
      .concat(Object.entries(providers).map(([id, provider]) => {
        const label = provider.label || id;
        return `<option value="${id}">${label}</option>`;
      }));
    providerSelect.innerHTML = options.join("");
    providerSelect.value = providers[selected] || selected === "auto" ? selected : "auto";
  }

  function setLlmKeyVisible(visible) {
    llmKeyVisible = Boolean(visible);
    if (llmKeyInput) llmKeyInput.type = llmKeyVisible ? "text" : "password";
    if (llmKeyToggle) {
      llmKeyToggle.setAttribute("aria-label", llmKeyVisible ? "隐藏 API Key" : "显示 API Key");
      llmKeyToggle.title = llmKeyVisible ? "隐藏 API Key" : "显示 API Key";
    }
  }

  function getProviderConfigForUI(provider, llm = cachedLlm) {
    const summary = cachedProviders?.[provider] || {};
    if (llm && provider === llm.provider) {
      return {
        ...summary,
        ...llm,
        apiKey: llm.apiKey ?? summary.apiKey ?? "",
      };
    }
    return summary;
  }

  function applyCustomProviderUI(providerOrLlm) {
    const provider = typeof providerOrLlm === "string"
      ? providerOrLlm
      : (providerOrLlm?.provider || "auto");
    const providerCfg = getProviderConfigForUI(provider, typeof providerOrLlm === "object" ? providerOrLlm : cachedLlm);
    const customSection = document.getElementById("settings-custom-llm-section");
    const modelRow = document.getElementById("settings-model-row");
    if (provider === "auto") {
      if (customSection) customSection.style.display = "none";
      if (modelRow) modelRow.style.display = "none";
      if (llmKeyInput) llmKeyInput.value = "";
      setLlmKeyVisible(false);
      return;
    }
    if (provider === "custom") {
      if (customSection) customSection.style.display = "";
      if (modelRow) modelRow.style.display = "none";
      const baseUrlEl = document.getElementById("settings-custom-baseurl");
      const modelEl = document.getElementById("settings-custom-model");
      if (baseUrlEl) baseUrlEl.value = providerCfg.baseURL || "";
      if (modelEl) modelEl.value = providerCfg.model || "";
    } else {
      if (customSection) customSection.style.display = "none";
      if (modelRow) modelRow.style.display = "";
      if (cachedProviders?.[provider]) {
        populateModelSelect(
          cachedProviders[provider].models,
          providerCfg.model || cachedProviders[provider].defaultModel,
        );
      }
    }
    if (llmKeyInput) llmKeyInput.value = providerCfg.apiKey || "";
    setLlmKeyVisible(false);
  }

  async function loadSettings() {
    try {
      const data = await fetch(`${API}/settings`).then(r => r.json());
      const { llm, minimax, providers } = data;
      if (providers) cachedProviders = providers;
      cachedLlm = llm;
      refreshConfigSummary({ llm, minimax });
      populateProviderSelect(providers, llm.provider || "auto");
      if (providerSelect && llm.provider) providerSelect.value = llm.provider;
      applyCustomProviderUI(llm);
      if (typeof llm.temperature === "number" && tempSlider) {
        tempSlider.value = String(llm.temperature);
        if (tempVal) tempVal.textContent = llm.temperature.toFixed(2);
      }
    } catch {}
  }

  const SOCIAL_FIELD_MAP = {
    "social-discord-token":  "DISCORD_BOT_TOKEN",
    "social-feishu-appid":   "FEISHU_APP_ID",
    "social-feishu-secret":  "FEISHU_APP_SECRET",
    "social-feishu-token":   "FEISHU_VERIFICATION_TOKEN",
    "social-wechat-appid":   "WECHAT_OFFICIAL_APP_ID",
    "social-wechat-secret":  "WECHAT_OFFICIAL_APP_SECRET",
    "social-wechat-token":   "WECHAT_OFFICIAL_TOKEN",
    "social-wecom-botkey":   "WECOM_BOT_KEY",
    "social-wecom-token":    "WECOM_INCOMING_TOKEN",
  };

  const SOCIAL_PLATFORM_STATUS = {
    "social-status-discord": ["DISCORD_BOT_TOKEN"],
    "social-status-feishu":  ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_VERIFICATION_TOKEN"],
    "social-status-wechat":  ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_TOKEN"],
    "social-status-wecom":   ["WECOM_BOT_KEY", "WECOM_INCOMING_TOKEN"],
  };

  async function loadSocialSettings() {
    try {
      const { social } = await fetch(`${API}/settings/social`).then(r => r.json());
      for (const [statusId, keys] of Object.entries(SOCIAL_PLATFORM_STATUS)) {
        const el = document.getElementById(statusId);
        if (!el) continue;
        const configuredCount = keys.filter(k => social[k]?.configured).length;
        if (configuredCount === keys.length) {
          el.textContent = "● 已配置";
          el.className = "settings-platform-status ok";
        } else if (configuredCount > 0) {
          el.textContent = `● 部分配置 (${configuredCount}/${keys.length})`;
          el.className = "settings-platform-status miss";
        } else {
          el.textContent = "○ 未配置";
          el.className = "settings-platform-status miss";
        }
      }
    } catch {}
  }

  const fileSandboxToggle = document.getElementById("security-file-sandbox");
  const execSandboxToggle = document.getElementById("security-exec-sandbox");
  const saveSecurityBtn   = document.getElementById("settings-save-security");
  const securityFeedback  = document.getElementById("settings-security-feedback");

  async function loadWebSearchSettings() {
    try {
      const { webSearch } = await fetch(`${API}/settings/web-search`).then(r => r.json());
      const urlEl = document.getElementById("websearch-searxng-url");
      if (urlEl) urlEl.value = webSearch?.searxngUrl || "";
      const setStatus = (id, configured, fromEnv, extra) => {
        const el = document.getElementById(id);
        if (!el) return;
        const truncated = extra && extra.length > 60 ? extra.slice(0, 60) + "…" : extra;
        if (configured) {
          el.textContent = `已配置${fromEnv ? "（环境变量）" : ""}${truncated ? ` · ${truncated}` : ""}`;
          el.style.color = "var(--ok, #4caf50)";
        } else {
          el.textContent = "未配置（兜底链中跳过）";
          el.style.color = "var(--ink2)";
        }
      };
      setStatus("websearch-status-serper",  !!webSearch?.serperConfigured, !!webSearch?.serperFromEnv);
      setStatus("websearch-status-brave",   !!webSearch?.braveConfigured,  !!webSearch?.braveFromEnv);
      setStatus("websearch-status-tavily",  !!webSearch?.tavilyConfigured, !!webSearch?.tavilyFromEnv);
      setStatus("websearch-status-jina",    !!webSearch?.jinaConfigured,   !!webSearch?.jinaFromEnv);
      const searxngConfigured = !!webSearch?.searxngUrl || !!webSearch?.searxngFromEnv;
      setStatus("websearch-status-searxng", searxngConfigured, !!webSearch?.searxngFromEnv, webSearch?.effectiveSearxngUrl || "");
    } catch {}
  }

  const saveWebSearchBtn = document.getElementById("settings-save-web-search");
  const webSearchFeedback = document.getElementById("settings-web-search-feedback");
  if (saveWebSearchBtn) {
    saveWebSearchBtn.addEventListener("click", async () => {
      const updates = {};
      const serperEl  = document.getElementById("websearch-serper-key");
      const braveEl   = document.getElementById("websearch-brave-key");
      const tavilyEl  = document.getElementById("websearch-tavily-key");
      const jinaEl    = document.getElementById("websearch-jina-key");
      const searxngEl = document.getElementById("websearch-searxng-url");
      const serperVal  = serperEl?.value?.trim();
      const braveVal   = braveEl?.value?.trim();
      const tavilyVal  = tavilyEl?.value?.trim();
      const jinaVal    = jinaEl?.value?.trim();
      const searxngVal = searxngEl?.value?.trim();
      if (serperVal)  updates.serperKey  = serperVal;
      if (braveVal)   updates.braveKey   = braveVal;
      if (tavilyVal)  updates.tavilyKey  = tavilyVal;
      if (jinaVal)    updates.jinaKey    = jinaVal;
      // SearXNG URL：空字符串也要传，让用户能清掉
      if (searxngEl)  updates.searxngUrl = searxngVal || "";
      saveWebSearchBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/web-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(webSearchFeedback, "已保存");
          if (serperEl) serperEl.value = "";
          if (braveEl)  braveEl.value = "";
          if (tavilyEl) tavilyEl.value = "";
          if (jinaEl)   jinaEl.value = "";
          loadWebSearchSettings();
        } else {
          showFeedback(webSearchFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(webSearchFeedback, "请求失败", true);
      } finally {
        saveWebSearchBtn.disabled = false;
      }
    });
  }

  async function loadSecuritySettings() {
    try {
      const { security } = await fetch(`${API}/settings/security`).then(r => r.json());
      if (fileSandboxToggle) fileSandboxToggle.checked = security.fileSandbox !== false;
      if (execSandboxToggle) execSandboxToggle.checked = security.execSandbox !== false;
      document.querySelectorAll(".security-blocked-tool").forEach(cb => {
        cb.checked = (security.blockedTools || []).includes(cb.value);
      });
    } catch {}
  }

  if (saveSecurityBtn) {
    saveSecurityBtn.addEventListener("click", async () => {
      const blockedTools = [...document.querySelectorAll(".security-blocked-tool")]
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const body = {
        fileSandbox: fileSandboxToggle ? fileSandboxToggle.checked : true,
        execSandbox: execSandboxToggle ? execSandboxToggle.checked : true,
        blockedTools,
      };
      saveSecurityBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/security`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(securityFeedback, "已保存 — 立即生效");
        } else {
          showFeedback(securityFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(securityFeedback, "请求失败", true);
      } finally {
        saveSecurityBtn.disabled = false;
      }
    });
  }

  if (saveSocialBtn) {
    saveSocialBtn.addEventListener("click", async () => {
      const updates = {};
      for (const [fieldId, envKey] of Object.entries(SOCIAL_FIELD_MAP)) {
        const val = document.getElementById(fieldId)?.value?.trim() || "";
        if (val) updates[envKey] = val;
      }
      saveSocialBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(socialFeedback, "已保存");
          Object.keys(SOCIAL_FIELD_MAP).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          loadSocialSettings();
        } else {
          showFeedback(socialFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(socialFeedback, "请求失败", true);
      } finally {
        saveSocialBtn.disabled = false;
      }
    });
  }

  if (tempSlider && tempVal) {
    tempSlider.addEventListener("input", () => {
      tempVal.textContent = parseFloat(tempSlider.value).toFixed(2);
    });
  }
  if (saveTempBtn) {
    saveTempBtn.addEventListener("click", async () => {
      const temperature = parseFloat(tempSlider?.value ?? "0.5");
      saveTempBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/temperature`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ temperature }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(tempFeedback, `已设为 ${data.temperature.toFixed(2)}`);
        } else {
          showFeedback(tempFeedback, data.error || "保存失败", true);
        }
      } catch { showFeedback(tempFeedback, "请求失败", true); }
      finally { saveTempBtn.disabled = false; }
    });
  }

  const VOICE_LANG_KEY       = "xiaobailong-voice-lang";
  const VOICE_AUTO_SEND_KEY  = "xiaobailong-voice-auto-send";
  const VOICE_AUTO_MIC_KEY   = "xiaobailong-voice-auto-mic";
  const VOICE_THRESHOLD_KEY  = "xiaobailong-voice-threshold";
  const VOICE_PROVIDER_KEY   = "xiaobailong-voice-provider";
  const VOICE_MIC_DEVICE_KEY = "xiaobailong-voice-mic-device-id";

  function applyVoiceProviderUI(provider) {
    const panels = {
      aliyun: "voice-cred-aliyun",
      volcengine: "voice-cred-volcengine",
      tencent: "voice-cred-tencent",
      xunfei: "voice-cred-xunfei",
      custom: "voice-cred-custom",
    };
    for (const [key, id] of Object.entries(panels)) {
      const el = document.getElementById(id);
      if (el) el.style.display = key === provider ? "" : "none";
    }
  }

  function detectVoiceProviderFromKey(key) {
    const value = (key || "").trim();
    if (!value) return null;
    if (/^sk-[A-Za-z0-9_\-.]{20,}$/.test(value)) {
      return { provider: "aliyun", label: "阿里云 ASR", fieldId: "voice-aliyun-key" };
    }
    if (/^AKID/i.test(value)) {
      return { provider: "tencent", label: "腾讯云 ASR", fieldId: "voice-tencent-sid" };
    }
    if (/^\d{6,10}$/.test(value)) {
      return { provider: "xunfei", label: "科大讯飞", fieldId: "voice-xunfei-appid" };
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return {
        provider: "volcengine",
        label: "火山豆包 ASR",
        fieldId: "voice-volc-apikey",
        defaults: { "voice-volc-resourceid": "volc.bigasr.sauc.duration" },
      };
    }
    return null;
  }

  function setVoiceMicStatus(message, isError = false) {
    if (!voiceMicStatus) return;
    voiceMicStatus.textContent = message;
    voiceMicStatus.style.color = isError ? "var(--warm)" : "var(--dim)";
  }

  async function loadMicrophoneDevices({ requestPermission = false } = {}) {
    if (!voiceMicSelect) return;
    if (!navigator.mediaDevices?.enumerateDevices) {
      voiceMicSelect.disabled = true;
      setVoiceMicStatus("当前环境不支持麦克风设备枚举，将使用系统默认麦克风。", true);
      return;
    }

    const savedDeviceId = localStorage.getItem(VOICE_MIC_DEVICE_KEY) || "";
    const preferredDeviceId = voiceMicSelect.value || savedDeviceId;
    let permissionError = null;

    voiceMicSelect.disabled = true;
    if (voiceRefreshMicsBtn) voiceRefreshMicsBtn.disabled = true;

    try {
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        try {
          const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          permissionStream.getTracks().forEach(track => track.stop());
        } catch (err) {
          permissionError = err;
        }
      }

      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === "audioinput");

      voiceMicSelect.innerHTML = "";
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "系统默认麦克风";
      voiceMicSelect.appendChild(defaultOption);

      devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || `麦克风 ${index + 1}`;
        voiceMicSelect.appendChild(option);
      });

      const selectedStillExists = !preferredDeviceId || devices.some(device => device.deviceId === preferredDeviceId);
      voiceMicSelect.value = selectedStillExists ? preferredDeviceId : "";
      if (!selectedStillExists && savedDeviceId) localStorage.removeItem(VOICE_MIC_DEVICE_KEY);

      const hasLabels = devices.some(device => device.label);
      if (permissionError) {
        setVoiceMicStatus("未获得麦克风权限，仍可使用系统默认麦克风；点刷新可重新授权。", true);
      } else if (!devices.length) {
        setVoiceMicStatus("未检测到独立麦克风，将使用系统默认麦克风。");
      } else if (!hasLabels) {
        setVoiceMicStatus(`已检测到 ${devices.length} 个麦克风；点刷新并授权后可显示完整名称。`);
      } else {
        setVoiceMicStatus(`已检测到 ${devices.length} 个麦克风。更换后重新开启语音对话生效。`);
      }
    } catch {
      setVoiceMicStatus("麦克风列表读取失败，将使用系统默认麦克风。", true);
    } finally {
      voiceMicSelect.disabled = false;
      if (voiceRefreshMicsBtn) voiceRefreshMicsBtn.disabled = false;
    }
  }

  function setVoiceOutputStatus(message, isError = false) {
    if (!voiceOutputStatus) return;
    voiceOutputStatus.textContent = message;
    voiceOutputStatus.style.color = isError ? "var(--warm)" : "var(--dim)";
  }

  // 填充"语音输出设备"下拉。结构对齐麦克风选择器：第一项=自动，其余=具体设备；
  // 虚拟/串流设备打标提示用户它们不会真正出声。
  async function loadOutputDevices({ requestPermission = false } = {}) {
    if (!voiceOutputSelect) return;
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      voiceOutputSelect.disabled = true;
      setVoiceOutputStatus("当前环境不支持指定输出设备，将使用系统默认。", true);
      return;
    }
    const savedDeviceId = getOutputPreference();
    const preferred = voiceOutputSelect.value || savedDeviceId;
    voiceOutputSelect.disabled = true;
    if (voiceRefreshOutputsBtn) voiceRefreshOutputsBtn.disabled = true;
    try {
      // label/deviceId 需要媒体权限；点"刷新"时主动请求一次，平时静默枚举
      if (requestPermission && navigator.mediaDevices?.getUserMedia) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          s.getTracks().forEach(t => t.stop());
        } catch {}
      }
      const outs = await listOutputDevices();
      // 只列真实可选设备（隐藏 default/communications 别名，避免和"自动"重复）
      const selectable = outs.filter(d => !d.isDefault && d.label);
      voiceOutputSelect.innerHTML = "";
      const autoOpt = document.createElement("option");
      autoOpt.value = "";
      autoOpt.textContent = "自动（跟随系统，避开虚拟设备）";
      voiceOutputSelect.appendChild(autoOpt);
      selectable.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = (d.label || `输出设备 ${i + 1}`) + (d.isVirtual ? "（虚拟，可能没声音）" : "");
        voiceOutputSelect.appendChild(opt);
      });
      const stillExists = !preferred || selectable.some(d => d.deviceId === preferred);
      voiceOutputSelect.value = stillExists ? preferred : "";
      if (!stillExists && savedDeviceId) setOutputPreference(""); // 钉的设备没了 → 回到自动

      const hasLabels = selectable.some(d => d.label);
      if (!selectable.length) {
        setVoiceOutputStatus("未检测到独立扬声器/耳机，点刷新并授权后可显示。");
      } else if (!hasLabels) {
        setVoiceOutputStatus("点刷新并授权后可显示设备完整名称。");
      } else {
        setVoiceOutputStatus("语音从这里发声。默认自动；拔耳机会自动切回扬声器，不被虚拟声卡占用。");
      }
    } catch {
      setVoiceOutputStatus("输出设备列表读取失败，将使用系统默认。", true);
    } finally {
      voiceOutputSelect.disabled = false;
      if (voiceRefreshOutputsBtn) voiceRefreshOutputsBtn.disabled = false;
    }
  }

  voiceRefreshOutputsBtn?.addEventListener("click", () => loadOutputDevices({ requestPermission: true }));
  // 选择即时生效（无需点保存）：写偏好 → 模块自动把在播语音切过去并复评横幅
  voiceOutputSelect?.addEventListener("change", () => {
    setOutputPreference(voiceOutputSelect.value || "");
    setVoiceOutputStatus(voiceOutputSelect.value ? "已切换，立即生效。" : "已设为自动，立即生效。");
  });

  const voiceProviderSelect = document.getElementById("voice-provider-select");
  if (voiceProviderSelect) {
    voiceProviderSelect.addEventListener("change", () => applyVoiceProviderUI(voiceProviderSelect.value));
  }

  const voiceAutoKey = document.getElementById("voice-auto-key");
  const voiceAutoDetect = document.getElementById("voice-auto-detect");
  if (voiceAutoKey) {
    voiceAutoKey.addEventListener("input", () => {
      const detected = detectVoiceProviderFromKey(voiceAutoKey.value);
      if (!detected) {
        if (voiceAutoDetect) voiceAutoDetect.textContent = voiceAutoKey.value.trim() ? "未识别" : "";
        return;
      }
      if (voiceProviderSelect) voiceProviderSelect.value = detected.provider;
      applyVoiceProviderUI(detected.provider);
      const target = document.getElementById(detected.fieldId);
      if (target) target.value = voiceAutoKey.value.trim();
      for (const [id, value] of Object.entries(detected.defaults || {})) {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) el.value = value;
      }
      if (voiceAutoDetect) voiceAutoDetect.textContent = detected.label;
    });
  }

  voiceRefreshMicsBtn?.addEventListener("click", () => {
    loadMicrophoneDevices({ requestPermission: true });
  });

  voiceMicSelect?.addEventListener("change", () => {
    setVoiceMicStatus("保存后，重新开启语音对话生效。");
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    if (!overlay.hidden) { loadMicrophoneDevices(); loadOutputDevices(); }
  });

  async function loadVoiceSettings() {
    const langSelect = document.getElementById("voice-lang-select");
    const autoSend   = document.getElementById("voice-auto-send");
    if (langSelect) langSelect.value = localStorage.getItem(VOICE_LANG_KEY) || "zh-CN";
    if (autoSend) autoSend.checked = localStorage.getItem(VOICE_AUTO_SEND_KEY) !== "false";
    const autoMic = document.getElementById("voice-auto-mic");
    if (autoMic) autoMic.checked = localStorage.getItem(VOICE_AUTO_MIC_KEY) === "true";
    const savedThresh = parseFloat(localStorage.getItem(VOICE_THRESHOLD_KEY) || "0.008");
    if (voiceThreshSlider) voiceThreshSlider.value = String(savedThresh);
    if (voiceThreshVal)    voiceThreshVal.textContent = savedThresh.toFixed(3);
    await loadMicrophoneDevices();
    await loadOutputDevices();

    let savedProvider = localStorage.getItem(VOICE_PROVIDER_KEY) || "aliyun";
    try {
      const resp = await fetch("http://127.0.0.1:3721/settings/voice");
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.voice?.voiceProvider) {
        savedProvider = data.voice.voiceProvider;
        localStorage.setItem(VOICE_PROVIDER_KEY, savedProvider);
      }
    } catch {}
    if (voiceProviderSelect) voiceProviderSelect.value = savedProvider;
    applyVoiceProviderUI(savedProvider);
  }

  if (voiceThreshSlider && voiceThreshVal) {
    voiceThreshSlider.addEventListener("input", () => {
      voiceThreshVal.textContent = parseFloat(voiceThreshSlider.value).toFixed(3);
    });
  }


  if (saveVoiceBtn) {
    saveVoiceBtn.addEventListener("click", async () => {
      const lang      = document.getElementById("voice-lang-select")?.value || "zh-CN";
      const autoSend  = document.getElementById("voice-auto-send")?.checked ?? true;
      const autoMic   = document.getElementById("voice-auto-mic")?.checked ?? false;
      const threshold = parseFloat(voiceThreshSlider?.value ?? "0.008");
      const provider  = voiceProviderSelect?.value || "aliyun";
      const micDeviceId = voiceMicSelect?.value || "";

      localStorage.setItem(VOICE_LANG_KEY,      lang);
      localStorage.setItem(VOICE_AUTO_SEND_KEY,  String(autoSend));
      localStorage.setItem(VOICE_AUTO_MIC_KEY,   String(autoMic));
      localStorage.setItem(VOICE_THRESHOLD_KEY,  String(threshold));
      localStorage.setItem(VOICE_PROVIDER_KEY,   provider);
      if (micDeviceId) localStorage.setItem(VOICE_MIC_DEVICE_KEY, micDeviceId);
      else localStorage.removeItem(VOICE_MIC_DEVICE_KEY);

      window.dispatchEvent(new CustomEvent("xiaobailong:voice-threshold", { detail: { threshold } }));
      const micLabel = voiceMicSelect?.selectedOptions?.[0]?.textContent || "系统默认麦克风";
      setVoiceMicStatus(`当前麦克风：${micLabel}。重新开启语音对话生效。`);

      const body = { voiceProvider: provider };
      const aliyunKey = document.getElementById("voice-aliyun-key")?.value?.trim();
      if (aliyunKey) body.aliyunApiKey = aliyunKey;
      const tencentSid = document.getElementById("voice-tencent-sid")?.value?.trim();
      if (tencentSid) body.tencentSecretId = tencentSid;
      const tencentSkey = document.getElementById("voice-tencent-skey")?.value?.trim();
      if (tencentSkey) body.tencentSecretKey = tencentSkey;
      const tencentAppid = document.getElementById("voice-tencent-appid")?.value?.trim();
      if (tencentAppid) body.tencentAppId = tencentAppid;
      const xunfeiAppid = document.getElementById("voice-xunfei-appid")?.value?.trim();
      if (xunfeiAppid) body.xunfeiAppId = xunfeiAppid;
      const xunfeiApikey = document.getElementById("voice-xunfei-apikey")?.value?.trim();
      if (xunfeiApikey) body.xunfeiApiKey = xunfeiApikey;
      const volcApiKey = document.getElementById("voice-volc-apikey")?.value?.trim();
      if (volcApiKey) body.volcAsrApiKey = volcApiKey;
      const volcResourceId = document.getElementById("voice-volc-resourceid")?.value?.trim();
      if (volcResourceId) body.volcAsrResourceId = volcResourceId;
      const volcAppKey = document.getElementById("voice-volc-appkey")?.value?.trim();
      if (volcAppKey) body.volcAsrAppKey = volcAppKey;
      const volcAccessKey = document.getElementById("voice-volc-accesskey")?.value?.trim();
      if (volcAccessKey) body.volcAsrAccessKey = volcAccessKey;
      const customAsrUrl = document.getElementById("voice-custom-url")?.value?.trim();
      if (customAsrUrl) body.customAsrUrl = customAsrUrl;
      const customAsrKey = document.getElementById("voice-custom-key")?.value?.trim();
      if (customAsrKey) body.customAsrKey = customAsrKey;
      const customAsrModel = document.getElementById("voice-custom-model")?.value?.trim();
      if (customAsrModel) body.customAsrModel = customAsrModel;

      if (Object.keys(body).length > 0) {
        try {
          saveVoiceBtn.disabled = true;
          const resp = await fetch("http://127.0.0.1:3721/settings/voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!resp.ok) throw new Error("保存失败");
          [
            "voice-aliyun-key",
            "voice-auto-key",
            "voice-tencent-sid",
            "voice-tencent-skey",
            "voice-xunfei-apikey",
            "voice-volc-apikey",
            "voice-volc-appkey",
            "voice-volc-accesskey",
            "voice-custom-key",
            ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          if (voiceAutoDetect) voiceAutoDetect.textContent = "";
          showFeedback(voiceFeedback, "已保存");
        } catch { showFeedback(voiceFeedback, "保存失败", true); }
        finally { saveVoiceBtn.disabled = false; }
      } else {
        showFeedback(voiceFeedback, "已保存");
      }
    });
  }

  initTTSSettings();

  const memoryGraphToggle = document.getElementById("settings-memory-graph-toggle");
  const memoryGraphFeedback = document.getElementById("settings-memory-graph-feedback");
  if (memoryGraphToggle) {
    memoryGraphToggle.checked = localStorage.getItem(MEMORY_GRAPH_STORAGE_KEY) !== "false";
    memoryGraphToggle.addEventListener("change", () => {
      localStorage.setItem(MEMORY_GRAPH_STORAGE_KEY, String(memoryGraphToggle.checked));
      if (memoryGraphFeedback) {
        memoryGraphFeedback.textContent = "下次刷新页面后生效";
        memoryGraphFeedback.className = "settings-feedback";
        setTimeout(() => { memoryGraphFeedback.textContent = ""; }, 3000);
      }
    });
  }

  function openSettings(tab = null) {
    overlay.hidden = false;
    loadSettings();
    loadVoiceSettings();
    loadMediaSettings();
    if (tab) {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      overlay.querySelectorAll(".settings-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tab);
      });
      if (tab === "social") loadSocialSettings();
      if (tab === "web-search") loadWebSearchSettings();
      if (tab === "update") loadUpdateSettings();
    }
  }

  function closeSettings() {
    overlay.hidden = true;
    if (llmKeyInput) llmKeyInput.value = "";
    if (minimaxKeyInput) minimaxKeyInput.value = "";
  }

  // 暴露给 chat.js 的斜杠命令使用（由 app.js 调用方赋值）
  // openSettingsRef = openSettings;  // 已移至 app.js

  settingsBtn.addEventListener("click", () => openSettings());
  closeBtn.addEventListener("click", closeSettings);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeSettings(); });

  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      applyCustomProviderUI(providerSelect.value);
    });
  }

  llmKeyToggle?.addEventListener("click", () => {
    setLlmKeyVisible(!llmKeyVisible);
  });

  saveLlmBtn?.addEventListener("click", async () => {
    const provider = providerSelect?.value || "auto";
    const apiKey = llmKeyInput.value.trim();
    saveLlmBtn.disabled = true;
    try {
      const selectedCfg = cachedProviders?.[provider] || {};
      const body = { provider };
      if (provider === "custom") {
        body.baseURL = document.getElementById("settings-custom-baseurl")?.value?.trim();
        body.model = document.getElementById("settings-custom-model")?.value?.trim();
        if (!body.baseURL || !body.model) {
          showFeedback(llmFeedback, "请填入 Base URL 和模型名称", true);
          saveLlmBtn.disabled = false;
          return;
        }
        if (apiKey !== (selectedCfg.apiKey || "")) body.apiKey = apiKey || "none";
      } else if (provider === "auto") {
        if (!apiKey) {
          showFeedback(llmFeedback, "自动识别需要填入 API Key", true);
          saveLlmBtn.disabled = false;
          return;
        }
        body.apiKey = apiKey;
      } else {
        body.model = modelSelect.value;
        if (apiKey && apiKey !== (selectedCfg.apiKey || "")) body.apiKey = apiKey;
      }

      const res = await fetch(`${API}/settings/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmFeedback, "已保存");
        loadSettings();
      } else {
        showFeedback(llmFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(llmFeedback, "请求失败", true); }
    finally { saveLlmBtn.disabled = false; }
  });

  saveMinimaxBtn?.addEventListener("click", async () => {
    const apiKey = minimaxKeyInput.value.trim();
    if (!apiKey) { showFeedback(minimaxFeedback, "API Key 不能为空", true); return; }
    saveMinimaxBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/minimax`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(minimaxFeedback, "已保存");
        minimaxKeyInput.value = "";
        loadSettings();
      } else {
        showFeedback(minimaxFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(minimaxFeedback, "请求失败", true); }
    finally { saveMinimaxBtn.disabled = false; }
  });

  // ── 媒体配置：provider 切换 + 保存 + 加载 ──
  const mediaImageProvider = document.getElementById("media-image-provider");
  const mediaCredsMinimax = document.getElementById("media-creds-minimax");
  const mediaCredsOpenai = document.getElementById("media-creds-openai");
  const mediaCredsCustom = document.getElementById("media-creds-custom");
  const saveMediaBtn = document.getElementById("settings-save-media");
  const mediaFeedback = document.getElementById("settings-media-feedback");

  function applyMediaProviderUI(provider) {
    if (mediaCredsMinimax) mediaCredsMinimax.style.display = provider === "minimax" ? "" : "none";
    if (mediaCredsOpenai) mediaCredsOpenai.style.display = provider === "openai" ? "" : "none";
    if (mediaCredsCustom) mediaCredsCustom.style.display = provider === "custom" ? "" : "none";
  }

  mediaImageProvider?.addEventListener("change", () => {
    applyMediaProviderUI(mediaImageProvider.value);
  });

  async function loadMediaSettings() {
    try {
      const { media } = await fetch(`${API}/settings/media`).then(r => r.json());
      if (media?.mediaImageProvider && mediaImageProvider) {
        mediaImageProvider.value = media.mediaImageProvider;
        applyMediaProviderUI(media.mediaImageProvider);
      }
      const cfgMedia = document.getElementById("settings-cfg-media");
      if (cfgMedia) {
        const p = media?.mediaImageProvider || "minimax";
        const labels = { minimax: "MiniMax", openai: "OpenAI DALL-E", custom: "自定义" };
        const keyOk = p === "minimax" ? media?.minimaxKey?.configured
          : p === "openai" ? media?.openaiImageKey?.configured
          : p === "custom" ? media?.customImageKey?.configured : false;
        cfgMedia.textContent = `${labels[p] || p} · ${keyOk ? "configured" : "not configured"}`;
      }
      const openaiBaseurl = document.getElementById("media-openai-baseurl");
      if (openaiBaseurl && media?.openaiImageBaseURL) openaiBaseurl.value = media.openaiImageBaseURL;
      const openaiModel = document.getElementById("media-openai-model");
      if (openaiModel && media?.openaiImageModel) openaiModel.value = media.openaiImageModel;
      const customUrl = document.getElementById("media-custom-url");
      if (customUrl && media?.customImageUrl) customUrl.value = media.customImageUrl;
      const customModel = document.getElementById("media-custom-model");
      if (customModel && media?.customImageModel) customModel.value = media.customImageModel;
    } catch {}
  }

  saveMediaBtn?.addEventListener("click", async () => {
    const body = {};
    if (mediaImageProvider) body.mediaImageProvider = mediaImageProvider.value;
    const minimaxKey = document.getElementById("settings-minimax-key")?.value?.trim();
    if (minimaxKey) body.minimaxKey = minimaxKey;
    const openaiKey = document.getElementById("media-openai-key")?.value?.trim();
    if (openaiKey) body.openaiImageKey = openaiKey;
    const openaiBaseurl = document.getElementById("media-openai-baseurl")?.value?.trim();
    if (openaiBaseurl) body.openaiImageBaseURL = openaiBaseurl;
    const openaiModel = document.getElementById("media-openai-model")?.value?.trim();
    if (openaiModel) body.openaiImageModel = openaiModel;
    const customUrl = document.getElementById("media-custom-url")?.value?.trim();
    if (customUrl) body.customImageUrl = customUrl;
    const customKey = document.getElementById("media-custom-key")?.value?.trim();
    if (customKey) body.customImageKey = customKey;
    const customModel = document.getElementById("media-custom-model")?.value?.trim();
    if (customModel) body.customImageModel = customModel;
    if (!Object.keys(body).length) { showFeedback(mediaFeedback, "已保存"); return; }
    saveMediaBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(mediaFeedback, "已保存");
        ["media-openai-key", "media-custom-key", "settings-minimax-key"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        });
        loadMediaSettings();
      } else {
        showFeedback(mediaFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(mediaFeedback, "请求失败", true); }
    finally { saveMediaBtn.disabled = false; }
  });

  const clawbotConnectBtn = document.getElementById("clawbot-connect-btn");
  const clawbotLogoutBtn  = document.getElementById("clawbot-logout-btn");
  const clawbotQrArea     = document.getElementById("clawbot-qr-area");
  const clawbotQrImg      = document.getElementById("clawbot-qr-img");
  const clawbotQrHint     = document.getElementById("clawbot-qr-hint");
  const clawbotFeedback   = document.getElementById("clawbot-feedback");
  const clawbotStatus     = document.getElementById("social-status-clawbot");
  let clawbotPollTimer    = null;

  function setClawbotStatus(text, ok) {
    if (!clawbotStatus) return;
    clawbotStatus.textContent = ok ? `● ${text}` : `○ ${text}`;
    clawbotStatus.className = `settings-platform-status ${ok ? "ok" : "miss"}`;
  }

  function stopClawbotPoll() {
    if (clawbotPollTimer) { clearInterval(clawbotPollTimer); clawbotPollTimer = null; }
  }

  async function pollClawbotQR() {
    try {
      const data = await fetch(`${API}/social/wechat-clawbot/qr`).then(r => r.json());
      if (data.status === "connected") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("已连接", true);
        if (clawbotFeedback) showFeedback(clawbotFeedback, "微信绑定成功！");
        loadSocialSettings();
      } else if (data.status === "qr_ready" && data.qr_url) {
        if (clawbotQrImg) clawbotQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qr_url)}`;
        if (clawbotQrArea) clawbotQrArea.style.display = "block";
        if (clawbotQrHint) clawbotQrHint.textContent = "等待扫码…";
        setClawbotStatus("等待扫码", false);
      } else if (data.status === "qr_pending") {
        if (clawbotQrHint) clawbotQrHint.textContent = "正在生成二维码…";
      } else if (data.status === "error") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("连接失败", false);
        if (clawbotFeedback) showFeedback(clawbotFeedback, data.error || "连接失败", true);
      }
    } catch {}
  }

  if (clawbotConnectBtn) {
    pollClawbotQR();
  }

  clawbotConnectBtn?.addEventListener("click", async () => {
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    setClawbotStatus("启动中…", false);
    stopClawbotPoll();
    try {
      await fetch(`${API}/settings/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _clawbot_connect: "1" }),
      });
    } catch {}
    await pollClawbotQR();
    clawbotPollTimer = setInterval(pollClawbotQR, 2000);
  });

  clawbotLogoutBtn?.addEventListener("click", async () => {
    stopClawbotPoll();
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    try {
      await fetch(`${API}/social/wechat-clawbot/logout`, { method: "POST" });
      setClawbotStatus("已断开", false);
      showFeedback(clawbotFeedback, "微信已断开");
    } catch {
      showFeedback(clawbotFeedback, "请求失败", true);
    }
  });

  window.addEventListener("xiaobailong:social_status", (e) => {
    const d = e.detail;
    if (d?.platform !== "wechat-clawbot") return;
    if (d.status === "connected") {
      stopClawbotPoll();
      if (clawbotQrArea) clawbotQrArea.style.display = "none";
      setClawbotStatus("已连接", true);
    } else if (d.status === "qr_ready") {
      if (!clawbotPollTimer) clawbotPollTimer = setInterval(pollClawbotQR, 2000);
      pollClawbotQR();
    } else if (d.status === "session_expired") {
      stopClawbotPoll();
      setClawbotStatus("会话已过期 — 请重新扫码", false);
    } else if (d.status === "idle") {
      setClawbotStatus("未连接", false);
    }
  });

  const settingsCheckUpdateBtn     = document.getElementById("settings-check-update-btn");
  const settingsDownloadUpdateBtn  = document.getElementById("settings-download-update-btn");
  const settingsInstallUpdateBtn   = document.getElementById("settings-install-update-btn");
  const settingsIgnoreUpdateBtn    = document.getElementById("settings-ignore-update-btn");
  const settingsUpdateStatusEl     = document.getElementById("settings-update-status");
  const settingsUpdateFeedback     = document.getElementById("settings-update-feedback");
  const settingsCurrentVersion     = document.getElementById("settings-current-version");
  const settingsSuppressToggle     = document.getElementById("settings-suppress-updates");
  const settingsIgnoredSection     = document.getElementById("settings-ignored-section");
  const settingsIgnoredVersionEl   = document.getElementById("settings-ignored-version-val");
  const settingsClearIgnoredBtn    = document.getElementById("settings-clear-ignored-btn");

  let pendingUpdateVersion = null;
  let removeUpdaterListener = null;

  function setUpdateStatusText(text, state = "idle") {
    if (!settingsUpdateStatusEl) return;
    settingsUpdateStatusEl.textContent = text;
    settingsUpdateStatusEl.dataset.state = state;
  }

  function setUpdateFeedback(text, isError = false) {
    if (!settingsUpdateFeedback) return;
    settingsUpdateFeedback.textContent = text || "";
    settingsUpdateFeedback.className = isError ? "settings-feedback error" : "settings-feedback";
  }

  function showUpdateButtons({ check = true, checkDisabled = false, checkLabel = "检查更新", download = false, install = false, ignore = false } = {}) {
    if (settingsCheckUpdateBtn) {
      settingsCheckUpdateBtn.classList.toggle("hidden", !check);
      settingsCheckUpdateBtn.disabled = checkDisabled;
      settingsCheckUpdateBtn.textContent = checkLabel;
    }
    settingsDownloadUpdateBtn?.classList.toggle("hidden", !download);
    settingsInstallUpdateBtn?.classList.toggle("hidden", !install);
    settingsIgnoreUpdateBtn?.classList.toggle("hidden", !ignore);
  }

  function syncUpdateSettings() {
    const ignored = localStorage.getItem(IGNORED_VERSION_KEY) || null;
    const suppressed = localStorage.getItem(SUPPRESS_UPDATES_KEY) === "true";
    if (settingsSuppressToggle) settingsSuppressToggle.checked = suppressed;
    if (settingsIgnoredSection) settingsIgnoredSection.style.display = ignored ? "" : "none";
    if (settingsIgnoredVersionEl && ignored) settingsIgnoredVersionEl.textContent = ignored;
  }

  async function loadUpdateSettings() {
    syncUpdateSettings();
    const bridge = window.xiaobailong;
    if (!bridge?.isElectron) {
      if (settingsCurrentVersion) settingsCurrentVersion.textContent = "仅桌面端可用";
      if (settingsCheckUpdateBtn) settingsCheckUpdateBtn.disabled = true;
      setUpdateStatusText("仅桌面端可用", "muted");
      return;
    }
    try {
      const ver = await bridge.getVersion?.();
      if (settingsCurrentVersion && ver) settingsCurrentVersion.textContent = ver;
    } catch {}

    removeUpdaterListener = bridge.onUpdaterStatus?.((payload = {}) => {
      const stage = payload.stage || "idle";
      const ver = payload.version || "";
      const percent = typeof payload.percent === "number" ? Math.round(payload.percent) : null;

      switch (stage) {
        case "checking":
          setUpdateStatusText("正在检查更新…", "checking");
          showUpdateButtons({ checkDisabled: true, checkLabel: "检查中…" });
          break;
        case "available":
          pendingUpdateVersion = ver;
          setUpdateStatusText(`发现新版本 ${ver}`, "available");
          showUpdateButtons({ check: false, download: true, ignore: true });
          break;
        case "downloading":
          setUpdateStatusText(`下载中${percent !== null ? ` ${percent}%` : "…"}`, "downloading");
          showUpdateButtons({ check: false });
          break;
        case "downloaded":
          setUpdateStatusText(`版本 ${ver} 已就绪 — 重启后安装`, "ready");
          showUpdateButtons({ check: false, install: true });
          break;
        case "up-to-date":
          setUpdateStatusText(`已是最新版本 ${ver}`, "idle");
          showUpdateButtons({ checkLabel: "检查更新" });
          break;
        case "error":
          setUpdateStatusText(`更新失败：${payload.message || "请稍后再试"}`, "error");
          showUpdateButtons({ checkLabel: "重试" });
          break;
        case "dev":
          setUpdateStatusText("开发模式不检查更新", "muted");
          showUpdateButtons({ checkDisabled: true, checkLabel: "开发模式" });
          break;
        default:
          showUpdateButtons({});
          break;
      }
    }) || null;
  }

  window.addEventListener("beforeunload", () => {
    if (typeof removeUpdaterListener === "function") {
      removeUpdaterListener();
      removeUpdaterListener = null;
    }
  });

  settingsSuppressToggle?.addEventListener("change", () => {
    localStorage.setItem(SUPPRESS_UPDATES_KEY, settingsSuppressToggle.checked ? "true" : "false");
    syncUpdateSettings();
  });

  settingsClearIgnoredBtn?.addEventListener("click", () => {
    localStorage.removeItem(IGNORED_VERSION_KEY);
    syncUpdateSettings();
  });

  settingsCheckUpdateBtn?.addEventListener("click", async () => {
    const bridge = window.xiaobailong;
    if (!bridge?.isElectron) return;
    setUpdateStatusText("正在检查更新…", "checking");
    setUpdateFeedback("");
    showUpdateButtons({ checkDisabled: true, checkLabel: "检查中…" });
    try {
      const result = await bridge.checkForUpdates?.();
      if (result?.ok === false && result?.message) {
        setUpdateStatusText(`更新失败：${result.message}`, "error");
        showUpdateButtons({ checkLabel: "重试" });
      }
    } catch (err) {
      setUpdateStatusText(`更新失败：${err?.message || "请稍后再试"}`, "error");
      showUpdateButtons({ checkLabel: "重试" });
    }
  });

  settingsDownloadUpdateBtn?.addEventListener("click", async () => {
    const bridge = window.xiaobailong;
    if (!bridge?.isElectron) return;
    setUpdateStatusText("开始下载…", "downloading");
    showUpdateButtons({ check: false });
    try {
      await bridge.startDownload?.();
    } catch (err) {
      setUpdateStatusText(`下载失败：${err?.message || "请稍后再试"}`, "error");
      showUpdateButtons({ checkLabel: "重试" });
    }
  });

  settingsInstallUpdateBtn?.addEventListener("click", () => {
    window.xiaobailong?.quitAndInstall?.();
  });

  settingsIgnoreUpdateBtn?.addEventListener("click", () => {
    if (pendingUpdateVersion) {
      localStorage.setItem(IGNORED_VERSION_KEY, pendingUpdateVersion);
      syncUpdateSettings();
    }
    setUpdateStatusText("已忽略此版本", "muted");
    showUpdateButtons({ checkLabel: "检查更新" });
  });
  // ── Hotspot mode ──
  initHotspot().catch((err) => console.warn("[Hotspot] init failed:", err));

  // ── Worldcup mode ──
  initWorldcup().catch((err) => console.warn("[Worldcup] init failed:", err));

  // ── 语音输出设备路由（已移至 app.js 统一调用）──
  return { openSettings };
}
// ── Media modes (video / image) ──
(function initMediaModes() {
  const videoBtn      = document.getElementById("video-btn");
  const videoExitBtn  = document.getElementById("video-exit-btn");
  const videoFeed     = document.getElementById("video-feed");
  const videoFrame    = document.getElementById("video-frame");
  const videoSurface  = document.getElementById("video-surface");
  const videoBackdrop = document.getElementById("video-backdrop");
  const videoTitle    = document.getElementById("video-title");
  const imageExitBtn  = document.getElementById("image-exit-btn");
  const imageDisplay  = document.getElementById("image-display");
  const imageSurface  = document.getElementById("image-surface");
  const imageTitle    = document.getElementById("image-title");

  let videoStream = null;
  let videoActive = false;
  let imageActive = false;
  let videoKind   = "empty";
  let currentVideoSource = "";
  let currentVideoStart = null;
  // wall-clock ms when current play started/resumed; used to estimate elapsed
  // for cross-origin iframes (bilibili) where we can't read currentTime.
  let playResumeAt = null;

  function normalizeUrl(url = "") {
    return String(url || "").trim();
  }

  function localPathToUrl(src) {
    const s = String(src || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    // Local path (file:// or absolute) → backend HTTP media endpoint to avoid file:// CORS restriction
    let resolved = s;
    if (/^file:\/\//i.test(s)) {
      resolved = decodeURIComponent(s.replace(/^file:\/\/\//i, "").replace(/^file:\/\//i, ""));
    }
    const filename = resolved.split(/[\\/]/).filter(Boolean).pop() || "";
    if (!filename) return s;
    return "/media/music/" + encodeURIComponent(filename);
  }

  function extractYoutubeId(url) {
    return normalizeUrl(url).match(
      /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/
    )?.[1] || null;
  }

  function youtubeEmbedUrl(url, { autoplay = false, start = null } = {}) {
    const id = extractYoutubeId(url);
    if (!id) return null;
    const params = new URLSearchParams({
      enablejsapi: "1",
      playsinline: "1",
      rel: "0",
      autoplay: autoplay ? "1" : "0",
    });
    if (Number.isFinite(Number(start))) params.set("start", String(Math.max(0, Math.round(Number(start)))));
    return `https://www.youtube.com/embed/${id}?${params.toString()}`;
  }

  function extractBilibiliId(url) {
    const raw = normalizeUrl(url);
    return raw.match(/\/video\/(BV[A-Za-z0-9]+)/i)?.[1]
        || raw.match(/\b(BV[A-Za-z0-9]+)\b/i)?.[1]
        || null;
  }

  function bilibiliEmbedUrl(url, { autoplay = false, start = null } = {}) {
    const bvid = extractBilibiliId(url);
    if (!bvid) return null;
    const params = new URLSearchParams({
      bvid,
      autoplay: autoplay ? "1" : "0",
      high_quality: "1",
    });
    if (Number.isFinite(Number(start))) params.set("t", String(Math.max(0, Math.round(Number(start)))));
    return `https://player.bilibili.com/player.html?${params.toString()}`;
  }

  function iframeUrlFor(url, options) {
    return youtubeEmbedUrl(url, options) || bilibiliEmbedUrl(url, options);
  }

  function saveMediaHistory({ url, title, kind, videoId = null, platform = null }) {
    fetch(`${API}/media/history`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, title: title || "", kind, videoId, platform }),
    }).catch(() => {});
  }

  async function validateYoutubeUrl(url) {
    try {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetch(oembed, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return null; // network failure — don't block, allow playback to proceed
    }
  }

  function stopCamera() {
    videoStream?.getTracks().forEach(t => t.stop());
    videoStream = null;
  }

  function setPanelVisible(visible) {
    videoActive = Boolean(visible);
    document.body.classList.toggle("video-mode", videoActive);
    videoBtn?.classList.toggle("active", videoActive);
    if (videoActive) moveVoicePanelToBody();
    else restoreVoicePanel();
    window.dispatchEvent(new CustomEvent("xiaobailong:video-mode", {
      detail: { active: videoActive, kind: videoKind },
    }));
  }

  function pauseCurrentVideo() {
    if (videoKind === "youtube") {
      postFrameCommand("pauseVideo");
      playResumeAt = null;
    } else if (videoKind === "bilibili") {
      // bilibili iframe 跨域读不到 currentTime，用 wall-clock 估算累计进度
      if (playResumeAt) {
        const elapsed = (Date.now() - playResumeAt) / 1000;
        currentVideoStart = (Number(currentVideoStart) || 0) + elapsed;
      }
      playResumeAt = null;
      reloadFrameAutoplay(false);
    } else if (videoKind === "file") {
      try { videoFeed?.pause?.(); } catch {}
      playResumeAt = null;
    }
  }

  function resumeCurrentVideo() {
    if (videoKind === "youtube") {
      postFrameCommand("playVideo");
      playResumeAt = Date.now();
    } else if (videoKind === "bilibili") {
      reloadFrameAutoplay(true);
      playResumeAt = Date.now();
    } else if (videoKind === "file") {
      videoFeed?.play?.().catch(() => {});
      playResumeAt = Date.now();
    }
  }

  function resetVideoSurface() {
    stopCamera();
    if (videoFeed) {
      try { videoFeed.pause(); } catch {}
      videoFeed.removeAttribute("src");
      videoFeed.srcObject = null;
      videoFeed.hidden = true;
      videoFeed.load?.();
    }
    if (videoFrame) {
      videoFrame.src = "about:blank";
      videoFrame.hidden = true;
    }
    if (videoBackdrop) videoBackdrop.style.backgroundImage = "";
    videoSurface?.classList.remove("has-media");
    videoKind = "empty";
    currentVideoSource = "";
    currentVideoStart = null;
    playResumeAt = null;
  }

  function toggleVideoPanelVisibility() {
    if (videoActive) {
      pauseCurrentVideo();
      setPanelVisible(false);
    } else {
      if (musicActive) closeMusicPanel();
      setPanelVisible(true);
      if (videoKind !== "empty") resumeCurrentVideo();
    }
  }

  function closeAndDestroyVideo() {
    setPanelVisible(false);
    resetVideoSurface();
  }

  function setVideoModeActive(active) {
    if (!active) {
      closeAndDestroyVideo();
    } else {
      setPanelVisible(true);
    }
  }

  function setBackdrop(kind, url) {
    if (!videoBackdrop) return;
    if (kind === "youtube") {
      const id = extractYoutubeId(url);
      if (id) {
        videoBackdrop.style.backgroundImage =
          `url(https://img.youtube.com/vi/${id}/maxresdefault.jpg)`;
        return;
      }
    }
    // Bilibili / file / camera: solid color fallback (CSS already sets #000 background)
    videoBackdrop.style.backgroundImage = "";
  }

  async function showCamera({ title = "Camera", autoplay = true } = {}) {
    setPanelVisible(true);
    resetVideoSurface();
    if (videoTitle) videoTitle.textContent = title;
    try {
      videoStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (videoFeed) {
        videoFeed.hidden = false;
        videoFeed.muted = true;
        videoFeed.srcObject = videoStream;
        if (autoplay) videoFeed.play?.().catch(() => {});
      }
      videoSurface?.classList.add("has-media");
      videoKind = "camera";
    } catch (e) {
      console.warn("Camera access failed:", e);
    }
  }

  async function showVideo({
    url = "", title = "Video", autoplay = true,
    muted = false, volume = null, currentTime = null, camera = false,
  } = {}) {
    if (camera) { showCamera({ title, autoplay }); return; }

    const source = normalizeUrl(url);
    if (musicActive) closeMusicPanel();
    setPanelVisible(true);
    resetVideoSurface();
    currentVideoSource = source;
    currentVideoStart = Number.isFinite(Number(currentTime)) ? Math.max(0, Number(currentTime)) : null;
    if (videoTitle) videoTitle.textContent = title || "Video";

    const embedUrl = iframeUrlFor(source, { autoplay, start: currentTime });
    if (embedUrl && videoFrame) {
      videoFrame.hidden = false;
      videoFrame.src = embedUrl;
      videoSurface?.classList.add("has-media");
      videoKind = embedUrl.includes("youtube.com") ? "youtube" : "bilibili";
      if (autoplay) playResumeAt = Date.now();

      setBackdrop(videoKind, source);
      saveMediaHistory({
        url: source,
        title,
        kind: videoKind,
        videoId: videoKind === "youtube" ? extractYoutubeId(source) : extractBilibiliId(source),
        platform: videoKind,
      });

      if (videoKind === "youtube") {
        validateYoutubeUrl(source).then(ok => {
          if (ok === false) console.warn("[Media] YouTube video may not play (region block / private / deleted):", source);
        });
      }
      return;
    }

    if (videoFeed && source) {
      videoFeed.hidden = false;
      videoFeed.src = source;
      videoFeed.muted = Boolean(muted);
      if (Number.isFinite(Number(volume))) videoFeed.volume = Math.max(0, Math.min(1, Number(volume)));
      if (Number.isFinite(Number(currentTime))) videoFeed.currentTime = Math.max(0, Number(currentTime));
      videoSurface?.classList.add("has-media");
      videoKind = "file";
      saveMediaHistory({ url: source, title, kind: "file" });
      if (autoplay) {
        videoFeed.play?.().catch(() => {});
        playResumeAt = Date.now();
      }
    }
  }

  function postFrameCommand(command, args = []) {
    if (!videoFrame?.contentWindow || videoFrame.hidden) return;
    if (videoKind === "youtube") {
      videoFrame.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: command,
        args,
      }), "*");
    }
  }

  function reloadFrameAutoplay(autoplay) {
    if (!videoFrame || videoFrame.hidden || !currentVideoSource) return;
    const nextUrl = iframeUrlFor(currentVideoSource, {
      autoplay,
      start: currentVideoStart,
    });
    if (nextUrl) videoFrame.src = nextUrl;
  }

  function controlVideo({ action, volume, currentTime, autoplay } = {}) {
    const op = action || (autoplay ? "play" : null);
    if (op === "hide" || op === "close") { closeAndDestroyVideo(); return; }
    if (op === "play") resumeCurrentVideo();
    if (op === "pause") pauseCurrentVideo();
    if (Number.isFinite(Number(volume))) {
      const v = Math.max(0, Math.min(1, Number(volume)));
      if (videoFeed) { videoFeed.volume = v; videoFeed.muted = v === 0; }
      postFrameCommand("setVolume", [Math.round(v * 100)]);
    }
    if (Number.isFinite(Number(currentTime))) {
      const t = Math.max(0, Number(currentTime));
      currentVideoStart = t;
      if (videoFeed) videoFeed.currentTime = t;
      postFrameCommand("seekTo", [t, true]);
      // seek 后重置 elapsed 基线，下次 pause 时累计才正确
      if (playResumeAt) playResumeAt = Date.now();
    }
  }

  function setImageModeActive(active) {
    imageActive = Boolean(active);
    document.body.classList.toggle("image-mode", imageActive);
    if (!imageActive && imageDisplay) {
      imageDisplay.removeAttribute("src");
      imageDisplay.alt = "";
      imageSurface?.classList.remove("has-media");
    }
  }

  function showImage({ url = "", title = "Image", alt = "" } = {}) {
    const source = normalizeUrl(url);
    setImageModeActive(true);
    if (imageTitle) imageTitle.textContent = title || "Image";
    if (imageDisplay && source) {
      imageDisplay.src = source;
      imageDisplay.alt = alt || title || "";
      imageSurface?.classList.add("has-media");
    }
  }

  function handleMediaCommand(payload = {}) {
    const mode   = payload.mode || payload.kind;
    const action = payload.action || "show";
    if (mode === "image") {
      if (action === "hide" || action === "close") setImageModeActive(false);
      else showImage(payload);
      return { ok: true, mode: "image", action };
    }
    if (mode === "camera") {
      if (action === "hide" || action === "close") closeAndDestroyVideo();
      else showCamera(payload);
      return { ok: true, mode: "camera", action };
    }
    if (mode === "video") {
      if (action === "show" || payload.url || payload.camera) showVideo(payload);
      else controlVideo(payload);
      return { ok: true, mode: "video", action };
    }
    if (mode === "music") {
      if (action === "show" || payload.src || payload.playlist) showMusic(payload);
      else controlMusic(payload);
      return { ok: true, mode: "music", action };
    }
    return { ok: false, error: "unknown media mode" };
  }

  // ── Music mode ────────────────────────────────────────────────────────────
  const musicBtn       = document.getElementById("music-btn");
  const musicExitBtn   = document.getElementById("music-exit-btn");
  const musicAudio     = document.getElementById("music-audio");
  const musicPlayBtn   = document.getElementById("music-play");
  const musicPrevBtn   = document.getElementById("music-prev");
  const musicNextBtn   = document.getElementById("music-next");
  const musicSeek      = document.getElementById("music-seek");
  const musicVolInput  = document.getElementById("music-vol");
  const musicTimeCur   = document.getElementById("music-time-cur");
  const musicTimeTotal = document.getElementById("music-time-total");
  const musicMetaTitle  = document.getElementById("music-meta-title");
  const musicMetaArtist = document.getElementById("music-meta-artist");
  const musicCoverEl    = document.getElementById("music-cover");
  const musicCoverTitle = document.getElementById("music-cover-title");
  const musicCoverArtist = document.getElementById("music-cover-artist");
  const musicLyricsScroll = document.getElementById("music-lyrics-scroll");
  const musicNoLyrics     = document.getElementById("music-no-lyrics");

  let musicActive  = false;
  let musicPlaying = false;
  let musicWasPlayingBeforeHide = false;
  let lrcLines     = [];
  let playlist     = [];
  let playlistIdx  = 0;
  let isSeeking    = false;

  function parseLrc(text) {
    const lines = [];
    const re = /\[(\d+):(\d{1,2}(?:\.\d+)?)\](.*)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const t = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
      const txt = m[3].trim();
      if (txt) lines.push({ time: t, text: txt });
    }
    return lines.sort((a, b) => a.time - b.time);
  }

  function fmtTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  }

  function setMusicPanelVisible(visible) {
    musicActive = Boolean(visible);
    document.body.classList.toggle("music-mode", musicActive);
    musicBtn?.classList.toggle("active", musicActive);
    window.dispatchEvent(new CustomEvent("xiaobailong:music-mode", {
      detail: { active: musicActive },
    }));
  }

  function setMusicPlaying(playing) {
    musicPlaying = Boolean(playing);
    document.body.classList.toggle("music-playing", musicPlaying);
    if (musicPlayBtn) musicPlayBtn.textContent = musicPlaying ? "⏸" : "▶";
    if (musicPlaying) {
      musicAudio?.play?.().catch(() => {});
    } else {
      musicAudio?.pause?.();
    }
  }

  function loadLrc(lrcText) {
    lrcLines = lrcText ? parseLrc(lrcText) : [];
    if (musicLyricsScroll) {
      musicLyricsScroll.innerHTML = lrcLines
        .map((l, i) => `<div class="lrc-line" data-idx="${i}">${l.text}</div>`)
        .join("");
    }
    if (musicNoLyrics) musicNoLyrics.hidden = lrcLines.length > 0;
  }

  function syncLyrics(currentTime) {
    if (!lrcLines.length || !musicLyricsScroll) return;
    let active = -1;
    for (let i = 0; i < lrcLines.length; i++) {
      if (lrcLines[i].time <= currentTime + 0.3) active = i;
      else break;
    }
    if (active < 0) return;
    const lines = musicLyricsScroll.querySelectorAll(".lrc-line");
    lines.forEach((el, i) => el.classList.toggle("active", i === active));
    const activeLine = lines[active];
    if (activeLine) {
      const pane = document.getElementById("music-lyrics-pane");
      if (pane) pane.scrollTo({ top: activeLine.offsetTop - pane.clientHeight / 2 + activeLine.clientHeight / 2, behavior: "smooth" });
    }
  }

  function loadTrack(index, autoplay = true) {
    const track = playlist[index];
    if (!track || !musicAudio) return;

    musicAudio.src = localPathToUrl(track.src || "");
    musicAudio.volume = parseFloat(musicVolInput?.value ?? "0.8");

    const title  = track.title  || "未知曲目";
    const artist = track.artist || "";
    if (musicMetaTitle)  musicMetaTitle.textContent  = title;
    if (musicMetaArtist) musicMetaArtist.textContent = artist;
    if (musicCoverTitle)  musicCoverTitle.textContent  = title.slice(0, 14);
    if (musicCoverArtist) musicCoverArtist.textContent = artist;
    if (musicTimeCur)   musicTimeCur.textContent   = "0:00";
    if (musicTimeTotal) musicTimeTotal.textContent = "0:00";
    if (musicSeek)      { musicSeek.value = "0"; musicSeek.max = "100"; }

    if (track.cover && musicCoverEl) {
      musicCoverEl.style.backgroundImage = `url(${track.cover})`;
      musicCoverEl.style.background = "";
    } else if (musicCoverEl) {
      musicCoverEl.style.backgroundImage = "";
      let hash = 0;
      for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
      const hue = Math.abs(hash) % 360;
      musicCoverEl.style.background = `hsl(${hue}, 45%, 32%)`;
    }

    loadLrc(track.lrc || "");
    if (autoplay) setMusicPlaying(true);
  }

  function showMusic({
    src = "", title = "", artist = "", lrc = "", cover = "",
    autoplay = true, playlist: pl = null,
  } = {}) {
    if (videoActive) closeAndDestroyVideo();
    setMusicPanelVisible(true);
    if (pl && pl.length) {
      playlist = pl;
    } else {
      playlist = [{ src, title, artist, lrc, cover }];
    }
    playlistIdx = 0;
    loadTrack(0, autoplay);
  }

  function closeMusicPanel() {
    setMusicPlaying(false);
    setMusicPanelVisible(false);
    if (musicAudio) musicAudio.src = "";
    lrcLines = [];
    if (musicLyricsScroll) musicLyricsScroll.innerHTML = "";
    if (musicNoLyrics) musicNoLyrics.hidden = false;
  }

  function controlMusic({ action, volume, currentTime } = {}) {
    if (action === "hide" || action === "close") { closeMusicPanel(); return; }
    if (action === "play")  setMusicPlaying(true);
    if (action === "pause") setMusicPlaying(false);
    if (Number.isFinite(Number(volume))) {
      const v = Math.max(0, Math.min(1, Number(volume)));
      if (musicAudio) musicAudio.volume = v;
      if (musicVolInput) musicVolInput.value = String(v);
    }
    if (Number.isFinite(Number(currentTime)) && musicAudio) {
      musicAudio.currentTime = Math.max(0, Number(currentTime));
    }
  }

  function toggleMusicPanelVisibility() {
    if (musicActive) {
      musicWasPlayingBeforeHide = musicPlaying;
      setMusicPlaying(false);
      setMusicPanelVisible(false);
    } else if (musicAudio?.src) {
      if (videoActive) closeAndDestroyVideo();
      setMusicPanelVisible(true);
      if (musicWasPlayingBeforeHide) setMusicPlaying(true);
    }
  }

  if (musicAudio) {
    musicAudio.addEventListener("loadedmetadata", () => {
      if (musicTimeTotal) musicTimeTotal.textContent = fmtTime(musicAudio.duration);
      if (musicSeek) musicSeek.max = String(musicAudio.duration || 100);
    });
    musicAudio.addEventListener("timeupdate", () => {
      if (isSeeking) return;
      const t = musicAudio.currentTime;
      if (musicTimeCur) musicTimeCur.textContent = fmtTime(t);
      if (musicSeek && musicAudio.duration) musicSeek.value = String(t);
      syncLyrics(t);
    });
    musicAudio.addEventListener("ended", () => {
      setMusicPlaying(false);
      if (playlistIdx < playlist.length - 1) {
        playlistIdx++;
        loadTrack(playlistIdx, true);
      }
    });
  }

  musicPlayBtn?.addEventListener("click", () => setMusicPlaying(!musicPlaying));
  musicPrevBtn?.addEventListener("click", () => {
    if (playlistIdx > 0) { playlistIdx--; loadTrack(playlistIdx, musicPlaying); }
    else if (musicAudio) musicAudio.currentTime = 0;
  });
  musicNextBtn?.addEventListener("click", () => {
    if (playlistIdx < playlist.length - 1) { playlistIdx++; loadTrack(playlistIdx, musicPlaying); }
  });
  musicVolInput?.addEventListener("input", () => {
    if (musicAudio) musicAudio.volume = parseFloat(musicVolInput.value);
  });
  musicSeek?.addEventListener("mousedown", () => { isSeeking = true; });
  musicSeek?.addEventListener("input", () => {
    if (musicTimeCur) musicTimeCur.textContent = fmtTime(parseFloat(musicSeek.value));
  });
  musicSeek?.addEventListener("change", () => {
    if (musicAudio) musicAudio.currentTime = parseFloat(musicSeek.value);
    isSeeking = false;
  });
  musicExitBtn?.addEventListener("click", closeMusicPanel);
  musicBtn?.addEventListener("click", toggleMusicPanelVisibility);

  window.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      toggleMusicPanelVisibility();
    }
  });

  window.xiaobailongMedia = { handle: handleMediaCommand, showVideo, controlVideo, showImage, showCamera, showMusic, controlMusic };
  window.addEventListener("xiaobailong:media", (event) => handleMediaCommand(event.detail || {}));

  // Push-to-talk：按住空格说话；Agent 正在说话时按下空格直接打断
  (() => {
    let pttHeld = false;
    const isSpace = (e) => e.code === "Space" || e.key === " " || e.key === "Spacebar";
    const isTypingTarget = (t) =>
      !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);

    window.addEventListener("keydown", (e) => {
      if (!isSpace(e)) return;
      if (isTypingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      e.preventDefault();
      if (e.repeat) return;
      if (pttHeld) return;
      pttHeld = true;
      // 不论是否在播，stopTTS 内部已做 no-op 守卫
      try { window.stopTTS?.(); } catch {}
      window.xiaobailongVoice?.pttStart?.();
    }, { capture: true });

    window.addEventListener("keyup", (e) => {
      if (!isSpace(e)) return;
      if (!pttHeld) return;
      pttHeld = false;
      e.preventDefault();
      window.xiaobailongVoice?.pttEnd?.();
    }, { capture: true });

    // 切到后台/失焦（如点开 DevTools、切窗口）时如果还按着，强制释放 PTT，避免 mic 永远不关。
    // 关键：用 send:false —— 失焦不是"主动松手发送"，不能把没说完的半句误发出去。
    window.addEventListener("blur", () => {
      if (!pttHeld) return;
      pttHeld = false;
      window.xiaobailongVoice?.pttEnd?.({ send: false });
    });
  })();

  videoBtn?.addEventListener("click", toggleVideoPanelVisibility);
  videoExitBtn?.addEventListener("click", closeAndDestroyVideo);
  imageExitBtn?.addEventListener("click", () => setImageModeActive(false));

  window.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA" || e.target?.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "v" || e.key === "V") {
      e.preventDefault();
      toggleVideoPanelVisibility();
    }
    // H key: toggle hotspot mode
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      toggleHotspot();
    }
  });
})();


// ── AI 视频生成模式（Seedance · 生成工作台）──
// 三段式：生成栏(多任务队列) + 播放区 + 输入区。全程由 aivideo_mode SSE 事件驱动。
(function initAIVideoMode(){
  var el = function(id){ return document.getElementById(id); };
  var panel = el("aivideo-panel");
  if (!panel) return;
  var queueEl=el("aivideo-queue"), stage=el("aivideo-stage"), stageEmpty=el("aivideo-stage-empty"),
      feed=el("aivideo-feed"), dlBtn=el("aivideo-dl"), playerMeta=el("aivideo-player-meta"),
      dropzone=el("aivideo-dropzone"), modeTag=el("aivideo-modetag"), modeHint=el("aivideo-modehint"),
      promptInput=el("aivideo-prompt-input"), ratioSel=el("aivideo-ratio"), resSel=el("aivideo-resolution"),
      durSel=el("aivideo-duration"), submitBtn=el("aivideo-submit"), composeErr=el("aivideo-compose-err"),
      fileInput=el("aivideo-file-input"), newBtn=el("aivideo-new-btn"), exitBtn=el("aivideo-exit-btn");

  var active=false, jobs=[], selId=null, images=[], submitting=false;

  var toastEl=document.createElement("div"); toastEl.className="aivideo-toast"; document.body.appendChild(toastEl);
  var toastTimer=null;
  function showToast(html){ toastEl.innerHTML=html; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(function(){ toastEl.classList.remove("show"); },3200); }

  function mediaUrl(u){ var s=String(u||""); if(!s) return ""; return s.charAt(0)==="/" ? (API+s) : s; }
  function modeLabel(m){ return m==="flf"?"首尾帧":(m==="image"?"图生视频":"文生视频"); }
  function jobById(id){ for(var i=0;i<jobs.length;i++){ if(jobs[i].id===id) return jobs[i]; } return null; }

  // —— 感知同步：把「面板开关 + 提示词草稿」实时回传后端，让 agent 能直接看到用户在框里写了什么 ——
  var draftTimer=null, lastDraftSent=null;
  function syncDraft(immediate){
    clearTimeout(draftTimer);
    var doSync=function(){
      var payload=JSON.stringify({ open:active, prompt:(promptInput.value||"") });
      if(payload===lastDraftSent) return;            // 没变化就不发，省流量
      lastDraftSent=payload;
      try{ fetch(API+"/aivideo/draft",{method:"POST",headers:{"Content-Type":"application/json"},body:payload}).catch(function(){}); }catch(e){}
    };
    if(immediate) doSync(); else draftTimer=setTimeout(doSync,400);
  }

  function setActive(on){
    active=!!on; document.body.classList.toggle("aivideo-mode", active);
    if(active){ try{ window.xiaobailongMedia&&window.xiaobailongMedia.controlVideo&&window.xiaobailongMedia.controlVideo({action:"pause"}); }catch(e){} document.body.classList.remove("video-mode"); }
    syncDraft(true);   // 开/关状态立即同步
  }

  // —— 生成栏 ——
  function renderQueue(){
    queueEl.innerHTML="";
    if(!jobs.length){ var em=document.createElement("div"); em.className="aivideo-queue-empty"; em.textContent="还没有生成任务"; queueEl.appendChild(em); return; }
    jobs.forEach(function(j){
      var t=document.createElement("div");
      t.className="av-tile "+(j.status==="gen"?"gen":j.status==="fail"?"fail":"")+(j.id===selId?" sel":"");
      var fr=document.createElement("div"); fr.className="frame";
      if(j.status==="done"){
        var v=document.createElement("video"); v.className="thumb"; v.src=mediaUrl(j.videoUrl); v.muted=true; v.playsInline=true; v.preload="metadata"; fr.appendChild(v);
        var pl=document.createElement("div"); pl.className="play"; pl.textContent="▶"; fr.appendChild(pl);
        if(j.dur){ var d=document.createElement("div"); d.className="dur"; d.textContent=j.dur+"s"; fr.appendChild(d); }
      } else if(j.status==="gen"){
        var orb=document.createElement("div"); orb.className="av-orb"; orb.innerHTML="<i></i><i></i>"; fr.appendChild(orb);
        var gb=document.createElement("div"); gb.className="genbadge"; gb.textContent="生成中"; fr.appendChild(gb);
        var gt=document.createElement("div"); gt.className="gentime"; gt.dataset.start=String(j.start||Date.now()); gt.textContent="0:00"; fr.appendChild(gt);
      } else {
        var x=document.createElement("div"); x.className="x"; x.textContent="!"; fr.appendChild(x);
      }
      if(j.status!=="gen"){ var rm=document.createElement("button"); rm.className="rm"; rm.textContent="×"; rm.onclick=function(e){ e.stopPropagation(); removeJob(j.id); }; fr.appendChild(rm); }
      t.appendChild(fr);
      var lb=document.createElement("div"); lb.className="label";
      lb.textContent = j.status==="fail" ? ("失败 · "+(j.error||"")) : (j.prompt || modeLabel(j.mode));
      t.appendChild(lb);
      t.onclick=function(){ if(j.status==="done") loadPlayer(j); };
      queueEl.appendChild(t);
    });
  }
  function tickTimers(){ var now=Date.now(); var list=queueEl.querySelectorAll(".gentime"); for(var i=0;i<list.length;i++){ var s=Math.floor((now-Number(list[i].dataset.start))/1000); if(s<0)s=0; list[i].textContent=Math.floor(s/60)+":"+String(s%60).padStart(2,"0"); } }
  setInterval(tickTimers,500);
  function removeJob(id){ jobs=jobs.filter(function(j){ return j.id!==id; }); if(selId===id){ selId=null; clearPlayer(); } renderQueue(); }

  // —— 重建历史：从后端拉已完成视频（newest-first），合并进 jobs。 ——
  // 修复「面板关闭重开 / app 重启后队列空了」：jobs[] 原本纯内存，重载即丢，
  // 而视频其实还在磁盘。这里按 id 去重，不覆盖本会话进行中的瓦片。
  function hydrateHistory(){
    fetch(API+"/aivideo/history").then(function(r){ return r.json(); }).then(function(d){
      if(!d||!d.ok||!Array.isArray(d.jobs)) return;
      var changed=false;
      d.jobs.forEach(function(h){
        if(!h||!h.id) return;
        var ex=jobById(h.id);
        if(ex){
          if(ex.status!=="done"&&h.videoUrl){ ex.status="done"; ex.videoUrl=h.videoUrl; ex.mode=ex.mode||h.mode; ex.prompt=ex.prompt||h.prompt; ex.res=ex.res||h.res; ex.ratio=ex.ratio||h.ratio; ex.dur=ex.dur||h.dur; changed=true; }
          return;
        }
        jobs.push({ id:h.id, status:"done", videoUrl:h.videoUrl, mode:h.mode, prompt:h.prompt, res:h.res, ratio:h.ratio, dur:h.dur });
        changed=true;
      });
      if(changed) renderQueue();
    }).catch(function(){});
  }

  // —— 播放区 ——
  function clearPlayer(){ try{ feed.pause(); }catch(e){} feed.removeAttribute("src"); if(feed.load) feed.load(); feed.hidden=true; dlBtn.hidden=true; stageEmpty.hidden=false; if(stage) stage.classList.add("is-empty"); playerMeta.textContent=""; }
  function loadPlayer(j){
    selId=j.id; feed.src=mediaUrl(j.videoUrl); feed.hidden=false; feed.muted=false; dlBtn.hidden=false; stageEmpty.hidden=true; if(stage) stage.classList.remove("is-empty");
    playerMeta.innerHTML="<b>"+modeLabel(j.mode)+"</b>"+(j.res?" · "+j.res:"")+(j.ratio?" · "+j.ratio:"")+(j.dur?" · "+j.dur+"s":"");
    if(feed.play) feed.play().catch(function(){}); renderQueue();
  }
  function download(){
    if(!selId) return; dlBtn.disabled=true; var old=dlBtn.textContent; dlBtn.textContent="保存中…";
    fetch(API+"/aivideo/save",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId:selId})})
      .then(function(r){ return r.json(); })
      .then(function(d){ if(d&&d.ok){ showToast('已保存到　<span class="mono">'+(d.path||"")+'</span>'); } else { showToast('保存失败：'+((d&&d.error)||"未知错误")); } })
      .catch(function(e){ showToast('保存失败：'+e.message); })
      .then(function(){ dlBtn.disabled=false; dlBtn.textContent=old; });
  }
  dlBtn.addEventListener("click", download);

  // —— 输入区：加图（点击/拖拽/粘贴，最多 2 张）——
  function renderDropzone(){
    dropzone.innerHTML="";
    images.forEach(function(src,i){
      var cell=document.createElement("div"); cell.className="av-imgcell";
      var im=document.createElement("img"); im.src=src; cell.appendChild(im);
      var r=document.createElement("div"); r.className="role"; r.textContent=images.length===2?(i===0?"首帧":"尾帧"):"参考图"; cell.appendChild(r);
      var rm=document.createElement("button"); rm.className="rm"; rm.textContent="×"; rm.onclick=function(e){ e.stopPropagation(); images.splice(i,1); renderDropzone(); updateMode(); }; cell.appendChild(rm);
      dropzone.appendChild(cell);
    });
    if(images.length<2){ var add=document.createElement("div"); add.className="av-addcell"; add.innerHTML='<span class="plus">+</span><span>图片</span><small>点击/拖拽/粘贴</small>'; add.onclick=function(){ fileInput.click(); }; dropzone.appendChild(add); }
  }
  var hadImages=false;
  function updateMode(){
    var m=images.length>=2?"flf":(images.length===1?"image":"text");
    // 进入图生/首尾帧默认「适配图片」(输出比例跟随上传图)；退回文生时恢复 16:9。仅在边界切换，尊重用户在同一模式内的手动选择
    if(images.length>0 && !hadImages){ ratioSel.value="adaptive"; }
    else if(images.length===0 && hadImages && ratioSel.value==="adaptive"){ ratioSel.value="16:9"; }
    hadImages=images.length>0;
    modeTag.textContent=modeLabel(m); modeTag.classList.toggle("flf", m==="flf");
    modeHint.textContent = m==="text" ? "不加图 = 文生视频 · 1 张 = 图生视频 · 2 张 = 首尾帧"
      : m==="image" ? "已加 1 张参考图 → 图生视频（比例已设为「适配图片」）"
      : "已加 2 张 → 首尾帧：第 1 张为「首帧」，第 2 张为「尾帧」";
  }
  function addImage(src){ if(images.length>=2) return; images.push(src); renderDropzone(); updateMode(); }
  fileInput.addEventListener("change", function(e){ var f=e.target.files&&e.target.files[0]; if(f){ var rd=new FileReader(); rd.onload=function(){ addImage(String(rd.result||"")); }; rd.readAsDataURL(f); } e.target.value=""; });
  ["dragenter","dragover"].forEach(function(ev){ dropzone.addEventListener(ev,function(e){ e.preventDefault(); dropzone.classList.add("dragover"); }); });
  ["dragleave","drop"].forEach(function(ev){ dropzone.addEventListener(ev,function(e){ e.preventDefault(); dropzone.classList.remove("dragover"); }); });
  dropzone.addEventListener("drop", function(e){ var f=e.dataTransfer&&e.dataTransfer.files&&e.dataTransfer.files[0]; if(f&&f.type.indexOf("image/")===0){ var rd=new FileReader(); rd.onload=function(){ addImage(String(rd.result||"")); }; rd.readAsDataURL(f); } });
  document.addEventListener("paste", function(e){
    if(!active) return; var cd=e.clipboardData||window.clipboardData; var items=cd&&cd.items; if(!items) return;
    for(var i=0;i<items.length;i++){ if(items[i].type.indexOf("image")===0){ var blob=items[i].getAsFile(); var rd=new FileReader(); rd.onload=function(){ addImage(String(rd.result||"")); }; rd.readAsDataURL(blob); e.preventDefault(); break; } }
  });

  var PROMPT_MIN=46, PROMPT_MAX=160;
  function autoGrow(){
    if(!promptInput.clientWidth){ promptInput.style.height=""; return; } // 面板隐藏(宽0)时测量会拿到错误的 scrollHeight，跳过，交给 CSS min-height
    promptInput.style.height="auto";
    var b=promptInput.offsetHeight-promptInput.clientHeight;
    promptInput.style.height=Math.min(PROMPT_MAX, Math.max(PROMPT_MIN, promptInput.scrollHeight+b))+"px";
  }
  promptInput.addEventListener("input", function(){ autoGrow(); syncDraft(); });

  // —— 提交生成 ——
  function submitGenerate(){
    if(submitting) return;
    var prompt=(promptInput.value||"").trim();
    if(!prompt && images.length===0){ composeErr.textContent="请至少输入一段画面描述（或加一张参考图）"; composeErr.hidden=false; return; }
    composeErr.hidden=true; submitting=true; submitBtn.disabled=true; submitBtn.textContent="提交中…";
    fetch(API+"/aivideo/generate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ prompt:prompt, images:images.slice(0,2), ratio:ratioSel.value, resolution:resSel.value, duration:Number(durSel.value)||5 })})
      .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
      .then(function(res){
        submitting=false; submitBtn.disabled=false; submitBtn.textContent="生成";
        if(!res.ok || !res.d || !res.d.ok){ var d=res.d||{}; composeErr.textContent=d.guide||d.error||"提交失败"; composeErr.hidden=false; return; }
        promptInput.value=""; autoGrow(); images=[]; renderDropzone(); updateMode(); syncDraft(true);
      })
      .catch(function(e){ submitting=false; submitBtn.disabled=false; submitBtn.textContent="生成"; composeErr.textContent="网络错误："+e.message; composeErr.hidden=false; });
  }
  submitBtn.addEventListener("click", submitGenerate);
  promptInput.addEventListener("keydown", function(e){ if((e.ctrlKey||e.metaKey)&&e.key==="Enter"){ e.preventDefault(); submitGenerate(); } });

  // —— 打开/关闭 ——
  function openPanel(configured){
    setActive(true);
    hydrateHistory();   // 每次打开都拉一次历史，重建之前生成的视频队列
    if(configured===false){ composeErr.textContent="尚未配置火山方舟（Seedance）API Key —— 把 key 发给MyAI即可（例如「火山视频 你的APIKey」），配置后就能在这里生成。"; composeErr.hidden=false; }
    else composeErr.hidden=true;
    setTimeout(function(){ try{ promptInput.focus(); }catch(e){} },60);
  }
  function closePanel(){ setActive(false); try{ feed.pause(); }catch(e){} }
  newBtn.addEventListener("click", function(){ images=[]; renderDropzone(); updateMode(); promptInput.value=""; autoGrow(); composeErr.hidden=true; syncDraft(true); try{ promptInput.focus(); }catch(e){} });
  exitBtn.addEventListener("click", closePanel);
  window.addEventListener("keydown", function(e){ if(!active) return; if(e.key==="Escape"){ if(document.activeElement===promptInput){ promptInput.blur(); return; } e.preventDefault(); closePanel(); } });

  // —— SSE 事件 ——
  function handle(data){
    data=data||{}; var action=data.action||"show";
    if(action==="hide"||action==="close"){ closePanel(); return; }
    if(action==="open"){ openPanel(data.configured); return; }
    if(action==="set_prompt"){
      // agent 在用户确认采用后，把优化好的提示词写回输入框（覆盖草稿）
      if(!active) setActive(true);
      promptInput.value=String(data.prompt||""); autoGrow(); syncDraft(true);
      showToast("已采用优化后的提示词，检查后点「生成」即可");
      try{ promptInput.focus(); }catch(e){}
      return;
    }
    if(action==="show"){
      setActive(true);
      var j=jobById(data.jobId);
      if(!j){ j={ id:data.jobId, status:"gen", start:Date.now() }; jobs.unshift(j); }
      j.status="gen"; j.prompt=data.prompt||j.prompt||""; j.mode=data.mode||j.mode||"text";
      j.res=data.resolution||j.res; j.ratio=data.ratio||j.ratio; j.dur=data.duration||j.dur;
      if(!j.start) j.start=Date.now();
      renderQueue(); return;
    }
    var job=jobById(data.jobId); if(!job) return;
    if(action==="progress"){ job.status="gen"; return; }
    if(action==="ready"){ job.status="done"; job.videoUrl=data.videoUrl; renderQueue(); if(!active) setActive(true); loadPlayer(job); return; }
    if(action==="error"){ job.status="fail"; job.error=data.message||"生成失败"; renderQueue(); return; }
  }
  window.addEventListener("xiaobailong:aivideo", function(e){ handle(e.detail||{}); });
  window.xiaobailongAIVideo={ handle:handle, open:openPanel, close:closePanel };

  renderDropzone(); updateMode(); renderQueue(); autoGrow();
  hydrateHistory();   // 初始化即重建一次（覆盖 app 重启/渲染进程重载后的历史恢复）
})();
