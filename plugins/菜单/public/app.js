// WebUI Menu Preview Controller

// Get auth token from parent window
const token = localStorage.getItem('mioki_token') || '';

// Mock info for preview rendering
const mockAvatarUrl = 'https://p.qlogo.cn/gh/10001/10001/100';
const mockNickname = 'Mioki Bot';

// State
let pluginConfig = null;
const PLUGIN_NAME = '菜单';

// DOM Elements
const configForm = document.getElementById('config-form');
const categoriesContainer = document.getElementById('categories-container');
const addCategoryBtn = document.getElementById('add-category-btn');
const resetBtn = document.getElementById('reset-btn');
const previewPngBtn = document.getElementById('preview-png-btn');
const iframe = document.getElementById('html-preview-iframe');

// Modal DOM
const pngModal = document.getElementById('png-modal');
const renderedPngImg = document.getElementById('rendered-png-img');
const modalLoadingText = pngModal.querySelector('.modal-loading-text');
const closeModalBtns = pngModal.querySelectorAll('.close-modal-btn');

// Toast Notification
const toast = document.getElementById('toast');
function showToast(message, type = 'success') {
  const toastMsg = toast.querySelector('.toast-message');
  toastMsg.textContent = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// Check auth & redirect if missing
if (!token) {
  showToast('未登录 WebUI，无法加载配置', 'error');
  // If in iframe, notify parent or show message
}

// ----------------- Core HTML & CSS Render Logic (Cloned from Backend) -----------------
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderHtmlPreview(config, avatarUrl, nickname) {
  const sortedCategories = [...(config.categories || [])].sort(
    (a, b) => (a.order ?? 10) - (b.order ?? 10)
  );

  const categoriesHtml = sortedCategories
    .map((cat) => {
      const name = escapeHtml(cat.name);
      const badge = cat.badge ? `<span class="category-badge">${escapeHtml(cat.badge)}</span>` : '';
      const desc = cat.desc ? `<div class="category-desc">${escapeHtml(cat.desc)}</div>` : '';
      const commandsList = (cat.commands || [])
        .map((cmd) => `<span class="cmd-chip">${escapeHtml(cmd)}</span>`)
        .join('');

      return `
        <div class="category-card" style="grid-column: span ${cat.width || 1};">
          <div class="category-header">
            <h2 class="category-title">${name}</h2>
            ${badge}
          </div>
          ${desc}
          <div class="commands-container">
            ${commandsList}
          </div>
        </div>
      `;
    })
    .join('');

  const totalCommands = sortedCategories.reduce((acc, cat) => acc + (cat.commands?.length || 0), 0);

  let themeCss = '';
  let layoutHtml = '';

  if (config.theme === 'eva-02') {
    themeCss = `
      :root {
        --bg-color: #121318;
        --card-bg: rgba(26, 27, 35, 0.85);
        --text-color: #ffffff;
        --text-muted: #8c8d99;
        --accent-red: #e53935;
        --accent-orange: #ff6d00;
        --accent-yellow: #ffb300;
        --accent-yellow-glow: rgba(255, 179, 0, 0.4);
        --border-color: #ff3d00;
        --chip-bg: rgba(255, 61, 0, 0.05);
        --chip-border: rgba(255, 61, 0, 0.3);
        --chip-text: #ff6d00;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          linear-gradient(rgba(255, 61, 0, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255, 61, 0, 0.03) 1px, transparent 1px);
        background-size: 20px 20px;
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        border: 2px solid var(--border-color);
        padding: 24px;
        background: radial-gradient(circle at top right, rgba(255, 61, 0, 0.05) 0%, transparent 70%);
        position: relative;
        overflow: hidden;
      }
      .menu-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 4px;
        background: repeating-linear-gradient(-45deg, var(--accent-yellow), var(--accent-yellow) 10px, #121318 10px, #121318 20px);
      }
      .header-card {
        background: rgba(26, 27, 35, 0.95);
        border: 1px solid var(--border-color);
        border-top: 4px solid var(--border-color);
        padding: 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        position: relative;
        clip-path: polygon(0 0, 100% 0, 100% calc(100% - 15px), calc(100% - 15px) 100%, 0 100%);
      }
      .header-card::after {
        content: 'SYS STATUS: ACTIVE [EVA-02]';
        position: absolute;
        top: 8px;
        right: 12px;
        font-size: 10px;
        color: var(--accent-yellow);
        font-family: monospace;
        letter-spacing: 1px;
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border: 2px solid var(--border-color);
        padding: 3px;
        background: #121318;
        clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);
        margin-right: 24px;
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        clip-path: polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%);
      }
      .header-info h1 {
        font-size: 26px;
        font-weight: 800;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 0 10px rgba(229, 57, 53, 0.4);
      }
      .header-subtitle {
        font-size: 13px;
        color: var(--accent-yellow);
        font-weight: 700;
        letter-spacing: 1.5px;
        text-transform: uppercase;
        margin-bottom: 8px;
      }
      .header-meta {
        font-size: 12px;
        color: var(--text-muted);
        font-family: monospace;
      }
      .header-meta span {
        color: var(--accent-orange);
        font-weight: bold;
      }
      .category-card {
        background: var(--card-bg);
        border: 1px solid rgba(255, 61, 0, 0.2);
        border-left: 4px solid var(--border-color);
        margin-bottom: 20px;
        padding: 20px;
        clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(255, 61, 0, 0.15);
        padding-bottom: 8px;
      }
      .category-title {
        font-size: 17px;
        font-weight: 700;
        color: var(--text-color);
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .category-badge {
        font-size: 11px;
        font-weight: bold;
        background: var(--border-color);
        color: #fff;
        padding: 2px 8px;
        border-radius: 2px;
        font-family: monospace;
      }
      .category-desc {
        font-size: 13px;
        color: var(--text-muted);
        margin-bottom: 15px;
        line-height: 1.4;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 13px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 5px 12px;
        margin: 4px 6px 4px 0;
        font-weight: 600;
        font-family: monospace;
      }
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: rgba(26, 27, 35, 0.95);
        border: 1px solid var(--border-color);
        margin-top: 24px;
        font-size: 11px;
        font-family: monospace;
        color: var(--text-muted);
        clip-path: polygon(0 10px, 10px 0, 100% 0, 100% 100%, 0 100%);
      }
      .footer-side strong {
        color: var(--accent-yellow);
      }
    `;
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.subtitle || 'TACTICAL ASSISTANT')}</div>
            <h1>${escapeHtml(config.title || nickname)}</h1>
            <div class="header-meta">
              COMMANDS LOADED: <span>${totalCommands}</span> UNITS // SECTORS: <span>${sortedCategories.length}</span> ACTIVE
            </div>
          </div>
        </div>
        <div class="menu-grid">
          ${categoriesHtml}
        </div>
        <div class="footer-card">
          <div class="footer-side">
            FRAMEWORK: <strong>MIOKI // VER 1.0.0</strong>
          </div>
          <div class="footer-side">
            PILOT: <strong>${escapeHtml(nickname)} // STATUS_NORMAL</strong>
          </div>
        </div>
      </div>
    `;
  } else if (config.theme === 'hatsune') {
    themeCss = `
      :root {
        --bg-color: #f0f7f6;
        --card-bg: rgba(255, 255, 255, 0.65);
        --text-color: #1e3a38;
        --text-muted: #5e7c7a;
        --accent-teal: #00c4b4;
        --accent-light: #e0f7f5;
        --border-color: rgba(255, 255, 255, 0.5);
        --chip-bg: rgba(0, 196, 180, 0.08);
        --chip-border: rgba(0, 196, 180, 0.25);
        --chip-text: #00897b;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          radial-gradient(at 0% 0%, rgba(224, 247, 245, 0.8) 0, transparent 50%),
          radial-gradient(at 100% 100%, rgba(227, 242, 253, 0.8) 0, transparent 50%);
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        padding: 30px;
        background: rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 32px;
        box-shadow: 0 20px 50px rgba(0, 196, 180, 0.05);
      }
      .header-card {
        background: var(--card-bg);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border-color);
        padding: 28px;
        margin-bottom: 28px;
        border-radius: 24px;
        display: flex;
        align-items: center;
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.04);
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        padding: 3px;
        background: linear-gradient(135deg, #00c4b4, #00b0ff);
        margin-right: 24px;
        box-shadow: 0 8px 24px rgba(0, 196, 180, 0.2);
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        border: 2px solid #fff;
      }
      .header-info h1 {
        font-size: 28px;
        font-weight: 800;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 0.5px;
      }
      .header-subtitle {
        font-size: 14px;
        color: var(--accent-teal);
        font-weight: 700;
        letter-spacing: 1px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .header-meta {
        font-size: 13px;
        color: var(--text-muted);
      }
      .category-card {
        background: var(--card-bg);
        backdrop-filter: blur(10px);
        border: 1px solid var(--border-color);
        border-radius: 20px;
        margin-bottom: 20px;
        padding: 22px;
        box-shadow: 0 8px 32px 0 rgba(0, 196, 180, 0.02);
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 12px;
      }
      .category-title {
        font-size: 18px;
        font-weight: 700;
        color: var(--text-color);
      }
      .category-badge {
        font-size: 11px;
        font-weight: 600;
        background: var(--accent-light);
        color: var(--chip-text);
        padding: 3px 10px;
        border-radius: 20px;
      }
      .category-desc {
        font-size: 13.5px;
        color: var(--text-muted);
        margin-bottom: 16px;
        line-height: 1.45;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 13px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 6px 14px;
        margin: 5px 6px 5px 0;
        border-radius: 100px;
        font-weight: 500;
      }
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        background: var(--card-bg);
        backdrop-filter: blur(12px);
        border: 1px solid var(--border-color);
        margin-top: 28px;
        font-size: 12px;
        color: var(--text-muted);
        border-radius: 20px;
        box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.04);
      }
      .footer-side strong {
        color: var(--accent-teal);
        font-weight: 700;
      }
    `;
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.title || 'MIOKU ASSISTANT')}</div>
            <h1>${escapeHtml(config.subtitle || nickname)}</h1>
            <div class="header-meta">
              共 ${sortedCategories.length} 个功能分类，包含 ${totalCommands} 个指令
            </div>
          </div>
        </div>
        <div class="menu-grid">
          ${categoriesHtml}
        </div>
        <div class="footer-card">
          <div class="footer-side">
            Framework: <strong>Mioki</strong>
          </div>
          <div class="footer-side">
            Platform: <strong>OneBot v11</strong>
          </div>
        </div>
      </div>
    `;
  } else {
    themeCss = `
      :root {
        --bg-color: #05060b;
        --card-bg: rgba(10, 11, 20, 0.9);
        --text-color: #ffffff;
        --text-muted: #727b93;
        --accent-cyan: #00f3ff;
        --accent-magenta: #ff007f;
        --accent-yellow: #fefe00;
        --border-color: #1e293b;
        --chip-bg: rgba(0, 243, 255, 0.03);
        --chip-border: rgba(0, 243, 255, 0.3);
        --chip-text: #00f3ff;
      }
      body {
        background-color: var(--bg-color);
        background-image: 
          linear-gradient(rgba(0, 243, 255, 0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(0, 243, 255, 0.02) 1px, transparent 1px);
        background-size: 30px 30px;
        font-family: 'Outfit', 'Noto Sans SC', sans-serif;
      }
      .menu-container {
        padding: 24px;
        position: relative;
      }
      .menu-container::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: linear-gradient(90deg, var(--accent-magenta), var(--accent-cyan));
      }
      .header-card {
        background: var(--card-bg);
        border: 2px solid var(--accent-cyan);
        box-shadow: 0 0 15px rgba(0, 243, 255, 0.2);
        padding: 24px;
        margin-bottom: 24px;
        display: flex;
        align-items: center;
        position: relative;
      }
      .header-card::before {
        content: 'NEON HUD V1.0';
        position: absolute;
        top: -10px;
        left: 20px;
        font-size: 9px;
        font-weight: bold;
        background: var(--accent-cyan);
        color: #000;
        padding: 1px 6px;
        font-family: monospace;
      }
      .avatar-wrapper {
        width: 80px;
        height: 80px;
        border: 2px solid var(--accent-magenta);
        box-shadow: 0 0 10px rgba(255, 0, 127, 0.3);
        margin-right: 24px;
        transform: skewX(-5deg);
      }
      .avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .header-info h1 {
        font-size: 30px;
        font-weight: 900;
        color: var(--text-color);
        margin: 0 0 4px 0;
        letter-spacing: 2px;
        text-transform: uppercase;
        text-shadow: 0 0 8px rgba(0, 243, 255, 0.5);
      }
      .header-subtitle {
        font-size: 13px;
        color: var(--accent-yellow);
        font-weight: 700;
        letter-spacing: 2px;
        text-transform: uppercase;
        margin-bottom: 4px;
      }
      .header-meta {
        font-size: 12px;
        color: var(--text-muted);
        font-family: monospace;
      }
      .category-card {
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        border-left: 4px solid var(--accent-cyan);
        margin-bottom: 20px;
        padding: 20px;
        position: relative;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      }
      .category-card::after {
        content: '///';
        position: absolute;
        bottom: 5px;
        right: 10px;
        font-size: 9px;
        color: rgba(0, 243, 255, 0.2);
        font-family: monospace;
      }
      .category-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      .category-title {
        font-size: 17px;
        font-weight: 800;
        color: var(--text-color);
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      .category-badge {
        font-size: 10px;
        font-weight: bold;
        border: 1px solid var(--accent-magenta);
        color: var(--accent-magenta);
        padding: 2px 6px;
        font-family: monospace;
        text-transform: uppercase;
      }
      .category-desc {
        font-size: 13px;
        color: var(--text-muted);
        margin-bottom: 14px;
        line-height: 1.4;
      }
      .cmd-chip {
        display: inline-block;
        font-size: 12.5px;
        background: var(--chip-bg);
        border: 1px solid var(--chip-border);
        color: var(--chip-text);
        padding: 5px 12px;
        margin: 4px 6px 4px 0;
        font-family: monospace;
        text-shadow: 0 0 5px rgba(0, 243, 255, 0.3);
      }
      .footer-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        background: var(--card-bg);
        border: 1px solid var(--border-color);
        margin-top: 24px;
        font-size: 11px;
        font-family: monospace;
        color: var(--text-muted);
      }
      .footer-side strong {
        color: var(--accent-magenta);
      }
    `;
    layoutHtml = `
      <div class="menu-container">
        <div class="header-card">
          <div class="avatar-wrapper">
            <img class="avatar" src="${avatarUrl}" alt="avatar" />
          </div>
          <div class="header-info">
            <div class="header-subtitle">${escapeHtml(config.subtitle || 'CYBER ASSISTANT')}</div>
            <h1>${escapeHtml(config.title || nickname)}</h1>
            <div class="header-meta">
              DB_COMMANDS: ${totalCommands} CELLS // CATEGORIES: ${sortedCategories.length} NODES
            </div>
          </div>
        </div>
        <div class="menu-grid">
          ${categoriesHtml}
        </div>
        <div class="footer-card">
          <div class="footer-side">
            CORE: <strong>MIOKI ENGINE</strong>
          </div>
          <div class="footer-side">
            SYS: <strong>ONLINE</strong>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          margin: 0;
          padding: 20px;
          display: flex;
          justify-content: center;
          align-items: flex-start;
          min-height: 100vh;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        @media (max-width: 780px) {
          .menu-wrapper { width: 100%; }
          .menu-grid { grid-template-columns: 1fr; }
          .category-card { grid-column: span 1 !important; }
        }
        ${themeCss}
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="menu-wrapper">
        ${layoutHtml}
      </div>
    </body>
    </html>
  `;
}

// ----------------- Core Page Controller -----------------

// Live preview renderer
function triggerLivePreview() {
  const currentConfig = collectFormData();
  const htmlContent = renderHtmlPreview(currentConfig, mockAvatarUrl, mockNickname);
  
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(htmlContent);
  doc.close();
}

// Collect data from visual inputs
function collectFormData() {
  const enabled = document.getElementById('field-enabled').checked;
  const command = document.getElementById('field-command').value.trim();
  const title = document.getElementById('field-title').value.trim();
  const subtitle = document.getElementById('field-subtitle').value.trim();
  const theme = document.getElementById('field-theme').value;

  const categoryCards = categoriesContainer.querySelectorAll('.cat-item-card');
  const categories = Array.from(categoryCards).map(card => {
    const name = card.querySelector('.field-cat-name').value.trim();
    const badge = card.querySelector('.field-cat-badge').value.trim();
    const desc = card.querySelector('.field-cat-desc').value.trim();
    const order = Number(card.querySelector('.field-cat-order').value) || 10;
    const width = Number(card.querySelector('.field-cat-width').value) || 1;
    const commandsText = card.querySelector('.field-cat-commands').value.trim();
    const commands = commandsText ? commandsText.split('\n').map(c => c.trim()).filter(Boolean) : [];

    return { name, badge, desc, order, width, commands };
  });

  return {
    enabled,
    command,
    title,
    subtitle,
    theme,
    whitelist: pluginConfig?.whitelist || [],
    categories
  };
}

// Render inputs from config
function renderFormInputs(config) {
  document.getElementById('field-enabled').checked = config.enabled !== false;
  document.getElementById('field-command').value = config.command || '菜单';
  document.getElementById('field-title').value = config.title || '';
  document.getElementById('field-subtitle').value = config.subtitle || '';
  document.getElementById('field-theme').value = config.theme || 'eva-02';

  categoriesContainer.innerHTML = '';
  
  const sorted = [...(config.categories || [])].sort((a, b) => (a.order ?? 10) - (b.order ?? 10));
  sorted.forEach((cat, index) => {
    addCategoryCardDOM(cat, index);
  });

  triggerLivePreview();
}

function addCategoryCardDOM(cat = {}, index = 0) {
  const card = document.createElement('div');
  card.className = 'cat-item-card';
  card.innerHTML = `
    <div class="cat-card-header">
      <span class="cat-card-title">卡片选项卡</span>
      <div class="cat-card-actions">
        <button type="button" class="btn btn-icon btn-sm move-up-btn" title="上移">▲</button>
        <button type="button" class="btn btn-icon btn-sm move-down-btn" title="下移">▼</button>
        <button type="button" class="btn btn-icon btn-sm text-danger remove-cat-btn" title="删除">🗑️</button>
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
        <label>选项卡宽度 (大小)</label>
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
  `;

  categoriesContainer.appendChild(card);

  // Hook input changes to trigger real-time preview
  card.querySelectorAll('input, select, textarea').forEach(el => {
    el.addEventListener('input', triggerLivePreview);
  });

  // Up, Down, Delete buttons
  card.querySelector('.remove-cat-btn').addEventListener('click', () => {
    card.remove();
    triggerLivePreview();
  });

  card.querySelector('.move-up-btn').addEventListener('click', () => {
    const prev = card.previousElementSibling;
    if (prev) {
      categoriesContainer.insertBefore(card, prev);
      // Swap order field values
      const cardOrderInput = card.querySelector('.field-cat-order');
      const prevOrderInput = prev.querySelector('.field-cat-order');
      const temp = cardOrderInput.value;
      cardOrderInput.value = prevOrderInput.value;
      prevOrderInput.value = temp;
      triggerLivePreview();
    }
  });

  card.querySelector('.move-down-btn').addEventListener('click', () => {
    const next = card.nextElementSibling;
    if (next) {
      categoriesContainer.insertBefore(next, card);
      // Swap order field values
      const cardOrderInput = card.querySelector('.field-cat-order');
      const nextOrderInput = next.querySelector('.field-cat-order');
      const temp = cardOrderInput.value;
      cardOrderInput.value = nextOrderInput.value;
      nextOrderInput.value = temp;
      triggerLivePreview();
    }
  });
}

// ----------------- Fetch / Save API Integration -----------------

async function loadMenuConfig() {
  try {
    const res = await fetch('/api/plugins', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('获取插件列表失败');
    
    const plugins = await res.json();
    const menuPlugin = plugins.find(p => p.name === PLUGIN_NAME);
    if (!menuPlugin || !menuPlugin.config) throw new Error('未找到菜单插件的配置');
    
    pluginConfig = menuPlugin.config;
    renderFormInputs(pluginConfig);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save config to backend
configForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = '正在保存并热重载...';

  try {
    const updatedConfig = collectFormData();
    
    // Save via core WebUI API
    const res = await fetch(`/api/plugins/${PLUGIN_NAME}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ config: updatedConfig })
    });

    if (res.ok) {
      showToast('配置保存并热重载成功！');
      pluginConfig = updatedConfig;
    } else {
      const data = await res.json();
      showToast(`保存失败: ${data.error || '未知错误'}`, 'error');
    }
  } catch (err) {
    showToast('网络请求失败，请检查服务器连接', 'error');
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '保存并重载配置';
  }
});

// Reset changes
resetBtn.addEventListener('click', () => {
  if (pluginConfig) {
    renderFormInputs(pluginConfig);
    showToast('已重置回上次保存的配置');
  }
});

// Add new category card
addCategoryBtn.addEventListener('click', () => {
  const cards = categoriesContainer.querySelectorAll('.cat-item-card');
  const nextOrder = (cards.length + 1) * 10;
  addCategoryCardDOM({ name: '', badge: '', desc: '', order: nextOrder, width: 1, commands: [] }, cards.length);
  triggerLivePreview();
});

// Trigger live preview when global fields change
document.querySelectorAll('#field-enabled, #field-command, #field-title, #field-subtitle, #field-theme').forEach(el => {
  el.addEventListener('input', triggerLivePreview);
});

// ----------------- PNG Screenshot Modal Integration -----------------
previewPngBtn.addEventListener('click', async () => {
  // Show Modal
  pngModal.classList.remove('hide');
  renderedPngImg.classList.add('hide');
  modalLoadingText.classList.remove('hide');
  modalLoadingText.textContent = '正在呼叫 Puppeteer 截图菜单图片... (首次可能耗时较长)';

  try {
    // Call the custom PNG preview API endpoint with bypassCache=true to force a fresh render
    const res = await fetch(`/api/menu/preview/image?bypassCache=true`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) throw new Error('生成截图失败，请确保 Puppeteer 运行正常。');
    
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    
    renderedPngImg.src = url;
    renderedPngImg.classList.remove('hide');
    modalLoadingText.classList.add('hide');
  } catch (err) {
    modalLoadingText.textContent = `生成失败: ${err.message}`;
  }
});

// Close Modal logic
closeModalBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    pngModal.classList.add('hide');
    // Clear image URL to release memory
    if (renderedPngImg.src.startsWith('blob:')) {
      URL.revokeObjectURL(renderedPngImg.src);
    }
    renderedPngImg.src = '';
  });
});

// Init
loadMenuConfig();
