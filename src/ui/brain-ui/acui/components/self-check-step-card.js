// ACUI SelfCheckStepCard — 自检单步进度卡片
// 用法：ui_show("SelfCheckStepCard", { step: 1, total: 4, name: "文件读写功能", icon: "📁" })
// 无自动关闭，需调用 ui_hide 手动关闭

const STEP_COLOR = '#60a5fa'

const CSS = `
  :host { display: block; pointer-events: auto; }
  .card {
    width: 288px;
    padding: 16px 18px 14px;
    border-radius: 14px;
    background: rgba(8, 14, 22, 0.92);
    border: 1px solid rgba(96, 165, 250, 0.22);
    box-shadow: 0 16px 48px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.04);
    backdrop-filter: blur(20px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #e2eaf5;
    user-select: none;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 12px;
  }
  .header-icon { font-size: 16px; line-height: 1; }
  .header-text { font-size: 13px; font-weight: 600; color: #c8d8ee; letter-spacing: 0.03em; flex: 1; }
  .header-counter { font-size: 11px; color: #4a6080; font-variant-numeric: tabular-nums; }
  .body {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .pulse-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: ${STEP_COLOR};
    flex-shrink: 0;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%       { opacity: 0.4; transform: scale(0.7); }
  }
  .step-name {
    font-size: 14px;
    font-weight: 600;
    color: ${STEP_COLOR};
    letter-spacing: 0.01em;
  }
  .scan-wrap {
    height: 2px;
    background: rgba(96,165,250,0.12);
    border-radius: 1px;
    overflow: hidden;
  }
  .scan-bar {
    height: 100%;
    width: 30%;
    border-radius: 1px;
    background: ${STEP_COLOR};
    animation: scan 1.6s ease-in-out infinite;
  }
  @keyframes scan {
    0%   { transform: translateX(-100%); opacity: 0.8; }
    50%  { opacity: 1; }
    100% { transform: translateX(380%); opacity: 0.8; }
  }
`

const _stepSheet = new CSSStyleSheet()
_stepSheet.replaceSync(CSS)

class SelfCheckStepCard extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.adoptedStyleSheets = [_stepSheet]
    this._props = {}
  }

  set props(v) {
    this._props = v || {}
    this._render()
  }

  connectedCallback() { this._render() }

  _render() {
    const { step = 1, total = 4, name = '', icon = '🔍' } = this._props
    this.shadowRoot.innerHTML = `
      <div class="card">
        <div class="header">
          <span class="header-icon">${icon}</span>
          <span class="header-text">能力自检</span>
          <span class="header-counter">${step} / ${total}</span>
        </div>
        <div class="body">
          <span class="pulse-dot"></span>
          <span class="step-name">正在检查${name}</span>
        </div>
        <div class="scan-wrap">
          <div class="scan-bar"></div>
        </div>
      </div>`
  }
}

SelfCheckStepCard.tagName = 'acui-self-check-step-card'
customElements.define(SelfCheckStepCard.tagName, SelfCheckStepCard)

export { SelfCheckStepCard }
