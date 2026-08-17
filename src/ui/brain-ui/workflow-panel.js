// workflow-panel.js — 桌面端工作流面板(按 W 键打开)
// 客户可视化创建/定制工作流: 选动作类型、填参数、排步骤、设定时
export function createWorkflowPanel() {
  return `
  <div class="workflow-panel" id="workflow-panel" style="display:none">
    <div class="wf-header">
      <div class="wf-title">
        <span style="font-size:20px">⚡</span>
        <div>
          <div style="font-size:18px;font-weight:700;color:#00e5ff">我的工作流</div>
          <div style="font-size:11px;color:#5a5a80">本地运行 · 按 W 或 ESC 关闭</div>
        </div>
      </div>
      <button class="wf-close" id="workflow-close-btn" type="button" title="关闭">×</button>
    </div>
    <div style="width:100%;max-width:760px;padding:0 20px;display:flex;gap:10px;align-items:center">
      <button id="wf-new-btn" style="padding:8px 16px;background:linear-gradient(135deg,#00e5ff,#7c4ff0);border:none;border-radius:10px;color:#050510;font-weight:700;cursor:pointer;font-size:13px">+ 新建工作流</button>
      <span style="color:#5a5a80;font-size:12px" id="wf-hint">动作: AI对话/搜图/通知/API/延时/命令</span>
    </div>
    <div class="wf-list" id="wf-list-body">
      <div style="text-align:center;padding:40px;color:#5a5a80">加载中…</div>
    </div>
  </div>`
}

const ACTION_TYPES = {
  message:      { label: '💬 AI 对话',     fields: [{ key: 'content', label: '发给 AI 的指令', type: 'textarea', ph: '如:写一份今日AI行业早报,3条要点' }] },
  web_search:   { label: '🔍 联网搜索',    fields: [{ key: 'query', label: '搜索关键词', type: 'text', ph: '如:今日AI新闻' }] },
  generate_image:{ label: '🎨 生成图片',    fields: [{ key: 'prompt', label: '图片描述', type: 'text', ph: '如:赛博朋克城市夜景' }, { key: 'aspect_ratio', label: '比例(可选 1:1/16:9/9:16)', type: 'text', ph: '16:9' }] },
  notify:       { label: '🔔 桌面通知',    fields: [{ key: 'title', label: '标题', type: 'text', ph: '任务完成' }, { key: 'body', label: '内容', type: 'text', ph: '早报已生成' }] },
  api_call:     { label: '🌐 HTTP 请求',   fields: [{ key: 'url', label: 'URL', type: 'text', ph: 'https://...' }, { key: 'method', label: '方法', type: 'select', options: ['GET','POST'] }] },
  delay:        { label: '⏱ 等待',        fields: [{ key: 'seconds', label: '秒数(最大60)', type: 'number', ph: '5' }] },
  exec_command: { label: '💻 命令(白名单)', fields: [{ key: 'command', label: '命令(echo/date/ls/cat/git status 等)', type: 'text', ph: 'date' }] },
}

async function loadWorkflows() {
  const body = document.getElementById('wf-list-body')
  if (!body) return
  try {
    const resp = await fetch('/workflow/list')
    const data = await resp.json()
    window._wfData = data.workflows || []
    renderWorkflows(window._wfData)
  } catch (e) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171">加载失败: ' + e.message + '</div>'
  }
}

function renderWorkflows(list) {
  const body = document.getElementById('wf-list-body')
  if (!list.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#5a5a80">还没有工作流<br><small>点上方「+ 新建工作流」创建你的第一个自动化</small></div>'
    return
  }
  body.innerHTML = list.map(w => {
    const steps = (w.spec.steps || [w.spec]).length
    const cron = w.cron ? `<span style="background:rgba(0,255,170,0.1);color:#00ffaa;font-size:10px;padding:2px 8px;border-radius:10px">⏰ ${w.cron.cron_expr}</span>` : ''
    return '<div style="background:rgba(20,28,40,0.6);border:1px solid rgba(164,183,214,0.2);border-radius:12px;padding:14px 16px;margin-bottom:8px;display:flex;align-items:center;gap:10px">' +
      '<div style="flex:1"><div style="font-size:14px;font-weight:600;color:#c8f0c8">' + esc(w.name) + ' ' + cron + '</div>' +
      '<div style="font-size:11px;color:#778397;margin-top:2px">' + steps + ' 个动作 · 已运行 ' + (w.runs_count || 0) + ' 次' + (w.last_run_at ? ' · 上次 ' + w.last_run_at.slice(5, 16) : '') + '</div></div>' +
      '<button onclick="window._wfRun(' + w.id + ')" style="padding:6px 14px;background:#00e5ff;border:none;border-radius:8px;color:#050510;font-weight:700;cursor:pointer;font-size:12px">▶ 运行</button>' +
      '<button onclick="window._wfEdit(' + w.id + ')" style="padding:6px 10px;background:rgba(164,183,214,0.15);border:1px solid rgba(164,183,214,0.3);border-radius:8px;color:#c8f0c8;cursor:pointer;font-size:12px">编辑</button>' +
      '<button onclick="window._wfDel(' + w.id + ')" style="padding:6px 10px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.3);border-radius:8px;color:#f87171;cursor:pointer;font-size:12px">删</button>' +
      '</div>'
  }).join('')
}

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// ── 新建/编辑表单(可视化步骤编辑器) ──
window._wfShowForm = function (existing) {
  const isEdit = !!existing
  const steps = isEdit ? (existing.spec.steps || (existing.spec.type === 'sequence' ? [] : [existing.spec])) : []
  const overlay = document.createElement('div')
  overlay.id = 'wf-form-overlay'
  overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center'
  overlay.innerHTML = `
    <div style="background:#0a0f18;border:1px solid rgba(0,229,255,0.2);border-radius:16px;padding:24px;width:92%;max-width:640px;max-height:88vh;overflow-y:auto">
      <div style="font-size:16px;font-weight:700;color:#00e5ff;margin-bottom:16px">${isEdit ? '编辑工作流' : '新建工作流'}</div>
      <div style="margin-bottom:12px"><label style="display:block;font-size:12px;color:#778397;margin-bottom:4px">名称</label>
        <input id="wf-f-name" value="${isEdit ? esc(existing.name) : ''}" placeholder="如:每日AI早报" style="width:100%;padding:9px 12px;background:#141c28;border:1px solid rgba(164,183,214,0.25);border-radius:8px;color:#e0e0e8;font-size:13px;outline:none"></div>
      <div style="margin-bottom:12px"><label style="display:block;font-size:12px;color:#778397;margin-bottom:4px">定时(可选, cron: 分 时 日 月 周, 留空=仅手动)</label>
        <input id="wf-f-cron" value="${isEdit && existing.cron ? existing.cron.cron_expr : ''}" placeholder="如 0 9 * * * 每天9点 / */30 * * * * 每30分" style="width:100%;padding:9px 12px;background:#141c28;border:1px solid rgba(164,183,214,0.25);border-radius:8px;color:#e0e0e8;font-size:13px;outline:none;font-family:monospace"></div>
      <div style="font-size:12px;color:#778397;margin:14px 0 8px">动作步骤(从上到下执行)</div>
      <div id="wf-f-steps"></div>
      <button id="wf-f-add" style="width:100%;padding:9px;background:rgba(0,229,255,0.08);border:1px dashed rgba(0,229,255,0.3);border-radius:8px;color:#00e5ff;cursor:pointer;font-size:12px;margin-top:6px">+ 添加步骤</button>
      <div style="display:flex;gap:10px;margin-top:18px">
        <button id="wf-f-save" style="flex:1;padding:11px;background:linear-gradient(135deg,#00e5ff,#7c6ff0);border:none;border-radius:10px;color:#050510;font-weight:700;cursor:pointer">保存</button>
        <button id="wf-f-cancel" style="padding:11px 20px;background:rgba(164,183,214,0.1);border:1px solid rgba(164,183,214,0.25);border-radius:10px;color:#c8f0c8;cursor:pointer">取消</button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  overlay.querySelector('#wf-f-cancel').onclick = () => overlay.remove()

  const stepsBox = overlay.querySelector('#wf-f-steps')
  let stepList = steps.map(s => JSON.parse(JSON.stringify(s)))

  function renderSteps() {
    stepsBox.innerHTML = stepList.map((s, i) => {
      const cfg = ACTION_TYPES[s.type] || { label: s.type, fields: [] }
      const fieldsHtml = cfg.fields.map(f => {
        const val = s[f.key] !== undefined ? s[f.key] : ''
        if (f.type === 'textarea') return `<textarea data-step="${i}" data-key="${f.key}" placeholder="${f.ph}" rows="2" style="width:100%;padding:8px 10px;background:#141c28;border:1px solid rgba(164,183,214,0.2);border-radius:6px;color:#e0e0e8;font-size:12px;outline:none;resize:vertical">${esc(String(val))}</textarea>`
        if (f.type === 'select') return `<select data-step="${i}" data-key="${f.key}" style="width:100%;padding:8px 10px;background:#141c28;border:1px solid rgba(164,183,214,0.2);border-radius:6px;color:#e0e0e8;font-size:12px">${f.options.map(o => `<option ${val === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        return `<input data-step="${i}" data-key="${f.key}" value="${esc(String(val))}" placeholder="${f.ph}" type="${f.type === 'number' ? 'number' : 'text'}" style="width:100%;padding:8px 10px;background:#141c28;border:1px solid rgba(164,183,214,0.2);border-radius:6px;color:#e0e0e8;font-size:12px;outline:none">`
      }).join('')
      return `<div style="background:#101825;border:1px solid rgba(164,183,214,0.15);border-radius:10px;padding:12px;margin-bottom:8px" data-step-box="${i}">
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
          <span style="background:rgba(0,229,255,0.15);color:#00e5ff;font-size:11px;padding:2px 8px;border-radius:6px">${i + 1}</span>
          <select data-step="${i}" data-key="__type" style="flex:1;padding:6px 10px;background:#141c28;border:1px solid rgba(164,183,214,0.25);border-radius:6px;color:#e0e0e8;font-size:12px">
            ${Object.entries(ACTION_TYPES).map(([k, v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${v.label}</option>`).join('')}
          </select>
          <button data-del="${i}" style="width:26px;height:26px;background:rgba(248,113,113,0.12);border:none;border-radius:6px;color:#f87171;cursor:pointer;font-size:14px">×</button>
        </div>${fieldsHtml}</div>`
    }).join('')
    // 事件绑定
    stepsBox.querySelectorAll('[data-key="__type"]').forEach(sel => {
      sel.onchange = () => { const i = +sel.dataset.step; stepList[i] = { type: sel.value }; renderSteps() }
    })
    stepsBox.querySelectorAll('[data-key]:not([data-key="__type"])').forEach(inp => {
      inp.oninput = () => { const i = +inp.dataset.step; stepList[i][inp.dataset.key] = inp.value }
    })
    stepsBox.querySelectorAll('[data-del]').forEach(btn => {
      btn.onclick = () => { stepList.splice(+btn.dataset.del, 1); renderSteps() }
    })
  }
  renderSteps()
  overlay.querySelector('#wf-f-add').onclick = () => { stepList.push({ type: 'message', content: '' }); renderSteps() }

  overlay.querySelector('#wf-f-save').onclick = async () => {
    const name = overlay.querySelector('#wf-f-name').value.trim()
    if (!name) { alert('请填名称'); return }
    if (!stepList.length) { alert('至少添加一个步骤'); return }
    const spec = stepList.length === 1 ? stepList[0] : { type: 'sequence', steps: stepList }
    const body = { name, spec, cron_expr: overlay.querySelector('#wf-f-cron').value.trim() || undefined }
    try {
      const r = await fetch(isEdit ? '/workflow/update/' + existing.id : '/workflow/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      })
      const d = await r.json()
      if (!d.ok) { alert('保存失败: ' + d.error); return }
      overlay.remove()
      loadWorkflows()
    } catch (e) { alert('保存失败: ' + e.message) }
  }
}

window._wfRun = async function (id) {
  if (!confirm('立即运行这个工作流?')) return
  try {
    const r = await fetch('/workflow/run/' + id, { method: 'POST' })
    const d = await r.json()
    alert(d.ok ? '已启动,结果见对话/任务记录' : '失败: ' + d.error)
  } catch (e) { alert('失败: ' + e.message) }
}
window._wfEdit = function (id) { const w = (window._wfData || []).find(x => x.id === id); if (w) window._wfShowForm(w) }
window._wfDel = async function (id) {
  if (!confirm('删除这个工作流?')) return
  await fetch('/workflow/delete/' + id, { method: 'POST' })
  loadWorkflows()
}

export function toggleWorkflowPanel(force) {
  const panel = document.getElementById('workflow-panel')
  if (!panel) return
  const show = force !== undefined ? force : panel.style.display === 'none'
  panel.style.display = show ? 'flex' : 'none'
  document.body.classList.toggle('workflow-mode', show)
  if (show) {
    loadWorkflows()
    setTimeout(() => {
      const btn = document.getElementById('workflow-close-btn')
      if (btn) btn.onclick = () => toggleWorkflowPanel(false)
      const nb = document.getElementById('wf-new-btn')
      if (nb) nb.onclick = () => window._wfShowForm(null)
    }, 50)
  }
}
export function isWorkflowPanelActive() { return document.getElementById('workflow-panel')?.style.display !== 'none' }
