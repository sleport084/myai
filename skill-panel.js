// skill-panel.js — 技能市场弹窗(按 S 键或语音"技能"打开)
// 从管理后台拉取公共技能列表,点击可发送到对话

import { apiUrl } from './api-client.js'

let skillPanelEl = null
let skillActive = false

export function createSkillPanel() {
  return `
  <div class="skill-panel" id="skill-panel" style="display:none">
    <div class="sk-header">
      <div class="sk-title">
        <span style="font-size:20px">🎯</span>
        <div>
          <div style="font-size:18px;font-weight:700;color:var(--accent,#00e5ff)">技能市场</div>
          <div style="font-size:11px;color:var(--dim,#5a5a80)">点击技能直接使用 · 按 S 或 ESC 关闭</div>
        </div>
      </div>
      <button class="sk-close" id="skill-close-btn" type="button" title="关闭">×</button>
    </div>
    <div class="sk-search">
      <input type="text" id="skill-search-input" placeholder="搜索技能…" autocomplete="off">
    </div>
    <div class="sk-list" id="skill-list-body">
      <div style="text-align:center;padding:40px;color:var(--dim,#5a5a80)">加载中…</div>
    </div>
  </div>`
}

// 从后端拉取技能并渲染
async function loadSkillsData() {
  const body = document.getElementById('skill-list-body')
  if (!body) return
  try {
    const resp = await fetch('https://zy.tangdou2027.top/admin/api/skills')
    const data = await resp.json()
    const skills = data.skills || []
    window._skillData = skills
    renderSkills(skills)
  } catch (e) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:#f87171">加载失败: ' + e.message + '</div>'
  }
}

function renderSkills(skills) {
  const body = document.getElementById('skill-list-body')
  if (!body) return
  if (!skills.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--dim,#5a5a80)">暂无技能<br><small>管理员可在后台添加公共技能</small></div>'
    return
  }

  // 按 category → skill_group 二级分组
  const byCat = {}
  skills.forEach(s => {
    const cat = s.category || '通用'
    if (!byCat[cat]) byCat[cat] = { groups: {}, standalone: [] }
    if (s.skill_group) {
      if (!byCat[cat].groups[s.skill_group]) byCat[cat].groups[s.skill_group] = []
      byCat[cat].groups[s.skill_group].push(s)
    } else {
      byCat[cat].standalone.push(s)
    }
  })

  const catIcons = {'编程':'💻','办公':'💼','学习':'📚','创意':'🎨','生活':'🌱','通用':'🔧'}
  const catOrder = ['编程','办公','学习','创意','生活','通用']
  let html = ''
  let catIdx = 0

  for (const cat of catOrder) {
    const catData = byCat[cat]
    if (!catData) continue
    let total = catData.standalone.length
    const groupNames = Object.keys(catData.groups)
    groupNames.forEach(g => total += catData.groups[g].length)
    if (total === 0) continue

    // 分类标题(可折叠,默认展开)
    const catId = 'skcat_' + catIdx
    html += `<div onclick="window._toggleSkCat('${catId}',this)" style="display:flex;align-items:center;gap:8px;padding:12px 16px;margin:12px 0 4px;background:linear-gradient(135deg,rgba(0,229,255,0.08),rgba(124,77,255,0.05));border:1px solid rgba(0,229,255,0.12);border-radius:14px;cursor:pointer;user-select:none">
      <span style="font-size:18px">${catIcons[cat]||'🔧'}</span>
      <b style="font-size:15px;color:var(--accent,#00e5ff);flex:1">${cat}</b>
      <span style="background:rgba(0,229,255,0.1);color:var(--accent,#00e5ff);font-size:11px;padding:2px 8px;border-radius:10px">${total}个${groupNames.length>0?' · '+groupNames.length+'组':''}</span>
      <span class="sk-cat-arrow" style="color:var(--dim,#5a5a80);transition:.2s;font-size:12px">▼</span>
    </div>`

    // 分类内容(默认展开)
    html += `<div id="${catId}" style="display:block;padding:0 4px">`

    // 技能组(默认折叠)
    let gIdx = 0
    for (const [gn, gs] of Object.entries(catData.groups)) {
      const gid = catId + '_g' + gIdx
      html += `<div onclick="window._toggleSkGroup('${gid}',this)" style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--panel,#0e0e1e);border:1px solid rgba(124,77,255,0.08);border-radius:10px;margin-bottom:5px;cursor:pointer">
        <span style="font-size:14px">📦</span>
        <b style="font-size:13px;color:var(--accent2,#7c6ff0);flex:1">${gn}</b>
        <small style="color:var(--dim)">${gs.length}</small>
        <span id="${gid}_arrow" style="color:var(--dim);transition:.2s">▶</span>
      </div>`
      html += `<div id="${gid}" style="display:none;padding-left:16px;margin-bottom:6px">`
      for (const s of gs) html += renderSkillCard(s)
      html += '</div>'
      gIdx++
    }

    // 独立技能
    for (const s of catData.standalone) html += renderSkillCard(s)

    html += '</div>'
    catIdx++
  }
  body.innerHTML = html
}

function renderSkillCard(s) {
  const icon = s.icon_url ? (s.icon_url.length < 4 ? s.icon_url : '<img src="'+s.icon_url+'" style="width:20px;height:20px;border-radius:4px;vertical-align:middle;margin-right:4px"/>') : '🎯'
  return `<div class="sk-card" onclick="window._useSkill(${s.id})" style="background:var(--panel,#0e0e1e);border:1px solid var(--line-strong,rgba(255,255,255,0.1));border-radius:12px;padding:12px;margin-bottom:5px;cursor:pointer;transition:.15s" onmouseover="this.style.borderColor='var(--accent,#00e5ff)'" onmouseout="this.style.borderColor='var(--line-strong,rgba(255,255,255,0.1))'">
    <div style="font-size:14px;font-weight:600;margin-bottom:3px">${icon}${s.title || '未命名'}</div>
    <div style="font-size:11px;color:var(--dim2,#7a7aa0);line-height:1.4">${(s.description || '').slice(0, 60)}</div>
  </div>`
}

// 折叠/展开分类
window._toggleSkCat = function(id, headerEl) {
  const body = document.getElementById(id)
  const arrow = headerEl.querySelector('.sk-cat-arrow')
  if (!body) return
  const shown = body.style.display !== 'none'
  body.style.display = shown ? 'none' : 'block'
  if (arrow) { arrow.textContent = shown ? '▶' : '▼'; arrow.style.transform = 'none' }
}

// 折叠/展开技能组
window._toggleSkGroup = function(id, headerEl) {
  const body = document.getElementById(id)
  const arrow = document.getElementById(id + '_arrow')
  if (!body) return
  const shown = body.style.display !== 'none'
  body.style.display = shown ? 'none' : 'block'
  if (arrow) arrow.textContent = shown ? '▶' : '▼'
}

window._useSkill = async function(id) {
  const skill = (window._skillData || []).find(s => s.id === id)
  if (!skill) return
  // 关闭面板
  toggleSkillPanel(false)
  // 发送到对话
  const input = document.getElementById('chat-input') || document.querySelector('textarea[data-role="input"]')
  const text = skill.content ? skill.content.slice(0, 200) : '使用技能：' + skill.title
  // 尝试多种输入框
  const inputs = document.querySelectorAll('textarea, input[type="text"]')
  for (const inp of inputs) {
    if (inp.offsetParent !== null) {  // 可见
      inp.value = text
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.focus()
      // 尝试触发发送
      setTimeout(() => {
        const sendBtn = document.querySelector('[data-role="send"], .send-btn, #send-btn')
        if (sendBtn) sendBtn.click()
        else inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      }, 200)
      break
    }
  }
}

export function toggleSkillPanel(force) {
  const panel = document.getElementById('skill-panel')
  if (!panel) return
  const show = force !== undefined ? force : (panel.style.display === 'none')
  panel.style.display = show ? 'flex' : 'none'
  document.body.classList.toggle('skill-mode', show)
  skillActive = show
  if (show) {
    loadSkillsData()
    // 绑定关闭和搜索
    setTimeout(() => {
      const closeBtn = document.getElementById('skill-close-btn')
      if (closeBtn) closeBtn.onclick = () => toggleSkillPanel(false)
      const searchInput = document.getElementById('skill-search-input')
      if (searchInput) searchInput.oninput = (e) => window._filterSkills(e.target.value)
    }, 50)
  }
}

export function isSkillActive() { return skillActive }

// 搜索过滤
window._filterSkills = function(q) {
  const data = window._skillData || []
  if (!q) return renderSkills(data)
  const lower = q.toLowerCase()
  renderSkills(data.filter(s =>
    (s.title || '').toLowerCase().includes(lower) ||
    (s.description || '').toLowerCase().includes(lower) ||
    (s.category || '').toLowerCase().includes(lower)
  ))
}
