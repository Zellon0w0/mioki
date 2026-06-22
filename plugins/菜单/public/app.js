// WebUI Menu Preview Controller

// Get auth token from parent window
const token = localStorage.getItem('mioki_token') || ''

// Mock info for preview rendering
const mockAvatarUrl = 'https://p.qlogo.cn/gh/10001/10001/100'
const mockNickname = 'Mioki Bot'

// State
let pluginConfig = null
const PLUGIN_NAME = '菜单'

// DOM Elements
const configForm = document.getElementById('config-form')
const categoriesContainer = document.getElementById('categories-container')
const addCategoryBtn = document.getElementById('add-category-btn')
const resetBtn = document.getElementById('reset-btn')
const previewPngBtn = document.getElementById('preview-png-btn')
const iframe = document.getElementById('html-preview-iframe')

// Modal DOM
const pngModal = document.getElementById('png-modal')
const renderedPngImg = document.getElementById('rendered-png-img')
const modalLoadingText = pngModal.querySelector('.modal-loading-text')
const closeModalBtns = pngModal.querySelectorAll('.close-modal-btn')

const ICON_UP =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"></path></svg>'
const ICON_DOWN =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>'
const ICON_DELETE =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="m19 6-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>'

// Toast Notification
const toast = document.getElementById('toast')
function showToast(message, type = 'success') {
  const toastMsg = toast.querySelector('.toast-message')
  toastMsg.textContent = message
  toast.className = `toast show ${type}`
  setTimeout(() => {
    toast.classList.remove('show')
  }, 4000)
}

// Check auth & redirect if missing
if (!token) {
  showToast('未登录 WebUI，无法加载配置', 'error')
  // If in iframe, notify parent or show message
}

// ----------------- Core HTML & CSS Render Logic (Cloned from Backend) -----------------
function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function normalizeTheme(theme) {
  switch (theme) {
    case 'material-warm':
    case 'hatsune':
      return 'material-warm'
    case 'material-dark':
    case 'cyberpunk':
      return 'material-dark'
    case 'material-light':
    case 'eva-02':
    default:
      return 'material-light'
  }
}

function getThemeVariables(theme) {
  const palettes = {
    'material-light': {
      'md-bg': '#f7f8ff',
      'md-surface': '#fefbff',
      'md-surface-dim': '#f0f1fa',
      'md-surface-container-low': '#f8f6ff',
      'md-surface-container': '#f1eff7',
      'md-surface-container-high': '#e9e7ef',
      'md-on-surface': '#1b1b21',
      'md-on-surface-variant': '#46464f',
      'md-outline': '#777680',
      'md-outline-variant': '#c7c5d0',
      'md-primary': '#005ac1',
      'md-on-primary': '#ffffff',
      'md-primary-container': '#d8e2ff',
      'md-on-primary-container': '#001a41',
      'md-secondary': '#6750a4',
      'md-secondary-container': '#e9ddff',
      'md-tertiary': '#006a60',
      'md-tertiary-container': '#77f8e4',
      'md-shadow': 'rgba(24, 31, 54, 0.16)',
    },
    'material-warm': {
      'md-bg': '#fff8f1',
      'md-surface': '#fffdf8',
      'md-surface-dim': '#f4ece0',
      'md-surface-container-low': '#fff3e2',
      'md-surface-container': '#f8eddd',
      'md-surface-container-high': '#efe4d5',
      'md-on-surface': '#211b13',
      'md-on-surface-variant': '#51443a',
      'md-outline': '#837468',
      'md-outline-variant': '#d6c2b3',
      'md-primary': '#8a5100',
      'md-on-primary': '#ffffff',
      'md-primary-container': '#ffddb5',
      'md-on-primary-container': '#2c1600',
      'md-secondary': '#53643e',
      'md-secondary-container': '#d6ebbb',
      'md-tertiary': '#006a6a',
      'md-tertiary-container': '#80f4f0',
      'md-shadow': 'rgba(73, 47, 20, 0.16)',
    },
    'material-dark': {
      'md-bg': '#121318',
      'md-surface': '#1b1b21',
      'md-surface-dim': '#121318',
      'md-surface-container-low': '#202127',
      'md-surface-container': '#25262d',
      'md-surface-container-high': '#303139',
      'md-on-surface': '#e4e2ea',
      'md-on-surface-variant': '#c8c5d0',
      'md-outline': '#918f99',
      'md-outline-variant': '#47464f',
      'md-primary': '#abc7ff',
      'md-on-primary': '#002f68',
      'md-primary-container': '#00458f',
      'md-on-primary-container': '#d8e2ff',
      'md-secondary': '#d0bcff',
      'md-secondary-container': '#4f378b',
      'md-tertiary': '#7bded4',
      'md-tertiary-container': '#00504d',
      'md-shadow': 'rgba(0, 0, 0, 0.36)',
    },
  }

  return Object.entries(palettes[normalizeTheme(theme)])
    .map(([key, value]) => `        --${key}: ${value};`)
    .join('\n')
}

function renderHtmlPreview(config, avatarUrl, nickname) {
  const sortedCategories = [...(config.categories || [])].sort((a, b) => (a.order ?? 10) - (b.order ?? 10))

  const categoriesHtml = sortedCategories
    .map((cat) => {
      const name = escapeHtml(cat.name)
      const badge = escapeHtml(cat.badge || '功能')
      const desc = cat.desc ? `<div class="category-desc">${escapeHtml(cat.desc)}</div>` : ''
      const commands = cat.commands || []
      const commandsList =
        commands.length > 0
          ? commands.map((cmd) => `<span class="cmd-chip">${escapeHtml(cmd)}</span>`).join('')
          : '<span class="cmd-chip cmd-chip-empty">暂无指令</span>'
      const width = cat.width === 2 ? 2 : 1

      return `
        <section class="category-card" style="grid-column: span ${width};">
          <div class="category-header">
            <div>
              <div class="category-badge">${badge}</div>
              <h2 class="category-title">${name}</h2>
            </div>
            <span class="category-count">${commands.length}</span>
          </div>
          ${desc}
          <div class="commands-container">
            ${commandsList}
          </div>
        </section>
      `
    })
    .join('')

  const totalCommands = sortedCategories.reduce((acc, cat) => acc + (cat.commands?.length || 0), 0)
  const title = escapeHtml(config.title || nickname || 'Mioki')
  const subtitle = escapeHtml(config.subtitle || '清晰有序的指令菜单')
  const botName = escapeHtml(nickname || 'Mioki')

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
${getThemeVariables(config.theme)}
        }
        body {
          margin: 0;
          padding: 24px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
          background:
            linear-gradient(135deg, var(--md-bg), var(--md-surface-dim));
          color: var(--md-on-surface);
          font-family: 'Noto Sans SC', 'Outfit', 'Microsoft YaHei', sans-serif;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-container {
          position: relative;
          overflow: hidden;
          width: 100%;
          padding: 30px;
          background: var(--md-surface);
          border: 1px solid var(--md-outline-variant);
          border-radius: 28px;
          box-shadow: 0 18px 44px var(--md-shadow);
        }
        .menu-container::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 12px;
          background: linear-gradient(90deg, var(--md-primary), var(--md-tertiary), var(--md-secondary));
        }
        .header-card {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 20px;
          align-items: center;
          padding: 24px;
          margin-bottom: 20px;
          background: var(--md-surface-container-low);
          border: 1px solid var(--md-outline-variant);
          border-radius: 24px;
        }
        .avatar-wrapper {
          position: relative;
          width: 76px;
          height: 76px;
          padding: 4px;
          border-radius: 24px;
          background: var(--md-primary-container);
        }
        .avatar-wrapper::after {
          content: '';
          position: absolute;
          right: 2px;
          bottom: 2px;
          width: 16px;
          height: 16px;
          background: var(--md-tertiary);
          border: 3px solid var(--md-surface-container-low);
          border-radius: 50%;
        }
        .avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
          border-radius: 20px;
        }
        .header-info {
          min-width: 0;
        }
        .header-subtitle {
          margin-bottom: 4px;
          color: var(--md-on-surface-variant);
          font-size: 14px;
          font-weight: 600;
          line-height: 1.35;
        }
        .header-info h1 {
          color: var(--md-on-surface);
          font-size: 34px;
          font-weight: 800;
          line-height: 1.15;
          letter-spacing: 0;
          overflow-wrap: anywhere;
        }
        .header-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }
        .meta-chip {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          padding: 6px 12px;
          border-radius: 16px;
          background: var(--md-secondary-container);
          color: var(--md-on-surface);
          font-size: 13px;
          font-weight: 600;
          line-height: 1;
        }
        .meta-chip strong {
          margin-right: 4px;
          color: var(--md-primary);
          font-size: 16px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }
        .category-card {
          min-width: 0;
          padding: 18px;
          background: var(--md-surface-container);
          border: 1px solid var(--md-outline-variant);
          border-radius: 16px;
        }
        .category-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 10px;
        }
        .category-badge {
          width: fit-content;
          max-width: 100%;
          margin-bottom: 6px;
          padding: 4px 9px;
          overflow: hidden;
          color: var(--md-on-primary-container);
          background: var(--md-primary-container);
          border-radius: 8px;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .category-title {
          color: var(--md-on-surface);
          font-size: 18px;
          font-weight: 800;
          line-height: 1.25;
          letter-spacing: 0;
          overflow-wrap: anywhere;
        }
        .category-count {
          flex: 0 0 auto;
          min-width: 34px;
          height: 34px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: var(--md-on-primary);
          background: var(--md-primary);
          border-radius: 17px;
          font-size: 14px;
          font-weight: 800;
        }
        .category-desc {
          margin-bottom: 13px;
          color: var(--md-on-surface-variant);
          font-size: 13px;
          line-height: 1.55;
          overflow-wrap: anywhere;
        }
        .commands-container {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .cmd-chip {
          display: inline-flex;
          align-items: center;
          min-height: 32px;
          max-width: 100%;
          padding: 6px 11px;
          color: var(--md-primary);
          background: var(--md-surface);
          border: 1px solid var(--md-outline-variant);
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.3;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .cmd-chip-empty {
          color: var(--md-on-surface-variant);
          font-weight: 500;
        }
        .footer-card {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-top: 18px;
          padding: 14px 18px;
          color: var(--md-on-surface-variant);
          background: var(--md-surface-container-high);
          border-radius: 14px;
          font-size: 12px;
          font-weight: 600;
        }
        .footer-card strong {
          color: var(--md-primary);
        }
        @media (max-width: 780px) {
          .menu-wrapper { width: 100%; }
          .menu-container { padding: 22px; border-radius: 22px; }
          .header-card { grid-template-columns: 1fr; }
          .header-info h1 { font-size: 28px; }
          .menu-grid { grid-template-columns: 1fr; }
          .category-card { grid-column: span 1 !important; }
          .footer-card { flex-direction: column; }
        }
      </style>
    </head>
    <body>
      <div class="menu-wrapper">
        <main class="menu-container">
          <header class="header-card">
            <div class="avatar-wrapper">
              <img class="avatar" src="${avatarUrl}" alt="avatar" />
            </div>
            <div class="header-info">
              <div class="header-subtitle">${subtitle}</div>
              <h1>${title}</h1>
              <div class="header-meta">
                <span class="meta-chip"><strong>${sortedCategories.length}</strong> 功能</span>
                <span class="meta-chip"><strong>${totalCommands}</strong> 指令</span>
                <span class="meta-chip">Mioki</span>
              </div>
            </div>
          </header>

          <div class="menu-grid">
            ${categoriesHtml}
          </div>

          <footer class="footer-card">
            <span>Bot: <strong>${botName}</strong></span>
            <span>OneBot v11 · Material 3</span>
          </footer>
        </main>
      </div>
    </body>
    </html>
  `
}

// ----------------- Core Page Controller -----------------

// Live preview renderer
function triggerLivePreview() {
  const currentConfig = collectFormData()
  const htmlContent = renderHtmlPreview(currentConfig, mockAvatarUrl, mockNickname)

  const doc = iframe.contentDocument || iframe.contentWindow.document
  doc.open()
  doc.write(htmlContent)
  doc.close()
}

// Collect data from visual inputs
function collectFormData() {
  const enabled = document.getElementById('field-enabled').checked
  const command = document.getElementById('field-command').value.trim()
  const title = document.getElementById('field-title').value.trim()
  const subtitle = document.getElementById('field-subtitle').value.trim()
  const theme = normalizeTheme(document.getElementById('field-theme').value)

  const categoryCards = categoriesContainer.querySelectorAll('.cat-item-card')
  const categories = Array.from(categoryCards).map((card) => {
    const name = card.querySelector('.field-cat-name').value.trim()
    const badge = card.querySelector('.field-cat-badge').value.trim()
    const desc = card.querySelector('.field-cat-desc').value.trim()
    const order = Number(card.querySelector('.field-cat-order').value) || 10
    const width = Number(card.querySelector('.field-cat-width').value) || 1
    const commandsText = card.querySelector('.field-cat-commands').value.trim()
    const commands = commandsText
      ? commandsText
          .split('\n')
          .map((c) => c.trim())
          .filter(Boolean)
      : []

    return { name, badge, desc, order, width, commands }
  })

  return {
    enabled,
    command,
    title,
    subtitle,
    theme,
    whitelist: pluginConfig?.whitelist || [],
    categories,
  }
}

// Render inputs from config
function renderFormInputs(config) {
  document.getElementById('field-enabled').checked = config.enabled !== false
  document.getElementById('field-command').value = config.command || '菜单'
  document.getElementById('field-title').value = config.title || ''
  document.getElementById('field-subtitle').value = config.subtitle || ''
  document.getElementById('field-theme').value = normalizeTheme(config.theme || 'material-light')

  categoriesContainer.innerHTML = ''

  const sorted = [...(config.categories || [])].sort((a, b) => (a.order ?? 10) - (b.order ?? 10))
  sorted.forEach((cat, index) => {
    addCategoryCardDOM(cat, index)
  })

  triggerLivePreview()
}

function addCategoryCardDOM(cat = {}, index = 0) {
  const card = document.createElement('div')
  card.className = 'cat-item-card'
  card.innerHTML = `
    <div class="cat-card-header">
      <span class="cat-card-title">菜单卡片</span>
      <div class="cat-card-actions">
        <button type="button" class="btn btn-icon btn-sm move-up-btn" title="上移">${ICON_UP}</button>
        <button type="button" class="btn btn-icon btn-sm move-down-btn" title="下移">${ICON_DOWN}</button>
        <button type="button" class="btn btn-icon btn-sm text-danger remove-cat-btn" title="删除">${ICON_DELETE}</button>
      </div>
    </div>
    <div class="cat-fields-grid">
      <div class="form-group">
        <label>分类名称</label>
        <input type="text" class="field-cat-name" value="${cat.name || ''}" placeholder="例如: 60s 资讯" required>
      </div>
      <div class="form-group">
        <label>分类标签 (Badge)</label>
        <input type="text" class="field-cat-badge" value="${cat.badge || ''}" placeholder="例如: 60s">
      </div>
      <div class="form-group col-span-2">
        <label>分类描述</label>
        <input type="text" class="field-cat-desc" value="${cat.desc || ''}" placeholder="对该分类的简单说明">
      </div>
      <div class="form-group">
        <label>排序序号</label>
        <input type="number" class="field-cat-order" value="${cat.order ?? 10}" step="1">
      </div>
      <div class="form-group">
        <label>卡片宽度</label>
        <select class="field-cat-width">
          <option value="1" ${cat.width === 1 ? 'selected' : ''}>半宽 (单栏)</option>
          <option value="2" ${cat.width === 2 ? 'selected' : ''}>全宽 (双栏)</option>
        </select>
      </div>
      <div class="form-group col-span-2">
        <label>指令命令列表 (每行一个)</label>
        <textarea class="field-cat-commands" rows="4" placeholder="每行输入一个指令">${Array.isArray(cat.commands) ? cat.commands.join('\n') : ''}</textarea>
      </div>
    </div>
  `

  categoriesContainer.appendChild(card)

  // Hook input changes to trigger real-time preview
  card.querySelectorAll('input, select, textarea').forEach((el) => {
    el.addEventListener('input', triggerLivePreview)
  })

  // Up, Down, Delete buttons
  card.querySelector('.remove-cat-btn').addEventListener('click', () => {
    card.remove()
    triggerLivePreview()
  })

  card.querySelector('.move-up-btn').addEventListener('click', () => {
    const prev = card.previousElementSibling
    if (prev) {
      categoriesContainer.insertBefore(card, prev)
      // Swap order field values
      const cardOrderInput = card.querySelector('.field-cat-order')
      const prevOrderInput = prev.querySelector('.field-cat-order')
      const temp = cardOrderInput.value
      cardOrderInput.value = prevOrderInput.value
      prevOrderInput.value = temp
      triggerLivePreview()
    }
  })

  card.querySelector('.move-down-btn').addEventListener('click', () => {
    const next = card.nextElementSibling
    if (next) {
      categoriesContainer.insertBefore(next, card)
      // Swap order field values
      const cardOrderInput = card.querySelector('.field-cat-order')
      const nextOrderInput = next.querySelector('.field-cat-order')
      const temp = cardOrderInput.value
      cardOrderInput.value = nextOrderInput.value
      nextOrderInput.value = temp
      triggerLivePreview()
    }
  })
}

// ----------------- Fetch / Save API Integration -----------------

async function loadMenuConfig() {
  try {
    const res = await fetch('/api/plugins', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) throw new Error('获取插件列表失败')

    const plugins = await res.json()
    const menuPlugin = plugins.find((p) => p.name === PLUGIN_NAME)
    if (!menuPlugin || !menuPlugin.config) throw new Error('未找到菜单插件的配置')

    pluginConfig = menuPlugin.config
    renderFormInputs(pluginConfig)
  } catch (err) {
    showToast(err.message, 'error')
  }
}

// Save config to backend
configForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const saveBtn = document.getElementById('save-btn')
  saveBtn.disabled = true
  saveBtn.textContent = '正在保存并热重载...'

  try {
    const updatedConfig = collectFormData()

    // Save via core WebUI API
    const res = await fetch(`/api/plugins/${PLUGIN_NAME}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ config: updatedConfig }),
    })

    if (res.ok) {
      showToast('配置保存并热重载成功！')
      pluginConfig = updatedConfig
    } else {
      const data = await res.json()
      showToast(`保存失败: ${data.error || '未知错误'}`, 'error')
    }
  } catch (err) {
    showToast('网络请求失败，请检查服务器连接', 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.textContent = '保存并重载配置'
  }
})

// Reset changes
resetBtn.addEventListener('click', () => {
  if (pluginConfig) {
    renderFormInputs(pluginConfig)
    showToast('已重置回上次保存的配置')
  }
})

// Add new category card
addCategoryBtn.addEventListener('click', () => {
  const cards = categoriesContainer.querySelectorAll('.cat-item-card')
  const nextOrder = (cards.length + 1) * 10
  addCategoryCardDOM({ name: '', badge: '', desc: '', order: nextOrder, width: 1, commands: [] }, cards.length)
  triggerLivePreview()
})

// Trigger live preview when global fields change
document
  .querySelectorAll('#field-enabled, #field-command, #field-title, #field-subtitle, #field-theme')
  .forEach((el) => {
    el.addEventListener('input', triggerLivePreview)
  })

// ----------------- PNG Screenshot Modal Integration -----------------
previewPngBtn.addEventListener('click', async () => {
  // Show Modal
  pngModal.classList.remove('hide')
  renderedPngImg.classList.add('hide')
  modalLoadingText.classList.remove('hide')
  modalLoadingText.textContent = '正在呼叫 Puppeteer 截图菜单图片... (首次可能耗时较长)'

  try {
    // Call the custom PNG preview API endpoint with bypassCache=true to force a fresh render
    const res = await fetch(`/api/menu/preview/image?bypassCache=true`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) throw new Error('生成截图失败，请确保 Puppeteer 运行正常。')

    const blob = await res.blob()
    const url = URL.createObjectURL(blob)

    renderedPngImg.src = url
    renderedPngImg.classList.remove('hide')
    modalLoadingText.classList.add('hide')
  } catch (err) {
    modalLoadingText.textContent = `生成失败: ${err.message}`
  }
})

// Close Modal logic
closeModalBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    pngModal.classList.add('hide')
    // Clear image URL to release memory
    if (renderedPngImg.src.startsWith('blob:')) {
      URL.revokeObjectURL(renderedPngImg.src)
    }
    renderedPngImg.src = ''
  })
})

// Init
loadMenuConfig()
