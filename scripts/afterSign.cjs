// afterSign.cjs — electron-builder 钩子: 打包后立即 ad-hoc 签名
// macOS 对未签名应用拒绝弹麦克风(TCC)授权窗 → 语音采集纯静音。
// 无开发者证书也能签(ad-hoc), 签名后 TCC 弹窗正常。
// 必须在 DMG 生成前执行(afterPack), 这样 DMG 里的是已签名 app。
exports.default = async function afterSign(context) {
  const { execSync } = require('child_process')
  const path = require('path')
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log('[afterSign] ad-hoc signing ' + appPath)
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
    console.log('[afterSign] ✓ signed')
  } catch (e) {
    console.warn('[afterSign] 签名失败(功能不受影响, 但麦克风授权窗可能不弹): ' + e.message)
  }
}
