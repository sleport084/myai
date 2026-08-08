// ACUI SelfCheckCard — startup self-check result card
// Usage: ui_show("SelfCheckCard", { results: [{name, status, note?}], overall? })
// Behavior: mount → enter animation → auto-dismiss after 3s (slide out to the right)
// status: 'ok' | 'error' | 'skipped'
// overall: 'ok' | 'degraded' | 'error' (optional, inferred from results if omitted)

const AUTO_DISMISS_MS = 3000

const STATUS_ICON = {
  ok:      '✓',
  error:   '✗',
  skipped: '—',
}
const STATUS_COLOR = {
  ok:      '#4ade80',
  error:   '#f87171',
  skipped: '#64748b',
}

function inferOverall(results = []) {
  if (results.some(r => r.status === 'error'))   return 'error'
  if (results.some(r => r.status === 'skipped')) return 'degraded'
  return 'ok'
}

const OVERALL_STYLE = {
  ok:       { label: '系统就绪',     color: '#4ade80', icon: '⚡' },
  degraded: { label: '部分能力受限', color: '#facc15', icon: '⚠' },
  error:    { label: '检测到问题',   color: '#f87171', icon: '✗' },
}

const CSS = `
  :host {
    display: block;
    pointer-events: auto;
  }
  .card {
    width: 288px;
    padding: 16px 18px 14px;
    border-radius: 14px;
    background: rgba(22, 38, 66, 0.82);
    border: 1px solid rgba(150, 185, 255, 0.45);
    box-shadow: 0 16px 48px rgba(0,0,0,0.7), 0 0 0 1px rgba(100,150,255,0.12), inset 0 1px 0 rgba(255,255,255,0.08);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #e2eaf5;
    user-select: none;
    border-left: 3px solid rgba(150, 185, 255, 0.75);
  }
  .header {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 12px;
  }
  .header-icon {
    font-size: 16px;
    line-height: 1;
  }
  .header-text {
    font-size: 13px;
    font-weight: 600;
    color: #c8d8ee;
    letter-spacing: 0.03em;
  }
  .header-sub {
    margin-left: auto;
    font-size: 11px;
    color: #4a6080;
  }
  .results {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 12px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }
  .row-icon {
    width: 14px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .row-name {
    flex: 1;
    color: #b0c4de;
  }
  .row-note {
    font-size: 11px;
    color: #4a6080;
    max-width: 100px;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 10px;
    border-top: 1px solid rgba(150,185,255,0.08);
  }
  .overall-icon {
    font-size: 12px;
  }
  .overall-label {
    font-size: 12px;
    font-weight: 600;
    flex: 1;
  }
  .countdown {
    font-size: 11px;
    color: #3a5070;
  }
  .bar-wrap {
    margin-top: 8px;
    height: 2px;
    background: rgba(255,255,255,0.06);
    border-radius: 1px;
    overflow: hidden;
  }
  .bar {
    height: 100%;
    border-radius: 1px;
    transition: width linear;
  }
`

const _cardSheet = new CSSStyleSheet()
_cardSheet.replaceSync(CSS)

class SelfCheckCard extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.adoptedStyleSheets = [_cardSheet]
    this._props = {}
    this._timer = null
    this._countdown = null
    this._remaining = AUTO_DISMISS_MS
    this._startedAt = null
  }

  set props(v) {
    this._props = v || {}
    this._render()
  }

  connectedCallback() {
    this._render()
    this._startedAt = Date.now()
    this._countdown = setInterval(() => {
      const elapsed = Date.now() - this._startedAt
      this._remaining = Math.max(0, AUTO_DISMISS_MS - elapsed)
      const secEl = this.shadowRoot.querySelector('.countdown')
      const barEl = this.shadowRoot.querySelector('.bar')
      if (secEl) secEl.textContent = `${(this._remaining / 1000).toFixed(1)}s 后关闭`
      if (barEl) barEl.style.width = `${(this._remaining / AUTO_DISMISS_MS) * 100}%`
    }, 100)
    this._timer = setTimeout(() => this._dismiss(), AUTO_DISMISS_MS)
  }

  disconnectedCallback() {
    clearTimeout(this._timer)
    clearInterval(this._countdown)
  }

  _dismiss() {
    clearInterval(this._countdown)
    const card = this.shadowRoot.querySelector('.card')
    if (card) {
      card.style.transition = 'transform 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease'
      card.style.transform = 'translateX(110%)'
      card.style.opacity = '0'
    }
    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('acui:dismiss', { detail: { by: 'timer' }, bubbles: true, composed: true }))
    }, 420)
  }

  _render() {
    const { results = [], overall: overallProp } = this._props
    const overall = overallProp || inferOverall(results)
    const os = OVERALL_STYLE[overall] || OVERALL_STYLE.ok

    const rowsHtml = results.map(r => {
      const s = r.status || 'ok'
      const icon  = STATUS_ICON[s]  || '?'
      const color = STATUS_COLOR[s] || '#64748b'
      const note  = r.note ? `<span class="row-note">${r.note}</span>` : ''
      return `
        <div class="row">
          <span class="row-icon" style="color:${color}">${icon}</span>
          <span class="row-name">${r.name || ''}</span>
          ${note}
        </div>`
    }).join('')

    this.shadowRoot.innerHTML = `
      <div class="card">
        <div class="header">
          <span class="header-icon">${os.icon}</span>
          <span class="header-text">自检完成</span>
          <span class="header-sub">启动检查</span>
        </div>
        <div class="results">${rowsHtml}</div>
        <div class="footer">
          <span class="overall-icon">${os.icon}</span>
          <span class="overall-label" style="color:${os.color}">${os.label}</span>
          <span class="countdown">${(AUTO_DISMISS_MS / 1000).toFixed(1)}s 后关闭</span>
        </div>
        <div class="bar-wrap">
          <div class="bar" style="width:100%;background:${os.color};opacity:0.5"></div>
        </div>
      </div>`

    // Get app context after mount
    this._app = window.__acuiApps?.[this.id]
  }
}

SelfCheckCard.tagName = 'acui-self-check-card'
customElements.define(SelfCheckCard.tagName, SelfCheckCard)

export { SelfCheckCard }
