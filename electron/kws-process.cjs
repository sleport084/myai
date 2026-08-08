// kws-process.cjs —— 语音唤醒(KWS)子进程,跑在 Electron utilityProcess 里
//
// 为什么要独立进程:sherpa-onnx 自带一份 onnxruntime,而后端 @huggingface/transformers
// 走 onnxruntime-node 另带一份;同一进程加载两份 onnxruntime 会在构建会话时原生崩溃
// (已用 probe 坐实)。把 KWS 隔离到只加载 sherpa 的独立进程,从根上消除冲突。
//
// 协议(parentPort):
//   收 {type:'init', modelDir, logFile}  → 构建 KeywordSpotter,回 {type:'ready'} / {type:'error'}
//   收 {type:'pcm',  buf:ArrayBuffer}    → 喂 16kHz Float32,命中则写日志 + 回 {type:'hit', keyword}
const fs = require('fs')
const path = require('path')

// 从 2.1.617 实测调参继承的阈值(原 stub 头部注释记录的值)
const KEYWORDS_THRESHOLD = 0.35 // 从 0.25 上调到 0.35，减少误触发
const KEYWORDS_SCORE = 3.0      // 实测 score=3 召回最佳(13/17 vs 2.0 的 9/17)
const COOLDOWN_MS = 800         // 命中后冷却:去重一次唤醒的多帧结果,又允许~1s 间隔的重试都触发
const SAMPLE_RATE = 16000

let spotter = null
let stream = null
let sherpa = null
let logFile = null
let lastHitAt = 0

// utilityProcess 的 parentPort(Electron 环境下存在;裸 node 跑测试时用 process.send 兜底)
let parentPort = null
try {
  parentPort = require('electron').parentPort
} catch {
  parentPort = null
}

function postUp(msg) {
  try {
    if (parentPort) parentPort.postMessage(msg)
    else if (typeof process.send === 'function') process.send(msg)
  } catch {}
}

function appendLog(line) {
  if (!logFile) return
  try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`) } catch {}
}

// 模型文件名约定(与 src/voice/kws-model/ 下一致)
function buildConfig(modelDir) {
  const encoder = path.join(modelDir, 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx')
  const decoder = path.join(modelDir, 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx')
  const joiner = path.join(modelDir, 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx')
  const tokens = path.join(modelDir, 'tokens.txt')
  const keywordsFile = path.join(modelDir, 'keywords.txt')

  for (const f of [encoder, decoder, joiner, tokens, keywordsFile]) {
    if (!fs.existsSync(f)) throw new Error(`模型文件缺失: ${f}`)
  }

  return {
    featConfig: { sampleRate: SAMPLE_RATE },
    modelConfig: {
      transducer: { encoder, decoder, joiner },
      tokens,
      numThreads: 1,
      provider: 'cpu',
      debug: 0,
    },
    maxActivePaths: 4,
    numTrailingBlanks: 3,
    keywordsFile,
    keywordsThreshold: KEYWORDS_THRESHOLD,
    keywordsScore: KEYWORDS_SCORE,
  }
}

function handleMessage(msg) {
  if (!msg || typeof msg !== 'object') return

  if (msg.type === 'init') {
    try {
      logFile = msg.logFile || null
      sherpa = require('sherpa-onnx-node')
      const config = buildConfig(msg.modelDir)
      spotter = new sherpa.KeywordSpotter(config)
      stream = spotter.createStream()
      appendLog(`[init] KWS 就绪 threshold=${KEYWORDS_THRESHOLD} score=${KEYWORDS_SCORE}`)
      postUp({ type: 'ready' })
    } catch (err) {
      appendLog(`[init] 失败: ${err?.stack || err?.message || err}`)
      postUp({ type: 'error', error: err?.message || String(err) })
      // 初始化失败后清空,后续 pcm 直接忽略
      spotter = null
      stream = null
    }
    return
  }

  if (msg.type === 'pcm') {
    if (!spotter || !stream) return
    try {
      // buf 是 16kHz Float32 PCM 的 ArrayBuffer(wake-word.cjs feedPcm 转出来的)
      const samples = new Float32Array(msg.buf)
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE })

      while (spotter.isReady(stream)) {
        spotter.decode(stream)
        const result = spotter.getResult(stream)
        const kw = result && typeof result.keyword === 'string' ? result.keyword.trim() : ''
        if (!kw) continue

        const now = Date.now()
        if (now - lastHitAt < COOLDOWN_MS) continue
        lastHitAt = now

        appendLog(`[hit] ${kw}`)
        postUp({ type: 'hit', keyword: kw })
      }
    } catch (err) {
      // 单块 PCM 处理失败不致命,记日志继续(避免一块坏数据拖垮整个唤醒)
      appendLog(`[pcm] 处理异常: ${err?.message || err}`)
    }
    return
  }
}

// 挂监听器:utilityProcess 用 parentPort,普通 child_process 用 process.on('message')
if (parentPort) {
  parentPort.on('message', (e) => handleMessage(e && e.data ? e.data : e))
} else if (typeof process.on === 'function') {
  process.on('message', handleMessage)
}
