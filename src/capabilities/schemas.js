import { getInstalledToolSchema } from './marketplace/index.js'
import { getMcpToolSchema } from '../mcp/client-manager.js'
import { commsSchemas } from './schemas/comms.js'
import { filesystemSchemas } from './schemas/filesystem.js'
import { shellSchemas } from './schemas/shell.js'
import { webSchemas } from './schemas/web.js'
import { mediaSchemas } from './schemas/media.js'
import { memorySchemas } from './schemas/memory.js'
import { uiSchemas } from './schemas/ui.js'
import { taskSchemas } from './schemas/task.js'
import { reviewSchemas } from './schemas/review.js'
import { remindersSchemas } from './schemas/reminders.js'
import { agentsSchemas } from './schemas/agents.js'
import { systemSchemas } from './schemas/system.js'
import { sceneSchemas } from './schemas/scene.js'
import { apiCapabilitySchemas } from './schemas/api-capabilities.js'
import { workflowSchemas } from './schemas/workflow.js'
import { wechatSchemas } from './schemas/wechat.js'

// 所有工具的 schema 定义（按类别拆分到 ./schemas/*.js，此处合并）。
// 调用方按需用 getToolSchemas(toolNames) 取子集，合并顺序不影响输出顺序。
export const TOOL_SCHEMAS = {
  ...commsSchemas,
  ...filesystemSchemas,
  ...shellSchemas,
  ...webSchemas,
  ...mediaSchemas,
  ...memorySchemas,
  ...uiSchemas,
  ...taskSchemas,
  ...reviewSchemas,
  ...remindersSchemas,
  ...agentsSchemas,
  ...systemSchemas,
  ...sceneSchemas,
  ...apiCapabilitySchemas,
  ...workflowSchemas,
  ...wechatSchemas,
}

// 根据名称列表获取 schema 数组（含已安装工具）
export function getToolSchemas(toolNames) {
  return toolNames
    // `express` remains as a backward-compatible executor alias,
    // but we don't expose it to the model. The model should use
    // `send_message` for outbound text messages.
    .filter(name => name !== 'express')
    .map(name => TOOL_SCHEMAS[name] ?? getMcpToolSchema(name) ?? getInstalledToolSchema(name))
    .filter(Boolean)
    // 剥离识别器专用元数据，避免发给 LLM API
    .map(({ recognizer_highlights, ...rest }) => rest)
}
