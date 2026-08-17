// workflow.js — AI 自动管理工作流的 schema
// 让 AI 能根据用户一句话需求,自己设计并创建工作流(可先 web_search 调研再创建)
export const workflowSchemas = {
  manage_workflow: {
    type: 'function',
    function: {
      name: 'manage_workflow',
      description: `Create and manage automation workflows (persistent, scheduled task sequences). Actions:
- "create": build a new workflow from a spec. Workflow = ordered steps the system executes automatically (locally, survives restart). Step types:
  * message: send content to you (the AI) for processing — use for any writing/analysis/generation step
  * web_search: search the internet
  * generate_image: generate an image
  * api_call: HTTP request (url, method GET/POST, body)
  * notify: desktop notification (title, body)
  * delay: wait seconds
  * exec_command: whitelist shell command (echo/date/ls/cat/git status etc)
- "run": execute a workflow immediately
- "list": list workflows with their cron schedules and run history
- "update": modify name/spec/cron/enabled
- "delete": remove a workflow
Use cron_expr (5 fields: min hour day month week) for scheduling, e.g. "0 9 * * *" daily 9am, "*/30 * * * *" every 30 min. Omit cron_expr for manual-only.
When the user describes a recurring need (每日/每周/定时/自动), design a workflow instead of doing it once manually.`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['create', 'run', 'list', 'update', 'delete'], description: 'Operation to perform.' },
          name: { type: 'string', description: 'Workflow name (create/update).' },
          description: { type: 'string', description: 'What this workflow does (create/update).' },
          cron_expr: { type: 'string', description: 'Optional cron "min hour day month week" schedule. Empty string to remove schedule.' },
          steps: {
            type: 'array',
            description: 'Ordered steps (create/update). Each step: {type, ...params}.',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['message', 'web_search', 'generate_image', 'api_call', 'notify', 'delay', 'exec_command'], description: 'Step type.' },
                content: { type: 'string', description: '[message] Instruction to the AI, e.g. "根据以上搜索写早报".' },
                query: { type: 'string', description: '[web_search] Search query.' },
                prompt: { type: 'string', description: '[generate_image] Image description.' },
                aspect_ratio: { type: 'string', description: '[generate_image] 1:1/16:9/9:16/4:3/3:4.' },
                url: { type: 'string', description: '[api_call] Request URL.' },
                method: { type: 'string', enum: ['GET', 'POST'], description: '[api_call] HTTP method.' },
                body: { type: 'object', description: '[api_call] POST body.' },
                title: { type: 'string', description: '[notify] Notification title.' },
                body: { type: 'string', description: '[notify] Notification text.' },
                seconds: { type: 'number', description: '[delay] Wait seconds (max 60).' },
                command: { type: 'string', description: '[exec_command] Whitelisted command.' },
              },
              required: ['type'],
            },
          },
          enabled: { type: 'boolean', description: '[update] Enable/disable.' },
          workflow_id: { type: 'number', description: '[run/update/delete] Target workflow id.' },
        },
        required: ['action'],
      },
    },
  },
}
