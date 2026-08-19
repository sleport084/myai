// wechat.js — 微信 UI Agent 工具 schema (P2)
// 与 browser_* 同模式: snapshot(截图+AX树) → AI 决策 → click/type 执行
export const wechatSchemas = {
  wechat_snapshot: {
    type: 'function',
    function: {
      name: 'wechat_snapshot',
      description: 'Capture the WeChat desktop app window: takes a screenshot AND reads the accessibility (AX) UI tree with element names/roles/screen coordinates. Use this FIRST to understand what WeChat currently shows (chat list, conversation, contacts...). Then decide clicks by coordinates or element names. Requires WeChat running on macOS with Accessibility permission granted.',
      parameters: {
        type: 'object',
        properties: {
          depth: { type: 'number', description: 'AX tree depth 1-15, default 7. Deeper = more detail but bigger payload.' },
        },
      },
    },
  },
  wechat_click: {
    type: 'function',
    function: {
      name: 'wechat_click',
      description: 'Click in the WeChat window with human-like mouse movement (anti-detection). Pass x/y screen coordinates (from wechat_snapshot frames), or a name to auto-locate the element in the AX tree (e.g. "通讯录", "发送", "搜索").',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Screen X coordinate.' },
          y: { type: 'number', description: 'Screen Y coordinate.' },
          name: { type: 'string', description: 'Element name to auto-locate (alternative to x/y), e.g. "通讯录".' },
          double: { type: 'boolean', description: 'Double-click. Default false.' },
        },
      },
    },
  },
  wechat_type: {
    type: 'function',
    function: {
      name: 'wechat_type',
      description: 'Type text into WeChat (writes Unicode directly, bypasses IME — reliable for Chinese). Optionally click an input box first, and press Enter to send. Click the chat input box before typing if focus is elsewhere.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type (max 5000 chars).' },
          click_x: { type: 'number', description: 'Optional: click this X first to focus the input box.' },
          click_y: { type: 'number', description: 'Optional: click this Y first.' },
          enter: { type: 'boolean', description: 'Press Return after typing (= send message). Default false.' },
        },
        required: ['text'],
      },
    },
  },
  wechat_key: {
    type: 'function',
    function: {
      name: 'wechat_key',
      description: 'Press a key in WeChat: return/enter/tab/esc/space/delete/up/down/left/right.',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string', description: 'One of: return, enter, tab, esc, space, delete, up, down, left, right.' } },
        required: ['key'],
      },
    },
  },
  wechat_find: {
    type: 'function',
    function: {
      name: 'wechat_find',
      description: 'Check if the WeChat desktop window exists and get its position/size. Use before snapshot if unsure WeChat is running.',
      parameters: { type: 'object', properties: {} },
    },
  },
}
