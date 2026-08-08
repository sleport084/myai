// UI / ACUI 类工具 schema：hotspot_mode / worldcup_mode / open_doc_panel /
// person_card_mode / ui_show / ui_hide / ui_update / manage_app / ui_patch /
// ui_register / focus_banner
export const uiSchemas = {
  capability_demo: {
    type: 'function',
    function: {
      name: 'capability_demo',
      description: 'Start MyAI\'s visual and spoken capability showcase. When the user is asking what you/MyAI can do, or explicitly requests a capability/function demo/showcase, call this tool; it sends and speaks the intro itself while the visual sequence starts, so do not send a second introduction. Do not call for ordinary feasibility questions. The demo runs as a paced sequence: weather card, streamed Chinese article writing, hotspot panel, then cleanup.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Short reason why this message is a capability-showcase request.' },
        },
        required: []
      }
    }
  },
  worldcup_mode: {
    type: 'function',
    function: {
      name: 'worldcup_mode',
      description: 'Control the World Cup panel (live scores, schedule and group standings for the FIFA World Cup, data from zhibo8.cc in Beijing time). Open it when the user asks about World Cup matches, scores or schedule and a visual panel helps; close it when asked. status checks current state. While the panel is open, current match data is injected into your context automatically.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['show', 'open', 'hide', 'close', 'toggle', 'status'], description: 'show/open opens the worldcup panel; hide/close closes it; toggle switches it; status only checks state.' },
          reason: { type: 'string', description: 'Optional short reason for opening or closing.' },
        },
        required: ['action']
      }
    }
  },

  hotspot_mode: {
    type: 'function',
    function: {
      name: 'hotspot_mode',
      description: 'Control the hotspot panel. Use only when the user explicitly asks, when a demo/roleplay needs it, or when the current task truly needs a visual hotspot scene. Do not proactively open it for ordinary Q&A. status checks current state.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['show', 'open', 'hide', 'close', 'toggle', 'status'], description: 'show/open opens the hotspot panel; hide/close closes it; toggle switches it; status only checks state.' },
          reason: { type: 'string', description: 'Optional short reason for opening or closing.' },
        },
        required: ['action']
      }
    }
  },

  open_doc_panel: {
    type: 'function',
    function: {
      name: 'open_doc_panel',
      description: 'Control the configuration documentation panel. Open it when the user needs voice, model, WeChat, or social-platform configuration help, or explicitly asks to open documentation. Close it when it is open but the conversation is unrelated to any configuration topic. Panel contents are injected as context for 30 minutes.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['open', 'close'],
            description: 'open opens the panel; close closes the panel.'
          },
          topic: {
            type: 'string',
            enum: ['voice_asr', 'voice_tts', 'voice_config', 'model_config', 'wechat_config', 'self_architecture', 'ui_design'],
            description: 'Required when action=open. Choose one topic: voice_asr, voice_tts, voice_config, model_config, wechat_config, self_architecture (how XiaoBaiLong works internally), or ui_design (XiaoBaiLong\'s interface/ACUI design). Do not invent other values. Optional when action=close.'
          },
          reason: { type: 'string', description: 'Optional short reason.' },
        },
        required: ['action']
      }
    }
  },

  person_card_mode: {
    type: 'function',
    function: {
      name: 'person_card_mode',
      description: 'Control the person-card panel. Use only when the user says they do not know someone, asks who someone is or why they are popular, or when the current conversation truly needs a public-figure explanation. Do not proactively open it for ordinary Q&A. Basic profile data can update the card.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['show', 'open', 'hide', 'close', 'update', 'toggle', 'status'], description: 'show/open/update opens or updates the person card; hide/close closes it; toggle switches it; status only checks state.' },
          name: { type: 'string', description: 'Person name, e.g. Jay Chou.' },
          title: { type: 'string', description: 'Identity or title, e.g. singer / musician.' },
          summary: { type: 'string', description: 'One or two sentence summary. Avoid inventing uncertain information.' },
          knownFor: { type: 'array', items: { type: 'string' }, description: 'Representative works, events, or recognition points the user most needs.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Short tags, e.g. actor or Mandopop.' },
          aliases: { type: 'array', items: { type: 'string' }, description: 'Aliases, English names, or common nicknames.' },
          image: { type: 'string', description: 'Optional large image URL, preferred for the card hero image.' },
          avatar: { type: 'string', description: 'Optional avatar or person image URL.' },
          reason: { type: 'string', description: 'Optional short reason for opening or closing.' },
        },
        required: ['action']
      }
    }
  },

  ui_show: {
    type: 'function',
    function: {
      name: 'ui_show',
      description: 'Push a registered visual card to the user interface. Always specify component + props matching the registered component\'s propsSchema. Use only when UI expression is clearer than plain text.',
      parameters: {
        type: 'object',
        properties: {
          component: { type: 'string', description: 'Registered component type name, e.g. WeatherCard. Required.' },
          props:     { type: 'object', description: 'Component props following the component\'s propsSchema.' },
          hint: {
            type: 'object',
            description: 'Optional display hint. All fields have reasonable defaults.',
            properties: {
              placement: { type: 'string', enum: ['notification', 'center', 'floating', 'stage'], description: 'notification=top-right stacked slide-in (default); center=centered with overlay; floating=free draggable; stage=fullscreen.' },
              size:      { description: 'Size: sm | md | lg | xl, or pixel object { w, h }.', oneOf: [{ type: 'string', enum: ['sm', 'md', 'lg', 'xl'] }, { type: 'object', properties: { w: { type: ['number', 'string'] }, h: { type: ['number', 'string'] } } }] },
              draggable: { type: 'boolean', description: 'Whether draggable. floating defaults true.' },
              modal:     { type: 'boolean', description: 'Show translucent overlay. center defaults true.' },
              enter:     { type: 'string', description: 'Enter animation, inferred from placement by default.' },
              exit:      { type: 'string', description: 'Exit animation, inferred from placement by default.' }
            }
          }
        },
        required: ['component']
      }
    }
  },

  ui_hide: {
    type: 'function',
    function: {
      name: 'ui_hide',
      description: 'Close a displayed card with its exit animation. Usually let the user close cards; proactively call only when the card information is stale.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Card instance id returned by ui_show.' }
        },
        required: ['id']
      }
    }
  },

  ui_update: {
    type: 'function',
    function: {
      name: 'ui_update',
      description: 'Update a displayed card without replaying the enter animation. Common use: change props when the user asks about another city weather instead of opening a new card.',
      parameters: {
        type: 'object',
        properties: {
          id:    { type: 'string', description: 'Card instance id returned by ui_show.' },
          props: { type: 'object', description: 'New props, shallow-merged with existing props.' }
        },
        required: ['id', 'props']
      }
    }
  },

  manage_app: {
    type: 'function',
    function: {
      name: 'manage_app',
      description: 'Manage generated interactive apps such as games/tools: save as permanent app, reopen, list, or delete. inline-script component code is saved as a draft when generated; use save to promote it to a formal app that can be reopened later.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['save', 'open', 'list', 'delete'],
            description: 'save promotes an inline-script draft to a permanent app; open remounts a saved app with automatic state restore; list lists saved apps; delete removes an app.'
          },
          name: {
            type: 'string',
            description: 'App name in lowercase snake_case, used as the storage directory, e.g. chess or todo_app. Required for save/open/delete.'
          },
          label: {
            type: 'string',
            description: 'Optional display label, e.g. Chinese chess. Provide when saving.'
          },
          draft_id: {
            type: 'string',
            description: 'Required for save: component instance id returned by ui_show(mode="inline-script"), e.g. scratch-xxx.'
          },
          state: {
            type: 'object',
            description: 'Optional state included when saving or opening. For save, pass current game/app state; for open, this overrides persisted state.'
          },
          hint: {
            type: 'object',
            description: 'Optional UI display hint, such as placement / size / draggable. Written to metadata during save and reused during open.'
          }
        },
        required: ['action']
      }
    }
  },

  ui_patch: {
    type: 'function',
    function: {
      name: 'ui_patch',
      description: 'Send operation commands or state updates to a mounted app component. The component listens with this._app.onPatch(). Use for game turns, state machines, canvas updates, and other cases where the agent proactively pushes changes.',
      parameters: {
        type: 'object',
        properties: {
          id:   { type: 'string', description: 'Component instance id returned by ui_show.' },
          op:   { type: 'string', description: 'Operation name defined by the component, such as applyMove, setState, or nextRound.' },
          data: { type: 'object', description: 'Operation data interpreted by the component.' },
        },
        required: ['id', 'op']
      }
    }
  },

  ui_register: {
    type: 'function',
    function: {
      name: 'ui_register',
      description: 'Promote a verified inline component to a permanent component: write a .js file, update registry, write ui-components.json, and seed one skill.ui memory. Usually call after the inline component succeeds at least twice, the user does not immediately close it, and dwell signals are good. After registration, future similar needs can use ui_show directly.',
      parameters: {
        type: 'object',
        properties: {
          component_name: { type: 'string', description: 'Unused PascalCase component name, e.g. TodoCard or VideoPlayer.' },
          code:           { type: 'string', description: 'Complete Web Component class code. Must include static tagName / static propsSchema / static enter / static exit and end with customElements.define.' },
          props_schema:   { type: 'object', description: 'Object matching propsSchema in code, used as backend validation mirror, e.g. { field: { type, required } }.' },
          use_case:       { type: 'string', description: 'When to use this component. Written into skill.ui memory as matching conditions.' },
          example_call:   { type: 'string', description: 'Example ui_show call.' }
        },
        required: ['component_name', 'code', 'props_schema', 'use_case', 'example_call']
      }
    }
  },

  focus_banner: {
    type: 'function',
    function: {
      name: 'focus_banner',
      description: 'Show a translucent desktop focus banner sticker reminding the user what to focus on. Call when the user says they want to focus on something, enter focus mode, or asks for help focusing on X. The banner can expand to show a task list with checkboxes.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['show', 'update', 'hide'],
            description: 'show displays the banner; update changes content when it already exists; hide closes it.'
          },
          task: {
            type: 'string',
            description: 'Main task title, one short sentence.'
          },
          current_step: {
            type: 'string',
            description: 'Optional current step, shown under the main task when collapsed.'
          },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: 'Subtask text.' },
                done: { type: 'boolean', description: 'Whether completed, default false.' }
              },
              required: ['text']
            },
            description: 'Optional subtask list shown when the banner is expanded.'
          }
        },
        required: ['action']
      }
    }
  },
}
