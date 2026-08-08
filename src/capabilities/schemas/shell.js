// Shell / 进程工具 schema：exec_command / kill_process / list_processes / install_software
export const shellSchemas = {
  install_software: {
    type: 'function',
    function: {
      name: 'install_software',
      description: 'Start a non-blocking background Windows winget software install job. Use this FIRST for desktop app installation requests before raw exec_command. Returns quickly with status="started"; the background job later reports success/failure via APP_SIGNAL. macOS/Linux will return a clear "winget not available" error. Do not call repeatedly for the same app; use list_processes to inspect software_install_jobs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Software name or search query, e.g. "QQ", "微信", "Chrome".' },
          package_id: { type: 'string', description: 'Optional exact winget package id if already known, e.g. Tencent.QQ.NT.' },
          silent: { type: 'boolean', description: 'Run the installer silently (default true). Pass false only if the user wants to see the installer UI.' }
        },
        required: []
      }
    }
  },
  exec_command: {
    type: 'function',
    function: {
      name: 'exec_command',
      description: 'Run a shell command. Returns structured JSON with ok, mode, exit_code, stdout, stderr, timed_out, pid. On Windows runs in PowerShell — use PowerShell syntax (e.g. Get-ChildItem, $env:USERPROFILE, Write-Output). Use background=true for long-running servers. Use cwd to run in a sandbox subdirectory instead of cd-chaining. Use promote_to_background=true so a foreground timeout converts the process to background instead of killing it. Do NOT use this tool for operations that have a dedicated tool — those are more reliable and handle encoding/sandbox/verification for you: write a file → write_file (never WriteAllText/Out-File/Set-Content/echo >/python -c with embedded text; the quoting of multi-line content breaks repeatedly); read a file → read_file; list a directory → list_dir; delete a file/dir → delete_file (never Remove-Item/rm); create a directory → make_dir; fetch a web page → fetch_url or browser_read (never curl/Invoke-WebRequest). exec_command is for running programs (node, npm, python script.py, git, opening apps) and for file operations that have no dedicated tool (move/copy/rename, search file contents with findstr/Select-String).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Command to run, such as "node server.js", "npm install", or "python main.py".' },
          background: { type: 'boolean', description: 'Run in the background, default false. Set true when starting a server.' },
          timeout: { type: 'number', description: 'Foreground execution timeout in seconds, default 30, max 120.' },
          cwd: { type: 'string', description: 'Subdirectory within the sandbox to run the command in, e.g. "myproject". Avoids cd-chaining. Must be a relative path.' },
          promote_to_background: { type: 'boolean', description: 'When foreground execution times out, promote to background instead of killing the process. Returns the new pid.' }
        },
        required: ['command']
      }
    }
  },

  kill_process: {
    type: 'function',
    function: {
      name: 'kill_process',
      description: 'Stop a background process by PID. Returns structured JSON with ok, pid, command, stopped, or error.',
      parameters: {
        type: 'object',
        properties: {
          pid: { type: 'number', description: 'PID of the process to stop.' }
        },
        required: ['pid']
      }
    }
  },

  list_processes: {
    type: 'function',
    function: {
      name: 'list_processes',
      description: 'List background processes with their recent output. Returns ok, count, and processes (each with pid, command, status running|exited, exit_code, started_at, exited_at, recent_output). Recently exited processes are retained for ~5 min so you can still read their final output and exit code. Use tail to control how many output lines to include per process (default 20, max 200).',
      parameters: {
        type: 'object',
        properties: {
          tail: { type: 'number', description: 'Number of recent output lines to return per process, default 20.' }
        }
      }
    }
  },
}
