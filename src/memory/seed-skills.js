// 启动时把 ACUI 的"组件创作指南"和当前已注册组件的用法 seed 成 skill.ui 记忆。
// 用稳定 mem_id（skill-ui-guide / skill-ui-<kebab>）upsert，反复启动不会重复。
// AGENT_GUIDE.md 改动后 hash 会变，content 跟着更新，记忆条目自动同步。

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { insertMemory } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AGENT_GUIDE_PATH    = path.resolve(__dirname, '..', 'ui', 'brain-ui', 'acui', 'AGENT_GUIDE.md')
const UI_COMPONENTS_PATH  = path.resolve(__dirname, '..', 'capabilities', 'ui-components.json')

function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12)
}

// 已知组件的 use_case 模板：seed 时附带；ui_register 转正的组件由它自己写 use_case。
const BUILTIN_COMPONENT_USAGE = {
  WeatherCard: {
    use_case: 'Use when the user asks about weather, temperature, going out, rain, or weather for tomorrow/the day after tomorrow.',
    example_call: 'ui_show({ component: "WeatherCard", props: { city, temp, condition, feel?, high?, low?, wind?, forecast? }, hint: { placement: "notification", size: "md" } })',
    note: 'Determine city first by asking the user or inferring from context. Do not invent temperature values; call fetch_url for wttr.in first. Default shape is notification+md; switch to floating+lg when the user asks for a detailed look or deeper study.',
  },
}

function seedAgentGuide() {
  if (!fs.existsSync(AGENT_GUIDE_PATH)) {
    console.warn('[seed-skills] 跳过：AGENT_GUIDE.md 不存在')
    return
  }
  const content = fs.readFileSync(AGENT_GUIDE_PATH, 'utf-8')
  const h = shortHash(content)

  // content：摘要（命中关键词的入口）；detail：整份指南
  const summary = [
    '[Skill UI] Component authoring guide',
    'When to use UI cards / three execution modes A>B>C / inline-template and inline-script patterns / promotion flow / pitfalls.',
    'Keywords: build a component, draw one, show it, make a card, custom, inline, missing component, ui_show, ui_register.',
  ].join('\n')

  insertMemory({
    mem_id: 'skill-ui-guide',
    type: 'skill',
    content: summary,
    detail: content,
    title: 'ACUI component authoring guide',
    tags: ['skill.ui', 'agent-guide', `hash:${h}`],
    entities: [],
    timestamp: new Date().toISOString(),
  })
}

function seedComponentSkills() {
  if (!fs.existsSync(UI_COMPONENTS_PATH)) return
  let components
  try { components = JSON.parse(fs.readFileSync(UI_COMPONENTS_PATH, 'utf-8')) }
  catch { return }

  for (const [name, def] of Object.entries(components)) {
    const usage = BUILTIN_COMPONENT_USAGE[name]
    if (!usage) continue   // 转正的组件由 ui_register 自己写记忆，不在这里覆盖

    const kebab = name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
    const fields = Object.keys(def.propsSchema || {}).join(', ')
    const content = [
      `[Skill UI] ${name}`,
      `Use case: ${usage.use_case}`,
      `Call: ${usage.example_call}`,
      fields ? `Fields: ${fields}` : null,
      usage.note ? `Note: ${usage.note}` : null,
    ].filter(Boolean).join('\n')

    insertMemory({
      mem_id: `skill-ui-${kebab}`,
      type: 'skill',
      content,
      detail: content,
      title: `UI component: ${name}`,
      tags: ['skill.ui', `component:${name}`],
      entities: [],
      timestamp: new Date().toISOString(),
    })
  }
}

export function ensureSkillMemories() {
  try {
    seedAgentGuide()
    seedComponentSkills()
    console.log('[seed-skills] skill.ui 记忆已同步')
  } catch (e) {
    console.warn('[seed-skills] 同步失败：', e.message)
  }
}
