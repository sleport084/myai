// workflow.js — manage_workflow 工具实现(直连本地工作流引擎)
import {
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, runWorkflowNow, listTaskLog
} from '../../workflow-local.js'
import { emitEvent } from '../../events.js'

export async function execManageWorkflow(args = {}) {
  const action = String(args.action || '').trim()

  try {
    if (action === 'list') {
      const wfs = listWorkflows()
      const recent = listTaskLog(5)
      const lines = wfs.map(w => {
        const steps = (w.spec.steps || [w.spec]).map(s => {
          const t = s.type
          const d = s.content || s.query || s.prompt || s.title || s.url || s.command || (s.seconds ? s.seconds + 's' : '')
          return `${t}(${String(d).slice(0, 40)})`
        }).join(' → ')
        return `- #${w.id} ${w.name}${w.cron ? ` [定时 ${w.cron.cron_expr} 下次 ${String(w.cron.next_run_at).slice(5, 16)}]` : ' [手动]'}${w.enabled ? '' : ' [已禁用]'} 已跑${w.runs_count}次: ${steps}`
      })
      const hist = recent.map(t => `  · ${t.workflow_name} ${t.status} ${t.created_at}`)
      return `共 ${wfs.length} 个工作流:\n${lines.join('\n') || '(无)'}\n\n最近执行:\n${hist.join('\n') || '(无)'}`
    }

    if (action === 'create') {
      if (!args.name) return '错误: create 需要 name'
      if (!Array.isArray(args.steps) || !args.steps.length) return '错误: create 需要 steps(至少一步)'
      // steps → spec(单步直存,多步包 sequence)
      const spec = args.steps.length === 1 ? args.steps[0] : { type: 'sequence', steps: args.steps }
      const id = createWorkflow({ name: args.name, description: args.description || '', spec, cron_expr: args.cron_expr || undefined })
      const w = listWorkflows().find(x => x.id === id)
      emitEvent('workflow_created', { id, name: args.name })
      return `工作流已创建: #${id}「${args.name}」${w?.cron ? ` 定时 ${w.cron.cron_expr}(下次 ${String(w.cron.next_run_at).slice(5, 16)})` : ' 手动触发'}。用户可在面板按 W 键查看/编辑。${args.cron_expr ? '' : '(未设 cron,仅手动;如需定时告诉我)'}`
    }

    if (action === 'run') {
      if (!args.workflow_id) return '错误: run 需要 workflow_id'
      // 异步执行不阻塞回合,立即回执
      runWorkflowNow(args.workflow_id, 'ai')
        .then(r => emitEvent('workflow_finished', { id: args.workflow_id, status: 'done', via: 'ai', duration_ms: r.duration_ms }))
        .catch(e => emitEvent('workflow_finished', { id: args.workflow_id, status: 'failed', error: e.message }))
      return `工作流 #${args.workflow_id} 已启动(后台执行),完成后会通知。结果可在 W 面板或任务日志查看。`
    }

    if (action === 'update') {
      if (!args.workflow_id) return '错误: update 需要 workflow_id'
      const patch = {}
      if (args.name !== undefined) patch.name = args.name
      if (args.description !== undefined) patch.description = args.description
      if (args.enabled !== undefined) patch.enabled = args.enabled
      if (args.cron_expr !== undefined) patch.cron_expr = args.cron_expr   // 空串=删定时
      if (Array.isArray(args.steps) && args.steps.length) {
        patch.spec = args.steps.length === 1 ? args.steps[0] : { type: 'sequence', steps: args.steps }
      }
      updateWorkflow(args.workflow_id, patch)
      return `工作流 #${args.workflow_id} 已更新。`
    }

    if (action === 'delete') {
      if (!args.workflow_id) return '错误: delete 需要 workflow_id'
      deleteWorkflow(args.workflow_id)
      return `工作流 #${args.workflow_id} 已删除(含其定时配置)。`
    }

    return `错误: 未知 action "${action}"(支持 create/run/list/update/delete)`
  } catch (e) {
    return `错误: ${e.message}`
  }
}
