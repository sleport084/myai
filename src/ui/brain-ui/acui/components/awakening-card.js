// ACUI AwakeningCard — 觉醒期探索反馈卡片
// 用法：ui_show("AwakeningCard", { index, total, title, finding, emoji? })
// 行为：挂载 → 从右滑入 → 6s 自动关闭（向右滑出）
// index: 当前探索序号（1-15）
// total: 总探索数（通常为 15）
// title: 本次探索标题，如"定位城市"
// finding: 本次探索的关键发现，一句话
// emoji: 可选的前缀 emoji，如 🌍 🎵 📰

const AUTO_DISMISS_MS = 6000

const CSS = `
  :host {
    display: block;
    pointer-events: auto;
  }
  .card {
    width: 300px;
    padding: 14px 16px 12px;
    border-radius: 14px;
    background: rgba(8, 14, 22, 0.90);
    border: 1px solid rgba(150, 185, 255, 0.12);
    box-shadow: 0 12px 40px rgba(0,0,0,0.4), 0 0 0 0.5px rgba(255,255,255,0.04);
    backdrop-filter: blur(20px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #dce8f8;
    user-select: none;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }
  .emoji {
    font-size: 15px;
    line-height: 1;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    color: #c8d8ee;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    color: #3a5070;
    background: rgba(59,130,246,0.1);
    border: 1px solid rgba(59,130,246,0.18);
    border-radius: 20px;
    padding: 2px 7px;
    flex-shrink: 0;
  }
  .finding {
    font-size: 13px;
    color: #8fa8c8;
    line-height: 1.55;
    margin-bottom: 10px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .footer {
    display: flex;
    align-items: center;
    gap: 0;
  }
  .dots {
    display: flex;
    gap: 3px;
    flex: 1;
  }
  .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: rgba(150,185,255,0.15);
    transition: background 0.2s;
  }
  .dot.active {
    background: rgba(99,160,255,0.7);
  }
  .dot.done {
    background: rgba(74,222,128,0.5);
  }
  .countdown {
    font-size: 11px;
    color: #3a5070;
  }
  .bar-wrap {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: rgba(255,255,255,0.04);
  }
  .bar {
    height: 100%;
    background: rgba(99,160,255,0.45);
    transition: width linear;
  }
  .card { position: relative; }
`

class AwakeningCard extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this._props = {}
    this._timer = null
    this._countdown = null
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
      const remaining = Math.max(0, AUTO_DISMISS_MS - elapsed)
      const secEl = this.shadowRoot.querySelector('.countdown')
      const barEl = this.shadowRoot.querySelector('.bar')
      if (secEl) secEl.textContent = `${(remaining / 1000).toFixed(0)}s`
      if (barEl) barEl.style.width = `${(remaining / AUTO_DISMISS_MS) * 100}%`
    }, 200)
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
      card.style.transition = 'transform 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.35s ease'
      card.style.transform = 'translateX(110%)'
      card.style.opacity = '0'
    }
    setTimeout(() => {
      this.dispatchEvent(new CustomEvent('acui:dismiss', { detail: { by: 'timer' }, bubbles: true, composed: true }))
    }, 380)
  }

  _render() {
    const {
      index  = 1,
      total  = 15,
      title  = '探索中',
      finding = '',
      emoji  = '🔍',
    } = this._props

    const idx = Math.max(1, Math.min(Number(index), total))

    // 进度点（最多显示15个，超出则缩减为5个分段点）
    const MAX_DOTS = 15
    const dotsHtml = Array.from({ length: Math.min(total, MAX_DOTS) }, (_, i) => {
      const n = i + 1
      const cls = n < idx ? 'dot done' : n === idx ? 'dot active' : 'dot'
      return `<span class="${cls}"></span>`
    }).join('')

    this.shadowRoot.innerHTML = `
      <style>${CSS}</style>
      <div class="card">
        <div class="header">
          <span class="emoji">${emoji}</span>
          <span class="title">${title}</span>
          <span class="badge">${idx} / ${total}</span>
        </div>
        <div class="finding">${finding || '…'}</div>
        <div class="footer">
          <div class="dots">${dotsHtml}</div>
          <span class="countdown">${(AUTO_DISMISS_MS / 1000).toFixed(0)}s</span>
        </div>
        <div class="bar-wrap">
          <div class="bar" style="width:100%"></div>
        </div>
      </div>`

    this._app = window.__acuiApps?.[this.id]
  }
}

AwakeningCard.tagName = 'acui-awakening-card'
customElements.define(AwakeningCard.tagName, AwakeningCard)

export { AwakeningCard }
