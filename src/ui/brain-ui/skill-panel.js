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
  console.log('[skill-panel] renderSkills v3, skills count:', skills.length)
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
    html += '<div onclick="window._toggleSkCat(\'' + catId + '\',this)" style="display:flex;align-items:center;gap:8px;padding:12px 16px;margin:12px 0 4px;background:linear-gradient(135deg,rgba(0,229,255,0.08),rgba(124,77,255,0.05));border:1px solid rgba(0,229,255,0.12);border-radius:14px;cursor:pointer;user-select:none">'
      + '<span style="font-size:18px">' + (catIcons[cat]||'🔧') + '</span>'
      + '<b style="font-size:15px;color:#00e5ff;flex:1">' + cat + '</b>'
      + '<span style="background:rgba(0,229,255,0.1);color:#00e5ff;font-size:11px;padding:2px 8px;border-radius:10px">' + total + '个' + (groupNames.length>0?' · '+groupNames.length+'组':'') + '</span>'
      + '<span class="sk-cat-arrow" style="color:#778397;transition:.2s;font-size:12px">▼</span>'
      + '</div>'

    // 分类内容(默认展开)
    html += '<div id="' + catId + '" style="display:block;padding:0 4px">'

    // 技能组(默认折叠)
    let gIdx = 0
    for (const [gn, gs] of Object.entries(catData.groups)) {
      const gid = catId + '_g' + gIdx
      html += '<div onclick="window._toggleSkGroup(\'' + gid + '\',this)" style="display:flex;align-items:center;gap:8px;padding:9px 12px;background:rgba(20,28,40,0.6);border:1px solid rgba(124,77,255,0.12);border-radius:10px;margin-bottom:5px;cursor:pointer">'
        + '<span style="font-size:14px">📦</span>'
        + '<b style="font-size:13px;color:#7c6ff0;flex:1">' + gn.replace(/</g,'&lt;') + '</b>'
        + '<small style="color:#778397">' + gs.length + '</small>'
        + '<span id="' + gid + '_arrow" style="color:#778397;transition:.2s">▶</span>'
        + '</div>'
      html += '<div id="' + gid + '" style="display:none;padding-left:16px;margin-bottom:6px">'
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
  console.log('[skill-panel] rendered HTML length:', html.length, '分类数:', (html.match(/skcat_/g) || []).length)
}

function renderSkillCard(s) {
  // icon: 只用 emoji 或文字,不用 img(避免 emoji 被 URL 编码后 404)
  let icon = '🎯'
  if (s.icon_url) {
    // 如果是 http 开头的 URL 才用 img,否则当 emoji 直接显示
    if (/^https?:\/\//.test(s.icon_url)) {
      icon = '<img src="' + s.icon_url + '" style="width:20px;height:20px;border-radius:4px;vertical-align:middle;margin-right:4px"/>'
    } else {
      icon = s.icon_url
    }
  }
  const safeTitle = (s.title || '未命名').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const safeDesc = (s.description || '').slice(0, 60).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return '<div class="sk-card" onclick="window._useSkill(' + s.id + ')" style="background:var(--panel,rgba(20,28,40,0.78));border:1px solid var(--line-strong,rgba(164,183,214,0.32));border-radius:12px;padding:12px;margin-bottom:5px;cursor:pointer" onmouseover="this.style.borderColor=\'#00e5ff\'" onmouseout="this.style.borderColor=\'var(--line-strong,rgba(164,183,214,0.32))\'">' +
    '<div style="font-size:14px;font-weight:600;margin-bottom:3px">' + icon + ' ' + safeTitle + '</div>' +
    '<div style="font-size:11px;color:var(--dim,#778397);line-height:1.4">' + safeDesc + '</div>' +
    '</div>'
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
  toggleSkillPanel(false)

  // 技能列表不含 content,需要下载完整内容
  let text = ''
  if (skill.content) {
    text = skill.content
  } else {
    // 从后端下载技能内容
    try {
      const resp = await fetch('https://zy.tangdou2027.top/admin/api/skills/' + id)
      if (resp.ok) {
        const data = await resp.json()
        text = (data.skill && data.skill.content) || ''
      }
    } catch (e) { /* 忽略网络错误 */ }
  }
  if (!text) text = '使用技能：' + skill.title

  // 填入对话输入框并发送
  const inputs = document.querySelectorAll('textarea, input[type="text"]')
  for (const inp of inputs) {
    if (inp.offsetParent !== null) {
      inp.value = text
      inp.dispatchEvent(new Event('input', { bubbles: true }))
      inp.focus()
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
