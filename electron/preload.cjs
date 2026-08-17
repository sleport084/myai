const { contextBridge, ipcRenderer, webFrame } = require('electron')

contextBridge.exposeInMainWorld('bailongma', {
  platform: process.platform,
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check-for-updates'),
  startDownload: () => ipcRenderer.invoke('updater:start-download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:quit-and-install'),
  getZoomFactor: () => webFrame.getZoomFactor(),
  setZoomFactor: (factor) => webFrame.setZoomFactor(factor),
  onUpdaterStatus: (handler) => {
    if (typeof handler !== 'function') return () => {}
    const listener = (_event, payload) => handler(payload)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
  // 内嵌浏览器预览卡片:渲染层通过这些方法控制 WebContentsView
  browserEmbed: {
    update: (payload) => ipcRenderer.invoke('browser-embed:update'),
    hide: () => ipcRenderer.invoke('browser-embed:hide'),
    getState: () => ipcRenderer.invoke('browser-embed:get-state'),
  },
  // 保存图片:弹出"另存为"对话框,将 base64 图片写入用户选择的路径
  saveImage: (payload) => ipcRenderer.invoke('save-image', payload),
  // 语音唤醒:命中「小白龙」由主进程经 wake:hit 通知渲染层;
  // 悬浮球窗由本渲染层经下列命令驱动(主进程转发给球窗)。
  wake: {
    onHit: (handler) => {
      if (typeof handler !== 'function') return () => {}
      const listener = () => handler()
      ipcRenderer.on('wake:hit', listener)
      return () => ipcRenderer.removeListener('wake:hit', listener)
    },
    orbEnter: () => ipcRenderer.send('wake:orb-enter'),
    orbFrame: (payload) => ipcRenderer.send('wake:orb-frame', payload),
    orbText: (payload) => ipcRenderer.send('wake:orb-text', payload),
    orbExit: () => ipcRenderer.send('wake:orb-exit'),
  },
})
