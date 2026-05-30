// Whitelist Manager State Management
const token = localStorage.getItem('mioki_token') || ''
let groupsList = []
let configsList = []
let activeConfig = null // { pluginName, key, title, description, type, value: [] }
let draftCheckedIds = new Set() // Set of group IDs currently checked in draft

// DOM Elements
const pluginList = document.getElementById('plugin-list')
const welcomeView = document.getElementById('welcome-view')
const configView = document.getElementById('config-view')
const selectedTitle = document.getElementById('selected-title')
const selectedDesc = document.getElementById('selected-desc')
const fieldTypeBadge = document.getElementById('field-type-badge')
const searchInput = document.getElementById('search-input')
const groupsGrid = document.getElementById('groups-grid')
const checkedCountSpan = document.getElementById('checked-count')
const selectedSummaryCount = document.getElementById('selected-summary-count')
const selectAllBtn = document.getElementById('select-all-btn')
const clearAllBtn = document.getElementById('clear-all-btn')
const resetBtn = document.getElementById('reset-btn')
const saveBtn = document.getElementById('save-btn')
const toast = document.getElementById('toast')

let currentFilter = 'all' // 'all', 'checked', 'unchecked'

// Helper: Show Toast
function showToast(message, type = 'success') {
  const toastMsg = toast.querySelector('.toast-message')
  toastMsg.textContent = message
  toast.className = `toast show ${type}`
  setTimeout(() => {
    toast.classList.remove('show')
  }, 4000)
}

// Check authorization and fetch initial data
async function init() {
  if (!token) {
    showToast('未登录，请在主页面登录后访问！', 'error')
    return
  }
  
  try {
    // 1. Fetch bots' group list
    const groupsRes = await fetch('/api/bots/groups', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    
    if (groupsRes.ok) {
      groupsList = await groupsRes.json()
    } else {
      showToast('获取群聊列表失败', 'error')
      return
    }

    // 2. Fetch plugins whitelist configurations
    await loadConfigs()

  } catch (err) {
    console.error(err)
    showToast('连接服务器出错', 'error')
  }
}

// Load / Reload config lists
async function loadConfigs() {
  try {
    const configsRes = await fetch('/api/whitelist/configs', {
      headers: { 'Authorization': `Bearer ${token}` }
    })

    if (configsRes.ok) {
      configsList = await configsRes.json()
      renderPluginList()
      
      // If there's an active selected config, restore its draft state
      if (activeConfig) {
        // Find the refreshed config item
        const updatedPlugin = configsList.find(p => p.name === activeConfig.pluginName)
        if (updatedPlugin) {
          const updatedField = updatedPlugin.fields.find(f => f.key === activeConfig.key)
          if (updatedField) {
            selectField(activeConfig.pluginName, updatedField)
            return
          }
        }
        // If not found anymore, hide editor
        activeConfig = null
        configView.classList.add('hide')
        welcomeView.classList.remove('hide')
      }
    } else {
      showToast('获取插件配置列表失败', 'error')
    }
  } catch (err) {
    showToast('刷新配置列表失败', 'error')
  }
}

// Render the sidebar plugin list
function renderPluginList() {
  pluginList.innerHTML = ''
  
  if (configsList.length === 0) {
    pluginList.innerHTML = '<li class="loading-state">暂无包含黑白名单的插件</li>'
    return
  }
  
  configsList.forEach(plugin => {
    const li = document.createElement('li')
    li.className = 'plugin-item'
    if (activeConfig && activeConfig.pluginName === plugin.name) {
      li.classList.add('active')
    }
    
    let fieldsHtml = ''
    plugin.fields.forEach(field => {
      const isBlack = field.type === 'blacklist'
      const isActive = activeConfig && activeConfig.pluginName === plugin.name && activeConfig.key === field.key
      fieldsHtml += `
        <div class="field-item ${isActive ? 'active' : ''}" data-field-key="${field.key}">
          <span class="field-badge ${field.type}">${isBlack ? '黑' : '白'}</span>
          <span>${field.title}</span>
        </div>
      `
    })

    li.innerHTML = `
      <div class="plugin-name">${plugin.name}</div>
      <div class="plugin-fields">${fieldsHtml}</div>
    `
    
    // Bind click to field selection
    li.querySelectorAll('.field-item').forEach((item, index) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        // Clear active classes
        document.querySelectorAll('.plugin-item').forEach(el => el.classList.remove('active'))
        document.querySelectorAll('.field-item').forEach(el => el.classList.remove('active'))
        
        li.classList.add('active')
        item.classList.add('active')
        
        selectField(plugin.name, plugin.fields[index])
      })
    })

    pluginList.appendChild(li)
  })
}

// Select a field to configure
function selectField(pluginName, field) {
  activeConfig = {
    pluginName,
    key: field.key,
    title: field.title,
    description: field.description,
    type: field.type,
    value: field.value
  }

  // Update UI headers
  selectedTitle.textContent = `${pluginName} ➔ ${field.title}`
  selectedDesc.textContent = field.description || `管理插件 ${pluginName} 的群 ${field.type === 'blacklist' ? '黑名单' : '白名单'}`
  
  const isBlack = field.type === 'blacklist'
  fieldTypeBadge.className = `badge ${isBlack ? 'blacklist' : ''}`
  fieldTypeBadge.textContent = isBlack ? '黑名单模式' : '白名单模式'

  // Load current value values into draft set
  draftCheckedIds = new Set(field.value)

  welcomeView.classList.add('hide')
  configView.classList.remove('hide')

  // Clear filters
  searchInput.value = ''
  currentFilter = 'all'
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'))
  document.querySelector('.filter-btn[data-filter="all"]').classList.add('active')

  // Render
  renderGroupsGrid()
}

// Render the cards grid of groups
function renderGroupsGrid() {
  groupsGrid.innerHTML = ''
  
  const query = searchInput.value.trim().toLowerCase()
  const isBlacklist = activeConfig.type === 'blacklist'

  // Filter groups
  let filtered = groupsList.filter(g => {
    // 1. Search Query filter
    const matchesQuery = String(g.group_id).includes(query) || g.group_name.toLowerCase().includes(query)
    if (!matchesQuery) return false

    // 2. Tab filter
    const isChecked = draftCheckedIds.has(g.group_id)
    if (currentFilter === 'checked') return isChecked
    if (currentFilter === 'unchecked') return !isChecked
    
    return true
  })

  // Update counts
  checkedCountSpan.textContent = draftCheckedIds.size
  selectedSummaryCount.textContent = draftCheckedIds.size

  if (filtered.length === 0) {
    groupsGrid.innerHTML = `
      <div style="grid-column: span 12; text-align: center; color: var(--text-muted); padding: 3rem 0;">
        没有找到符合条件的群聊
      </div>
    `
    return
  }

  filtered.forEach(g => {
    const isChecked = draftCheckedIds.has(g.group_id)
    const card = document.createElement('div')
    card.className = `group-card card ${isChecked ? 'checked' : ''} ${isBlacklist ? 'is-blacklist' : ''}`
    card.setAttribute('data-id', g.group_id)
    
    // Group avatar URL
    const avatarUrl = `https://p.qlogo.cn/gh/${g.group_id}/${g.group_id}/100`

    card.innerHTML = `
      <div class="avatar-container">
        <img class="group-avatar" src="${avatarUrl}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2244%22 height=%2244%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%239ca3af%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22><path d=%22M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2%22></path><circle cx=%229%22 cy=%227%22 r=%224%22></circle><path d=%22M23 21v-2a4 4 0 0 0-3-3.87%22></path><path d=%22M16 3.13a4 4 0 0 1 0 7.75%22></path></svg>';" />
        <span class="bot-tag" title="绑定的机器人QQ">${g.bot_id}</span>
      </div>
      <div class="group-info">
        <div class="group-name" title="${g.group_name}">${g.group_name}</div>
        <div class="group-id">${g.group_id}</div>
      </div>
      <div class="card-switch">
        <label class="switch">
          <input type="checkbox" ${isChecked ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
    `

    // Card toggle logic
    const checkbox = card.querySelector('input')
    const toggleFunc = () => {
      const state = !draftCheckedIds.has(g.group_id)
      if (state) {
        draftCheckedIds.add(g.group_id)
        card.classList.add('checked')
        checkbox.checked = true
      } else {
        draftCheckedIds.delete(g.group_id)
        card.classList.remove('checked')
        checkbox.checked = false
      }
      checkedCountSpan.textContent = draftCheckedIds.size
      selectedSummaryCount.textContent = draftCheckedIds.size
    }

    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'INPUT') {
        toggleFunc()
      }
    })
    
    checkbox.addEventListener('change', () => {
      // sync with card click state
      const state = checkbox.checked
      if (state) {
        draftCheckedIds.add(g.group_id)
        card.classList.add('checked')
      } else {
        draftCheckedIds.delete(g.group_id)
        card.classList.remove('checked')
      }
      checkedCountSpan.textContent = draftCheckedIds.size
      selectedSummaryCount.textContent = draftCheckedIds.size
    })

    groupsGrid.appendChild(card)
  })
}

// Bulk action: Select All visible groups in grid
selectAllBtn.addEventListener('click', () => {
  const query = searchInput.value.trim().toLowerCase()
  groupsList.forEach(g => {
    const matchesQuery = String(g.group_id).includes(query) || g.group_name.toLowerCase().includes(query)
    if (matchesQuery) {
      draftCheckedIds.add(g.group_id)
    }
  })
  renderGroupsGrid()
  showToast('已选中所有过滤出的群聊')
})

// Bulk action: Clear All visible groups in grid
clearAllBtn.addEventListener('click', () => {
  const query = searchInput.value.trim().toLowerCase()
  groupsList.forEach(g => {
    const matchesQuery = String(g.group_id).includes(query) || g.group_name.toLowerCase().includes(query)
    if (matchesQuery) {
      draftCheckedIds.delete(g.group_id)
    }
  })
  renderGroupsGrid()
  showToast('已清空所有过滤出的群聊')
})

// Search input handler
searchInput.addEventListener('input', () => {
  renderGroupsGrid()
})

// Filter tab handler
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'))
    btn.classList.add('active')
    currentFilter = btn.getAttribute('data-filter')
    renderGroupsGrid()
  })
})

// Reset button handler
resetBtn.addEventListener('click', () => {
  if (activeConfig) {
    draftCheckedIds = new Set(activeConfig.value)
    renderGroupsGrid()
    showToast('已重置回保存时的状态')
  }
})

// Save configurations handler
saveBtn.addEventListener('click', async () => {
  if (!activeConfig) return
  
  saveBtn.disabled = true
  saveBtn.textContent = '正在保存并重载...'

  const newValue = Array.from(draftCheckedIds)

  try {
    const res = await fetch('/api/whitelist/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        pluginName: activeConfig.pluginName,
        key: activeConfig.key,
        value: newValue
      })
    })

    if (res.ok) {
      showToast(`插件 ${activeConfig.pluginName} 的黑白名单已保存并重载成功！`)
      // Reload everything to get updated settings
      await loadConfigs()
    } else {
      const err = await res.json()
      showToast(`保存失败: ${err.error || '未知错误'}`, 'error')
    }
  } catch (err) {
    showToast('网络保存请求失败，请检查服务器连接', 'error')
  } finally {
    saveBtn.disabled = false
    saveBtn.textContent = '保存修改并热重载'
  }
})

// Run initializer
init()
