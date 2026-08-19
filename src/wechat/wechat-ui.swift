// wechat-ui.swift — macOS 微信 UI 控制 helper (P2 核心)
// 用法: swift wechat-ui.swift <command> [args...]
//   find          找微信窗口 → {x,y,w,h}(CGWindowList 优先, AX 兜底含最小化)
//   activate      把微信带到前台
//   tree [深度]   AX 树 → JSON (name/role/frame, 深度/宽度截断)
//   snapshot      tree 别名
//   click X Y     拟人移动+点击 [double]
//   type "文本"   Unicode 直写(绕过输入法)
//   key <name>    按键(return/tab/esc/space/enter/方向/delete)
//   screenshot /path.png  截微信窗口
import AppKit
import ApplicationServices
import Foundation

func emit(_ dict: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: dict),
     let line = String(data: data, encoding: .utf8) {
    print(line)
    fflush(stdout)
  }
}
func fail(_ msg: String) -> Never {
  emit(["ok": false, "error": msg])
  exit(1)
}

// ── CG 窗口查找(只在屏上可见的) ──
func findCGWindow() -> [String: Any]? {
  let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
  guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return nil }
  for w in list {
    let owner = (w[kCGWindowOwnerName as String]) as? String ?? ""
    if owner == "微信" || owner == "WeChat" {
      let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
      let width = (b["Width"] as? NSNumber)?.doubleValue ?? 0
      let height = (b["Height"] as? NSNumber)?.doubleValue ?? 0
      if width > 300 && height > 300 {
        return [
          "x": (b["X"] as? NSNumber)?.doubleValue ?? 0,
          "y": (b["Y"] as? NSNumber)?.doubleValue ?? 0,
          "w": width, "h": height,
          "window_id": (w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0,
        ]
      }
    }
  }
  return nil
}

// ── AX 权限 ──
func checkAXPermission() {
  let opts = ["AXTrustedCheckOptionPrompt": false] as CFDictionary
  if !AXIsProcessTrustedWithOptions(opts) {
    fail("需要辅助功能权限: 系统设置→隐私与安全性→辅助功能 → 添加终端(或 MyAI)")
  }
}

// ── 微信 NSRunningApplication ──
func wechatApp() -> NSRunningApplication? {
  NSWorkspace.shared.runningApplications.first {
    $0.localizedName == "微信" || $0.localizedName == "WeChat"
      || $0.bundleIdentifier?.lowercased().contains("xinwechat") == true
      || $0.bundleIdentifier?.lowercased().contains("wechat") == true
  }
}

// ── AX 窗口(含最小化, kAXMinimized 判断) ──
func findAXWindowInfo() -> (app: AXUIElement, win: AXUIElement, frame: CGRect)? {
  guard let app = wechatApp() else { return nil }
  let axApp = AXUIElementCreateApplication(app.processIdentifier)
  var v: CFTypeRef?
  guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &v) == .success,
        let windows = v as! [AXUIElement]? else { return nil }
  for win in windows {
    // 取 position + size
    var frame = CGRect.zero
    if AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &v) == .success,
       let val = v as! AXValue? {
      var pt = CGPoint.zero
      if AXValueGetValue(val, AXValueType.cgPoint, &pt) { frame.origin = pt }
    }
    if AXUIElementCopyAttributeValue(win, kAXSizeAttribute as CFString, &v) == .success,
       let val = v as! AXValue? {
      var sz = CGSize.zero
      if AXValueGetValue(val, AXValueType.cgSize, &sz) { frame.size = sz }
    }
    if frame.width > 300 && frame.height > 300 {
      return (axApp, win, frame)
    }
  }
  return nil
}

// ── AX 树序列化 ──
func axToDict(_ el: AXUIElement, depth: Int, maxDepth: Int, maxChildren: Int) -> [String: Any] {
  var v: CFTypeRef?
  var out: [String: Any] = [:]
  if AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &v) == .success { out["role"] = v as? String ?? "" }
  if AXUIElementCopyAttributeValue(el, kAXTitleAttribute as CFString, &v) == .success, let s = v as? String, !s.isEmpty { out["name"] = String(s.prefix(120)) }
  if AXUIElementCopyAttributeValue(el, kAXDescriptionAttribute as CFString, &v) == .success, let s = v as? String, !s.isEmpty { out["desc"] = String(s.prefix(120)) }
  if AXUIElementCopyAttributeValue(el, kAXValueAttribute as CFString, &v) == .success, let s = v as? String, !s.isEmpty { out["value"] = String(s.prefix(200)) }
  // frame
  var frame = CGRect.zero
  var hasFrame = false
  if AXUIElementCopyAttributeValue(el, kAXPositionAttribute as CFString, &v) == .success,
     let val = v as! AXValue? {
    var pt = CGPoint.zero
    if AXValueGetValue(val, AXValueType.cgPoint, &pt) { frame.origin = pt; hasFrame = true }
  }
  if AXUIElementCopyAttributeValue(el, kAXSizeAttribute as CFString, &v) == .success,
     let val = v as! AXValue? {
    var sz = CGSize.zero
    if AXValueGetValue(val, AXValueType.cgSize, &sz) { frame.size = sz; hasFrame = true }
  }
  if hasFrame {
    out["frame"] = ["x": Int(frame.minX), "y": Int(frame.minY), "w": Int(frame.width), "h": Int(frame.height)]
  }
  if depth < maxDepth {
    if AXUIElementCopyAttributeValue(el, kAXChildrenAttribute as CFString, &v) == .success,
       let children = v as! [AXUIElement]? {
      var kids: [[String: Any]] = []
      for (i, child) in children.enumerated() {
        if i >= maxChildren { kids.append(["role": "…", "more": children.count - maxChildren]); break }
        kids.append(axToDict(child, depth: depth + 1, maxDepth: maxDepth, maxChildren: maxChildren))
      }
      if !kids.isEmpty { out["children"] = kids }
    }
  }
  return out
}

// ── 拟人鼠标(参考 WeChatCustomerService: 随机步数+smoothstep+随机延时) ──
func screenH() -> CGFloat { NSScreen.screens.first?.frame.height ?? 900 }
func moveMouseSmooth(to tx: CGFloat, _ ty: CGFloat) {
  let loc = NSEvent.mouseLocation
  let sx = loc.x, sy = screenH() - loc.y
  let steps = Int.random(in: 14...24)
  for step in 1...steps {
    let p = CGFloat(step) / CGFloat(steps)
    let eased = p * p * (3 - 2 * p)
    let x = sx + (tx - sx) * eased, y = sy + (ty - sy) * eased
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left)?
      .post(tap: .cghidEventTap)
    usleep(useconds_t(Int.random(in: 8000...18000)))
  }
}
func click(at x: CGFloat, _ y: CGFloat, double: Bool = false) {
  moveMouseSmooth(to: x, y)
  usleep(50000)
  let pt = CGPoint(x: x, y: y)
  let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: pt, mouseButton: .left)!
  let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: pt, mouseButton: .left)!
  down.post(tap: .cghidEventTap); usleep(80000); up.post(tap: .cghidEventTap)
  if double { usleep(120000); down.post(tap: .cghidEventTap); usleep(80000); up.post(tap: .cghidEventTap) }
}

// ── 键盘 ──
let KEYMAP: [String: CGKeyCode] = ["return": 36, "enter": 76, "tab": 48, "esc": 53, "escape": 53,
  "space": 49, "delete": 51, "up": 126, "down": 125, "left": 123, "right": 124]
func pressKey(_ code: CGKeyCode) {
  let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)!
  let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)!
  down.post(tap: .cghidEventTap); usleep(60000); up.post(tap: .cghidEventTap)
}
func typeText(_ text: String) {
  for ch in text {
    let u16 = Array(String(ch).utf16)
    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)!
    down.keyboardSetUnicodeString(stringLength: u16.count, unicodeString: u16)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)!
    up.keyboardSetUnicodeString(stringLength: u16.count, unicodeString: u16)
    down.post(tap: .cghidEventTap); usleep(UInt32.random(in: 30000...80000))
    up.post(tap: .cghidEventTap); usleep(UInt32.random(in: 20000...60000))
  }
}

// ── 截屏 ──
func screenshot(rect: CGRect, to path: String) {
  // 用系统 screencapture 命令截指定区域(macOS 15 废弃了 CGWindowListCreateImage)
  let p = Process()
  p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
  p.arguments = ["-x", "-R\(Int(rect.minX)),\(Int(rect.minY)),\(Int(rect.width)),\(Int(rect.height))", path]
  try? p.run(); p.waitUntilExit()
  if p.terminationStatus != 0 { fail("screencapture 失败") }
}

// ── main ──
let args = CommandLine.arguments
guard args.count >= 2 else { fail("用法: wechat-ui.swift <command> [args...]") }
let cmd = args[1]

switch cmd {
case "find":
  if let w = findCGWindow() { emit(["ok": true, "source": "cg", "window": w]) }
  else if let ax = findAXWindowInfo() {
    emit(["ok": true, "source": "ax", "window": ["x": ax.frame.minX, "y": ax.frame.minY, "w": ax.frame.width, "h": ax.frame.height]])
  } else { emit(["ok": false, "error": "未找到微信窗口(微信未运行或未开主窗)"]) }

case "activate":
  guard let app = wechatApp() else { fail("微信未运行") }
  app.activate()
  usleep(400000)
  // 取消最小化
  if let ax = findAXWindowInfo() {
    var v: CFTypeRef?
    if AXUIElementCopyAttributeValue(ax.win, kAXMinimizedAttribute as CFString, &v) == .success, let min = v as? Bool, min {
      AXUIElementSetAttributeValue(ax.win, kAXMinimizedAttribute as CFString, kCFBooleanFalse)
      usleep(400000)
    }
  }
  emit(["ok": true])

case "tree", "snapshot":
  checkAXPermission()
  guard let ax = findAXWindowInfo() else { fail("微信主窗口未找到(AX)或需先 activate") }
  let maxDepth = args.count > 2 ? Int(args[2]) ?? 7 : 7
  let tree = axToDict(ax.win, depth: 0, maxDepth: maxDepth, maxChildren: 40)
  emit(["ok": true, "tree": tree])

case "click":
  checkAXPermission()
  guard args.count >= 4, let x = Double(args[2]), let y = Double(args[3]) else { fail("click 需要 X Y") }
  click(at: CGFloat(x), CGFloat(y), double: args.count > 4 && args[4] == "double")
  emit(["ok": true, "clicked": [x, y]])

case "type":
  checkAXPermission()
  guard args.count >= 3 else { fail("type 需要 文本") }
  typeText(args[2])
  emit(["ok": true, "typed_chars": args[2].count])

case "key":
  checkAXPermission()
  guard args.count >= 3, let code = KEYMAP[args[2].lowercased()] else { fail("未知按键 \(args.count > 2 ? args[2] : "")") }
  pressKey(code)
  emit(["ok": true, "key": args[2]])

case "screenshot":
  guard args.count >= 3 else { fail("screenshot 需要 路径") }
  var rect: CGRect
  if let w = findCGWindow(),
     let x = w["x"] as? Double, let y = w["y"] as? Double,
     let width = w["w"] as? Double, let height = w["h"] as? Double {
    rect = CGRect(x: x, y: y, width: width, height: height)
  } else if let ax = findAXWindowInfo() {
    rect = ax.frame
  } else { fail("未找到微信窗口") }
  screenshot(rect: rect, to: args[2])
  emit(["ok": true, "path": args[2], "rect": ["x": rect.minX, "y": rect.minY, "w": rect.width, "h": rect.height]])

default:
  fail("未知命令: \(cmd)")
}
