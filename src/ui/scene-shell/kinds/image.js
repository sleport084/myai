// kind: image —— 展示一张图片(内容比描述更直接时)。
// data: { url, title?, alt? }  ·  上行 intent:dismiss(用户关闭)。

import { el, setText } from './dom.js'

export const image = {
  render(data = {}, ctx = {}) {
    const img = el('img', {
      class: 'i-img',
      src: data.url || '',
      alt: data.alt || data.title || '',
      // 图片解码完成再淡入,避免"先白块后跳图"。
      onload: (e) => e.target.classList.add('loaded'),
    })
    const close = el('button', {
      class: 'i-close',
      title: '关闭',
      text: '×',
      // 仅显示 + 上报;关不关、关了之后做什么,由 Agent 决策(见 SCENE-PROTOCOL §3.4)。
      onclick: () => ctx.emit && ctx.emit('dismiss', {}),
    })
    return el('figure', { class: 'k-image' }, [
      img,
      close,
      data.title ? el('figcaption', { class: 'i-cap', text: data.title }) : null,
    ])
  },

  enter() {},
  exit() {},

  // morph:换图做交叉淡化(共享元素感),标题原地更新。
  morph(el_, prev = {}, next = {}) {
    const img = el_.querySelector('.i-img')
    let cap = el_.querySelector('.i-cap')

    if (img && prev.url !== next.url) {
      img.classList.remove('loaded')
      img.addEventListener('load', () => img.classList.add('loaded'), { once: true })
      img.src = next.url || ''
    }
    if (img) img.alt = next.alt || next.title || ''

    if (next.title && !cap) {
      cap = el('figcaption', { class: 'i-cap', text: next.title })
      el_.appendChild(cap)
    } else if (!next.title && cap) {
      cap.remove()
    } else if (cap) {
      setText(cap, next.title)
    }
  },
}
