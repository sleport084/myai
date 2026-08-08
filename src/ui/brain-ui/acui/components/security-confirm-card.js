// ACUI SecurityConfirmCard — security settings change confirmation card
// Usage: ui_show("SecurityConfirmCard", { reason?, file_sandbox?, exec_sandbox? })
// placement: center (fixed in ui-components.json)

const CSS = `
  :host { display: block; pointer-events: auto; }
  .card {
    padding: 20px 24px;
    min-width: 280px;
    max-width: 380px;
    border-radius: 12px;
    background: rgba(20, 20, 36, 0.96);
    border: 1px solid rgba(200, 80, 80, 0.35);
    box-shadow: 0 12px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,80,80,0.1);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    color: #e0e0e0;
    user-select: none;
  }
  .title {
    font-size: 13px;
    font-weight: 600;
    color: #f0c040;
    margin-bottom: 8px;
  }
  .reason {
    font-size: 12px;
    color: #aaa;
    margin-bottom: 10px;
    line-height: 1.6;
  }
  .changes {
    font-size: 12px;
    color: #999;
    margin-bottom: 16px;
    line-height: 1.9;
  }
  .change-off { color: #e74c3c; }
  .change-on  { color: #2ecc71; }
  .actions { display: flex; gap: 8px; }
  .btn {
    padding: 6px 16px;
    border-radius: 5px;
    font-size: 12px;
    cursor: pointer;
    border: none;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-confirm { background: #c0392b; color: #fff; }
  .btn-cancel  { background: transparent; border: 1px solid #555; color: #aaa; }
`

const _sheet = new CSSStyleSheet()
_sheet.replaceSync(CSS)

class SecurityConfirmCard extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: 'open' })
    this.shadowRoot.adoptedStyleSheets = [_sheet]
    this._props = {}
  }

  set props(v) {
    this._props = v || {}
    this._render()
  }

  connectedCallback() { this._render() }

  _emit(action, payload = {}) {
    this.dispatchEvent(new CustomEvent('acui:action', {
      bubbles: true,
      composed: true,
      detail: { action, payload },
    }))
  }

  _render() {
    const { reason = '', file_sandbox, exec_sandbox } = this._props

    const changeItems = [
      file_sandbox !== undefined
        ? `文件沙箱：<span class="${file_sandbox ? 'change-on' : 'change-off'}">${file_sandbox ? '开启' : '关闭'}</span>`
        : null,
      exec_sandbox !== undefined
        ? `执行沙箱：<span class="${exec_sandbox ? 'change-on' : 'change-off'}">${exec_sandbox ? '开启' : '关闭'}</span>`
        : null,
    ].filter(Boolean)

    this.shadowRoot.innerHTML = `
      <div class="card">
        <div class="title">⚠ 安全设置变更请求</div>
        ${reason ? `<div class="reason">${reason}</div>` : ''}
        <div class="changes">${changeItems.join('<br>') || '无变更'}</div>
        <div class="actions">
          <button class="btn btn-confirm" id="btn-confirm">确认</button>
          <button class="btn btn-cancel"  id="btn-cancel">取消</button>
        </div>
      </div>`

    const payload = {}
    if (file_sandbox !== undefined) payload.file_sandbox = file_sandbox
    if (exec_sandbox !== undefined) payload.exec_sandbox = exec_sandbox

    this.shadowRoot.getElementById('btn-confirm').onclick = () => this._emit('confirm_security_change', payload)
    this.shadowRoot.getElementById('btn-cancel').onclick  = () => this._emit('cancel_security_change', {})
  }
}

SecurityConfirmCard.tagName = 'acui-security-confirm-card'
customElements.define(SecurityConfirmCard.tagName, SecurityConfirmCard)

export { SecurityConfirmCard }
