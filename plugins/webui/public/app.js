// State Management
let currentToken = localStorage.getItem('mioki_token') || ''
let pluginsList = []
let activePlugin = null

// DOM Elements
const loginContainer = document.getElementById('login-container')
const appContainer = document.getElementById('app-container')
const loginForm = document.getElementById('login-form')
const tokenInput = document.getElementById('token-input')
const loginError = document.getElementById('login-error')
const logoutBtn = document.getElementById('logout-btn')
const pluginList = document.getElementById('plugin-list')
const selectedPluginTitle = document.getElementById('selected-plugin-title')
const selectedPluginDesc = document.getElementById('selected-plugin-desc')
const pluginStatusBadge = document.getElementById('plugin-status-badge')
const welcomeView = document.getElementById('welcome-view')
const editorView = document.getElementById('editor-view')
const configForm = document.getElementById('config-form')
const formFields = document.getElementById('form-fields')
const resetBtn = document.getElementById('reset-btn')
const toast = document.getElementById('toast')

// Helper: Show Toast Message
function showToast(message, type = 'success') {
  const toastMsg = toast.querySelector('.toast-message')
  toastMsg.textContent = message
  
  toast.className = `toast show ${type}`
  
  setTimeout(() => {
    toast.classList.remove('show')
  }, 4000)
}

// Helper: Deep set object values (dot notation)
function setDeepValue(obj, path, value) {
  const keys = path.split('.')
  let current = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
}

// Helper: Deep get object values (dot notation)
function getDeepValue(obj, path) {
  if (!obj) return undefined
  const keys = path.split('.')
  let current = obj
  for (const key of keys) {
    if (current === null || current === undefined) return undefined
    current = current[key]
  }
  return current
}

// Authentication Check
async function checkAuth() {
  if (!currentToken) {
    showLogin()
    return
  }
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: currentToken })
    })
    
    if (res.ok) {
      showApp()
    } else {
      localStorage.removeItem('mioki_token')
      currentToken = ''
      showLogin()
    }
  } catch (err) {
    console.error('Auth verification failed:', err)
    showLogin()
  }
}

function showLogin() {
  loginContainer.classList.remove('hide')
  appContainer.classList.add('hide')
}

function showApp() {
  loginContainer.classList.add('hide')
  appContainer.classList.remove('hide')
  loadPlugins()
}

// Login Submit Handler
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  const token = tokenInput.value.trim()
  if (!token) return
  
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    })
    
    if (res.ok) {
      const data = await res.json()
      currentToken = data.token
      localStorage.setItem('mioki_token', currentToken)
      loginError.classList.add('hide')
      showApp()
      showToast('登录成功，欢迎访问 Mioki 面板！')
    } else {
      loginError.textContent = 'Token 错误，请重新输入'
      loginError.classList.remove('hide')
    }
  } catch (err) {
    loginError.textContent = '服务器连接失败，请稍后重试'
    loginError.classList.remove('hide')
  }
})

// Logout Handler
logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('mioki_token')
  currentToken = ''
  window.location.reload()
})

// Fetch plugins data from Server
async function loadPlugins() {
  try {
    const res = await fetch('/api/plugins', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    })
    
    if (res.ok) {
      pluginsList = await res.json()
      renderPluginList()
      // If we have an active plugin selected, re-render its editor to reflect updated config
      if (activePlugin) {
        const updated = pluginsList.find(p => p.name === activePlugin.name)
        if (updated) {
          selectPlugin(updated)
        }
      }
    } else if (res.status === 401) {
      localStorage.removeItem('mioki_token')
      currentToken = ''
      showLogin()
    } else {
      showToast('获取插件列表失败', 'error')
    }
  } catch (err) {
    showToast('网络请求失败，请检查服务器状态', 'error')
  }
}

// Render plugins in Sidebar
function renderPluginList() {
  pluginList.innerHTML = ''
  
  pluginsList.forEach(plugin => {
    const li = document.createElement('li')
    li.className = `menu-item ${activePlugin && activePlugin.name === plugin.name ? 'active' : ''}`
    
    li.innerHTML = `
      <div class="menu-item-info">
        <div class="status-dot ${plugin.isEnabled ? 'active' : ''}"></div>
        <span>${plugin.name}</span>
      </div>
      <span class="badge-small">${plugin.hasConfig ? '已配置' : '无配置'}</span>
    `
    
    li.addEventListener('click', () => {
      selectPlugin(plugin)
      // Highlight in UI
      document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'))
      li.classList.add('active')
    })
    
    pluginList.appendChild(li)
  })
}

// Select plugin and render config form
function selectPlugin(plugin) {
  activePlugin = plugin
  
  selectedPluginTitle.textContent = `${plugin.name}`
  selectedPluginDesc.textContent = plugin.schema?.description || `管理插件 ${plugin.name} 的运行配置`
  
  pluginStatusBadge.className = `badge ${plugin.isEnabled ? '' : 'disabled'}`
  pluginStatusBadge.textContent = plugin.isEnabled ? '已启用' : '未启用'
  pluginStatusBadge.classList.remove('hide')
  
  welcomeView.classList.add('hide')
  editorView.classList.remove('hide')
  
  // Clear and render new form
  formFields.innerHTML = ''
  
  if (plugin.schema && plugin.schema.properties) {
    renderForm(plugin.schema, plugin.config || {}, formFields)
  } else {
    formFields.innerHTML = `
      <div class="card" style="padding: 2rem; text-align: center; color: var(--text-muted); grid-column: span 2;">
        该插件无需配置或未提供配置接口
      </div>
    `
  }
}

// Render dynamic form based on Schema recursively
function renderForm(schema, config, container, prefixPath = '') {
  const properties = schema.properties
  
  for (const [key, prop] of Object.entries(properties)) {
    const dataPath = prefixPath ? `${prefixPath}.${key}` : key
    const fieldId = `field-${dataPath.replace(/\./g, '-')}`
    const currentValue = getDeepValue(config, dataPath) ?? prop.default
    
    const wrapper = document.createElement('div')
    
    if (prop.type === 'boolean') {
      wrapper.className = 'toggle-group'
      wrapper.innerHTML = `
        <div class="toggle-info">
          <span class="toggle-title">${prop.title || key}</span>
          ${prop.description ? `<span class="description">${prop.description}</span>` : ''}
        </div>
        <label class="switch">
          <input type="checkbox" id="${fieldId}" data-path="${dataPath}" ${currentValue === true ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      `
      container.appendChild(wrapper)
    } 
    else if (prop.type === 'object') {
      wrapper.className = 'nested-object-card'
      wrapper.innerHTML = `
        <div class="nested-object-title">${prop.title || key}</div>
        ${prop.description ? `<p class="description" style="margin-bottom: 1rem;">${prop.description}</p>` : ''}
        <div id="container-${fieldId}" class="form-grid"></div>
      `
      container.appendChild(wrapper)
      
      const nestedContainer = wrapper.querySelector(`#container-${fieldId}`)
      renderForm(prop, config, nestedContainer, dataPath)
    } 
    else if (prop.type === 'array') {
      wrapper.className = 'form-group'
      
      // Determine array items type (default to string)
      const itemType = prop.items?.type || 'string'
      
      wrapper.innerHTML = `
        <label for="${fieldId}">${prop.title || key} (${itemType === 'integer' || itemType === 'number' ? '数字列表，每行一个' : '文本列表，每行一个'})</label>
        <textarea id="${fieldId}" data-path="${dataPath}" placeholder="${prop.description || ''}" rows="5">${Array.isArray(currentValue) ? currentValue.join('\n') : ''}</textarea>
        ${prop.description ? `<div class="description">${prop.description}</div>` : ''}
      `
      container.appendChild(wrapper)
    } 
    else if (prop.type === 'integer' || prop.type === 'number') {
      wrapper.className = 'form-group'
      wrapper.innerHTML = `
        <label for="${fieldId}">${prop.title || key}</label>
        <input type="number" id="${fieldId}" data-path="${dataPath}" value="${currentValue !== undefined ? currentValue : ''}" step="${prop.type === 'integer' ? '1' : 'any'}" placeholder="${prop.description || ''}">
        ${prop.description ? `<div class="description">${prop.description}</div>` : ''}
      `
      container.appendChild(wrapper)
    } 
    else {
      // String input
      wrapper.className = 'form-group'
      
      // Auto-detect if password input should be used
      const isSecret = key.toLowerCase().includes('key') || 
                       key.toLowerCase().includes('token') || 
                       key.toLowerCase().includes('secret') || 
                       key.toLowerCase().includes('password') || 
                       prop.format === 'password'
                       
      wrapper.innerHTML = `
        <label for="${fieldId}">${prop.title || key}</label>
        <input type="${isSecret ? 'password' : 'text'}" id="${fieldId}" data-path="${dataPath}" value="${currentValue !== undefined ? currentValue : ''}" placeholder="${prop.description || ''}">
        ${prop.description ? `<div class="description">${prop.description}</div>` : ''}
      `
      container.appendChild(wrapper)
    }
  }
}

// Reset changes back to last loaded config
resetBtn.addEventListener('click', () => {
  if (activePlugin) {
    selectPlugin(activePlugin)
    showToast('表单内容已重置')
  }
})

// Collect and Submit config data
configForm.addEventListener('submit', async (e) => {
  e.preventDefault()
  if (!activePlugin) return
  
  const saveBtn = document.getElementById('save-btn')
  saveBtn.disabled = true
  saveBtn.querySelector('span').textContent = '正在保存并重载...'
  
  try {
    const configData = {}
    const inputs = formFields.querySelectorAll('[data-path]')
    
    inputs.forEach(input => {
      const path = input.getAttribute('data-path')
      let val
      
      if (input.type === 'checkbox') {
        val = input.checked
      } else if (input.type === 'number') {
        val = input.value === '' ? undefined : Number(input.value)
      } else if (input.tagName.toLowerCase() === 'textarea') {
        const text = input.value.trim()
        if (text === '') {
          val = []
        } else {
          val = text.split('\n').map(line => {
            const trimmed = line.trim()
            // Try to find the item schema to determine if it should be numbers
            // Since we parsed path, let's trace schema.properties.someArray.items.type
            // Or simple type detection is safe: if it matches integer regex and array items are supposed to be numbers
            if (/^\d+$/.test(trimmed)) {
              return Number(trimmed)
            }
            return trimmed
          })
        }
      } else {
        val = input.value
      }
      
      if (val !== undefined) {
        setDeepValue(configData, path, val)
      }
    })
    
    const res = await fetch(`/api/plugins/${activePlugin.name}/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ config: configData })
    })
    
    if (res.ok) {
      showToast(`插件 ${activePlugin.name} 配置已保存，并已成功热重载生效！`)
      await loadPlugins()
    } else {
      const errData = await res.json()
      showToast(`保存失败: ${errData.error || '未知错误'}`, 'error')
    }
  } catch (err) {
    showToast('网络保存失败，请检查服务器连接', 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.querySelector('span').textContent = '保存并重载插件'
  }
})

// Initialize
checkAuth()
