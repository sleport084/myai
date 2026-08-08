// cloud-login-preload.cjs — 云端登录窗口的预加载脚本
// 暴露 cloudAuthSuccess 接口让登录页面通知主进程
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  cloudAuthSuccess: (data) => ipcRenderer.send('cloud-auth-success', data),
})
