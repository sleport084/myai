import { attachJarvisAudioGraph } from "./tts-fx.js";
import { applyOutputSink } from "./audio-output.js";

let API = '';
let updateLastJarvisMsgRef = null;
let _lastJarvisContent = '';

function getApi() { return API; }
function updateLastJarvisMsg(...args) { return updateLastJarvisMsgRef?.(...args); }
function getLastJarvisContent() { return _lastJarvisContent; }

export function setLastJarvisContent(v) { _lastJarvisContent = v; }

export function initTTSPipeline({ api, updateLastJarvisMsg: uljm }) {
  API = api;
  updateLastJarvisMsgRef = uljm;
}

let ttsAudioEl = null;
let ttsCurrentText = '';
export let activeTTSVoiceId = null;
export function setActiveTTSVoiceId(v) { activeTTSVoiceId = v; }
export function isSttsActive() { return sttsActive; }
export function getTtsAudioEl() { return ttsAudioEl; }
let ttsInterruptedRemaining = '';
let ttsInterruptedOriginalContent = '';
let ttsInterruptionApplied = false;
let ttsInterruptionDbTimer = null;
let ttsStreamReader = null;
let ttsAudioGraph = null;

let ttsStreamingMode = false;
let sttsActive = false;
let sttsConsumed = 0;
let sttsBuf = '';
let sttsQueue = [];
let sttsPlaying = false;
let sttsSpoken = '';
let sttsCurSeg = '';
let sttsStreamDone = false;
let sttsMicSuspended = false;

const STTS_SENTENCE_RE = /[^。！？!?\n]*[。！？!?\n]+/g;
function sttsHasReadable(s) { return /[\p{L}\p{N}]/u.test(s); }

const TTS_STREAMING_KEY = 'xiaobailong.tts.streaming';
export function isTTSStreamingEnabled() {
  try { return localStorage.getItem(TTS_STREAMING_KEY) !== '0'; } catch { return true; }
}
export function setTTSStreamingEnabled(on) {
  try { localStorage.setItem(TTS_STREAMING_KEY, on ? '1' : '0'); } catch {}
}
export function ttsCanStream() {
  if (!isTTSStreamingEnabled()) return false;
  if (typeof window.MediaSource === 'undefined') return false;
  try { return MediaSource.isTypeSupported('audio/mpeg'); } catch { return false; }
}

// ── 流式回复文本工具 ──
const MARKER_STRIP_RE = /\[(?:RECALL:[\s\S]*?|SET_TASK:[\s\S]*?|CLEAR_TASK|UPDATE_PERSONA:[\s\S]*?)\]/g;
export function cleanStreamText(raw) {
  let s = String(raw || '').replace(MARKER_STRIP_RE, '');
  const lastOpen = s.lastIndexOf('[');
  if (lastOpen >= 0 && s.indexOf(']', lastOpen) === -1) {
    if (/^\[[A-Z_]*(:[\s\S]*)?$/.test(s.slice(lastOpen))) s = s.slice(0, lastOpen);
  }
  return s;
}

export function toPlainSpeech(md) {
  return String(md || '').trim()
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
    .replace(/!\[[^\]]*\]\([^\)]+\)/g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

export function calcRemainingText(text, currentTime, duration) {
  if (!text || !duration || duration <= 0) return { remaining: '', spokenUpTo: 0 };
  const progress = Math.min(1, currentTime / duration);
  const spokenChars = Math.floor(text.length * progress);
  const BOUNDARIES = /[。！？，.!?,\n]/g;
  let bestPos = spokenChars;
  let match;
  BOUNDARIES.lastIndex = Math.max(0, spokenChars - 10);
  while ((match = BOUNDARIES.exec(text)) !== null) {
    if (match.index >= spokenChars) {
      bestPos = match.index + 1;
      break;
    }
  }
  return { remaining: text.slice(bestPos).trim(), spokenUpTo: bestPos };
}

export function findMarkdownCutPos(markdown, ttsFullLen, ttsSpokenUpTo) {
  if (!markdown || ttsFullLen <= 0) return 0;
  const ratio = ttsSpokenUpTo / ttsFullLen;
  const approxPos = Math.floor(markdown.length * ratio);
  const BOUNDARIES = /[。！？\n.!?]/g;
  let bestPos = approxPos;
  BOUNDARIES.lastIndex = Math.max(0, approxPos - 15);
  let match;
  while ((match = BOUNDARIES.exec(markdown)) !== null) {
    if (match.index >= approxPos) { bestPos = match.index + 1; break; }
  }
  return bestPos;
}

function applyTTSInterruption(spokenUpTo) {
  const originalContent = getLastJarvisContent() || ttsCurrentText;
  if (!originalContent) return;
  ttsInterruptedOriginalContent = originalContent;
  ttsInterruptionApplied = true;

  const cutPos = findMarkdownCutPos(originalContent, ttsCurrentText.length, spokenUpTo);
  const spokenMarkdown = originalContent.slice(0, cutPos).trimEnd();
  const displayText = spokenMarkdown ? spokenMarkdown + ' ✋' : '✋';
  const dbContent = spokenMarkdown || '✋';

  updateLastJarvisMsg(displayText);

  if (ttsInterruptionDbTimer) clearTimeout(ttsInterruptionDbTimer);
  ttsInterruptionDbTimer = setTimeout(() => {
    ttsInterruptionDbTimer = null;
    fetch(`${getApi()}/tts/interrupted`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spokenContent: dbContent }),
    }).catch(() => {});
  }, 4000);
}

window.stopTTS = () => {
  if (ttsStreamingMode && sttsActive) { stopStreamingTTS(); return; }
  if (!ttsAudioEl) return;
  const { remaining, spokenUpTo } = calcRemainingText(
    ttsCurrentText,
    ttsAudioEl.currentTime,
    ttsAudioEl.duration,
  );
  ttsInterruptedRemaining = remaining || ttsCurrentText;
  applyTTSInterruption(spokenUpTo);
  clearTTSAudioGraph();
  ttsAudioEl.pause();
  try { URL.revokeObjectURL(ttsAudioEl.src); } catch {}
  if (ttsStreamReader) { try { ttsStreamReader.cancel(); } catch {} ttsStreamReader = null; }
  ttsAudioEl = null;
};

window.duckTTS = () => {
  if (ttsAudioEl) ttsAudioEl.volume = 0.15;
};

window.unduckTTS = () => {
  if (ttsAudioEl) ttsAudioEl.volume = 1.0;
};

window.resumeTTSIfNoSpeech = () => {
  const text = ttsInterruptedRemaining;
  ttsInterruptedRemaining = '';
  if (!text) return;
  if (ttsInterruptionDbTimer) { clearTimeout(ttsInterruptionDbTimer); ttsInterruptionDbTimer = null; }
  if (ttsInterruptionApplied && ttsInterruptedOriginalContent) {
    updateLastJarvisMsg(ttsInterruptedOriginalContent);
  }
  ttsInterruptionApplied = false;
  ttsInterruptedOriginalContent = '';
  playTTSReply(text);
};

function activateTTSAudioGraph(graph) {
  if (ttsAudioGraph && ttsAudioGraph !== graph) {
    try { ttsAudioGraph.teardown?.(); } catch {}
  }
  ttsAudioGraph = graph || null;
  window.xiaobailongVoice?.setTTSAnalyser?.(ttsAudioGraph?.analyser || null);
}

function clearTTSAudioGraph(graph) {
  if (arguments.length > 0) {
    if (!graph) return;
    if (graph !== ttsAudioGraph) {
      try { graph.teardown?.(); } catch {}
      return;
    }
  }
  if (ttsAudioGraph) {
    try { ttsAudioGraph.teardown?.(); } catch {}
    ttsAudioGraph = null;
  }
  window.xiaobailongVoice?.setTTSAnalyser?.(null);
}

function startTTSAudio(audioEl, revokeUrl, opts = {}) {
  const { manageMic = true, onComplete = null } = opts;
  ttsAudioEl = audioEl;
  audioEl.volume = 1.0;
  const audioGraph = attachJarvisAudioGraph(audioEl, activeTTSVoiceId);
  activateTTSAudioGraph(audioGraph);
  if (manageMic) window.xiaobailongVoice?.suspendForTTS?.();
  const finish = () => {
    clearTTSAudioGraph(audioGraph);
    if (revokeUrl) { try { URL.revokeObjectURL(revokeUrl); } catch {} }
    if (ttsAudioEl !== audioEl) return;
    if (ttsStreamReader) { try { ttsStreamReader.cancel(); } catch {} ttsStreamReader = null; }
    ttsAudioEl = null;
    if (onComplete) { onComplete(); return; }
    ttsCurrentText = '';
    if (manageMic) window.xiaobailongVoice?.resumeAfterMedia();
  };
  audioEl.onended = finish;
  audioEl.onerror = finish;
  applyOutputSink(audioEl).catch(() => {});
  audioEl.play().catch(() => {
    clearTTSAudioGraph(audioGraph);
    if (ttsAudioEl !== audioEl) return;
    if (onComplete) { ttsAudioEl = null; onComplete(); return; }
    if (manageMic) window.xiaobailongVoice?.resumeAfterMedia();
  });
}

function playTTSViaMediaSource(resp, opts = {}) {
  const mediaSource = new MediaSource();
  const url = URL.createObjectURL(mediaSource);
  const audioEl = new Audio(url);
  const isCurrentAudio = () => ttsAudioEl === audioEl;
  startTTSAudio(audioEl, url, opts);
  mediaSource.addEventListener('sourceopen', () => {
    if (!isCurrentAudio()) { try { mediaSource.endOfStream(); } catch {} return; }
    let sb;
    try { sb = mediaSource.addSourceBuffer('audio/mpeg'); }
    catch { try { mediaSource.endOfStream(); } catch {} return; }
    const reader = resp.body.getReader();
    if (!isCurrentAudio()) { try { reader.cancel(); } catch {} return; }
    ttsStreamReader = reader;
    const queue = [];
    let finished = false;
    const flush = () => {
      if (sb.updating) return;
      if (queue.length) { try { sb.appendBuffer(queue.shift()); } catch {} return; }
      if (finished && mediaSource.readyState === 'open') { try { mediaSource.endOfStream(); } catch {} }
    };
    sb.addEventListener('updateend', flush);
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (!isCurrentAudio()) {
            if (ttsStreamReader === reader) ttsStreamReader = null;
            try { reader.cancel(); } catch {}
            break;
          }
          if (done) {
            if (ttsStreamReader === reader) ttsStreamReader = null;
            finished = true; flush(); break;
          }
          if (value && value.byteLength) { queue.push(value); flush(); }
        }
      } catch {
        if (ttsStreamReader === reader) ttsStreamReader = null;
        finished = true; flush();
      }
    })();
  }, { once: true });
}

export async function playTTSReply(text) {
  ttsStreamingMode = false;
  ttsCurrentText = text;
  ttsInterruptedRemaining = '';
  ttsInterruptionApplied = false;
  ttsInterruptedOriginalContent = '';
  if (ttsStreamReader) { try { ttsStreamReader.cancel(); } catch {} ttsStreamReader = null; }
  try {
    const resp = await fetch(`${getApi()}/tts/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!resp.ok) {
      let errMsg = `HTTP ${resp.status}`;
      try { const j = await resp.json(); errMsg = j.error || errMsg; } catch {}
      throw new Error(errMsg);
    }
    if (ttsAudioEl) { clearTTSAudioGraph(); ttsAudioEl.pause(); try { URL.revokeObjectURL(ttsAudioEl.src); } catch {} }
    if (ttsCanStream() && resp.body) {
      playTTSViaMediaSource(resp);
    } else {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      startTTSAudio(new Audio(url), url);
    }
  } catch {
    clearTTSAudioGraph();
    ttsCurrentText = '';
    window.xiaobailongVoice?.resumeAfterMedia();
  }
}

// ── 逐句流式 TTS 队列 ──
export function beginStreamingTTS() {
  if (ttsStreamReader) { try { ttsStreamReader.cancel(); } catch {} ttsStreamReader = null; }
  if (ttsAudioEl) { clearTTSAudioGraph(); try { ttsAudioEl.pause(); URL.revokeObjectURL(ttsAudioEl.src); } catch {} ttsAudioEl = null; }
  ttsStreamingMode = true;
  sttsActive = true;
  sttsConsumed = 0; sttsBuf = ''; sttsQueue = []; sttsPlaying = false;
  sttsSpoken = ''; sttsCurSeg = ''; sttsStreamDone = false; sttsMicSuspended = false;
  ttsCurrentText = '';
}

export function feedStreamingTTS(rawFull) {
  if (!sttsActive) return;
  const cleaned = cleanStreamText(rawFull);
  if (cleaned.length <= sttsConsumed) return;
  sttsBuf += cleaned.slice(sttsConsumed);
  sttsConsumed = cleaned.length;
  extractSttsSentences({});
}

function extractSttsSentences({ flushPartial = false, markDone = false } = {}) {
  let lastIdx = 0, m;
  STTS_SENTENCE_RE.lastIndex = 0;
  while ((m = STTS_SENTENCE_RE.exec(sttsBuf)) !== null) {
    const s = m[0].trim();
    lastIdx = STTS_SENTENCE_RE.lastIndex;
    if (s && sttsHasReadable(s)) sttsQueue.push(s);
  }
  sttsBuf = sttsBuf.slice(lastIdx);
  if (flushPartial) {
    const tail = sttsBuf.trim();
    sttsBuf = '';
    if (tail && sttsHasReadable(tail)) sttsQueue.push(tail);
  }
  if (markDone) sttsStreamDone = true;
  pumpSttsQueue();
}

async function pumpSttsQueue() {
  if (!sttsActive || sttsPlaying) return;
  const seg = sttsQueue.shift();
  if (!seg) {
    if (sttsStreamDone) endStreamingTTS();
    return;
  }
  sttsPlaying = true;
  sttsCurSeg = seg;
  if (!sttsMicSuspended) { sttsMicSuspended = true; window.xiaobailongVoice?.suspendForTTS?.(); }
  const onComplete = () => {
    sttsSpoken += seg;
    sttsCurSeg = '';
    sttsPlaying = false;
    pumpSttsQueue();
  };
  try {
    const resp = await fetch(`${getApi()}/tts/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: seg }),
    });
    if (!sttsActive) return;
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    if (ttsCanStream() && resp.body) {
      playTTSViaMediaSource(resp, { manageMic: false, onComplete });
    } else {
      const blob = await resp.blob();
      if (!sttsActive) return;
      const url = URL.createObjectURL(blob);
      startTTSAudio(new Audio(url), url, { manageMic: false, onComplete });
    }
  } catch {
    onComplete();
  }
}

export function flushStreamingTTSBuf() {
  if (sttsActive) extractSttsSentences({ flushPartial: true });
}

export function finalizeStreamingTTS() {
  if (sttsActive) extractSttsSentences({ flushPartial: true, markDone: true });
}

export function endStreamingTTS() {
  sttsActive = false;
  ttsStreamingMode = false;
  clearTTSAudioGraph();
  if (sttsMicSuspended) { sttsMicSuspended = false; window.xiaobailongVoice?.resumeAfterMedia(); }
  sttsQueue = []; sttsBuf = ''; sttsCurSeg = ''; sttsSpoken = ''; sttsPlaying = false;
}

export function stopStreamingTTS() {
  let curSpoken = '', curRemain = '';
  if (ttsAudioEl && sttsCurSeg) {
    const r = calcRemainingText(sttsCurSeg, ttsAudioEl.currentTime, ttsAudioEl.duration);
    curSpoken = sttsCurSeg.slice(0, r.spokenUpTo);
    curRemain = r.remaining || sttsCurSeg;
  }
  const spokenPlain = sttsSpoken + curSpoken;
  const remainingPlain = [curRemain, sttsQueue.join(''), sttsBuf].filter(Boolean).join('').trim();
  const fullPlain = (spokenPlain + remainingPlain) || (getLastJarvisContent() || '');
  ttsCurrentText = fullPlain;
  ttsInterruptedRemaining = remainingPlain || fullPlain;
  applyTTSInterruption(spokenPlain.length);
  if (ttsAudioEl) { clearTTSAudioGraph(); try { ttsAudioEl.pause(); URL.revokeObjectURL(ttsAudioEl.src); } catch {} }
  if (ttsStreamReader) { try { ttsStreamReader.cancel(); } catch {} ttsStreamReader = null; }
  ttsAudioEl = null;
  sttsActive = false; ttsStreamingMode = false;
  sttsQueue = []; sttsBuf = ''; sttsCurSeg = ''; sttsSpoken = ''; sttsPlaying = false;
  sttsMicSuspended = false;
}
