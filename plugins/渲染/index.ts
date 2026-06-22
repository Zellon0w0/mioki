import { definePlugin, getAbsPluginDir } from 'mioki'
import puppeteer, { Browser } from 'puppeteer-core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PLUGIN_NAME = '渲染'
const PLUGIN_VERSION = '1.0.0'

interface PluginConfig {
  enabled: boolean
  defaultMode: 'auto' | 'markdown' | 'editor'
  defaultTheme: 'vscode-dark' | 'vscode-light' | 'one-dark' | 'dracula' | 'github-light' | 'nord' | 'monokai'
  whitelist: number[]
  keywords: string[]
}

let browser: Browser | null = null
let browserLaunchPromise: Promise<Browser> | null = null

function getChromeCandidates(): string[] {
  const localAppData = process.env.LOCALAPPDATA
  const programFiles = process.env.PROGRAMFILES
  const programFilesX86 = process.env['PROGRAMFILES(X86)']

  return [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    programFiles ? join(programFiles, 'Google/Chrome/Application/chrome.exe') : '',
    programFilesX86 ? join(programFilesX86, 'Google/Chrome/Application/chrome.exe') : '',
    localAppData ? join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
  ].filter((candidate): candidate is string => Boolean(candidate))
}

function findChromeExecutable(): string {
  const executablePath = getChromeCandidates().find((candidate) => existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH')
  }
  return executablePath
}

async function getBrowser(): Promise<Browser> {
  if (browser && browser.connected) {
    return browser
  }
  browser = null

  if (!browserLaunchPromise) {
    browserLaunchPromise = puppeteer.launch({
      executablePath: findChromeExecutable(),
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--font-render-hinting=none',
      ],
      defaultViewport: {
        width: 850,
        height: 1000,
        deviceScaleFactor: 2,
      },
    }).then(b => {
      browser = b
      browserLaunchPromise = null
      b.on('disconnected', () => {
        if (browser === b) {
          browser = null
        }
      })
      return b
    }).catch(err => {
      browserLaunchPromise = null
      throw err
    })
  }
  return browserLaunchPromise
}

function renderHtml(text: string, mode: 'markdown' | 'editor', lang: string, theme: string): string {
  // Safe base64 encoding to prevent injection/escaping syntax bugs
  const base64Text = Buffer.from(encodeURIComponent(text)).toString('base64')

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <style>
    /* LXGW WenKai Screen (霞鹜文楷屏幕版) font loading */
    @import url('https://fastly.jsdelivr.net/npm/lxgw-wenkai-screen-webfont@1.7.0/style.css');

    :root {
      --font-editor: 'LXGW WenKai Screen', 'LXGW WenKai', 'Consolas', 'Courier New', monospace;
      --font-sans: 'LXGW WenKai Screen', 'LXGW WenKai', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      margin: 0;
      padding: 40px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: var(--bg-gradient);
      font-family: var(--font-sans);
      color: var(--editor-text);
    }

    /* Container holding the editor mock */
    .container {
      width: 800px;
      background: var(--editor-bg);
      border-radius: 12px;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow);
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    /* Window Title Bar */
    .title-bar {
      height: 44px;
      background: var(--title-bg);
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid var(--border-color);
      position: relative;
    }

    .window-controls {
      display: flex;
      gap: 8px;
    }

    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }
    .dot-close { background: #ff5f56; }
    .dot-minimize { background: #ffbd2e; }
    .dot-maximize { background: #27c93f; }

    .window-title {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      font-size: 13px;
      color: var(--title-text);
      font-weight: 500;
      letter-spacing: 0.5px;
    }

    .window-lang {
      margin-left: auto;
      font-size: 11px;
      color: var(--title-text);
      opacity: 0.7;
      text-transform: uppercase;
      font-weight: bold;
    }

    /* Content Area */
    .content-area {
      padding: 24px;
      font-size: 15px;
      line-height: 1.6;
      background: var(--editor-bg);
    }

    /* Code Editor Specific Styles */
    .editor-wrapper {
      position: relative;
      font-family: var(--font-editor);
    }

    /* Custom adjustments for PrismJS line numbers */
    pre.line-numbers {
      padding-left: 3.8em !important;
      position: relative;
      margin: 0 !important;
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;
    }

    pre.line-numbers code {
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;
      display: block;
    }

    .line-numbers-rows {
      border-right: 1px solid var(--border-color) !important;
      padding-right: 10px !important;
    }

    .line-numbers-rows > span:before {
      color: var(--gutter-text) !important;
    }

    /* Markdown Rich Text Styles */
    .markdown-body {
      font-family: var(--font-sans);
    }

    .markdown-body h1, .markdown-body h2, .markdown-body h3, 
    .markdown-body h4, .markdown-body h5, .markdown-body h6 {
      margin-top: 24px;
      margin-bottom: 16px;
      font-weight: 600;
      line-height: 1.25;
      color: var(--editor-text);
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 6px;
    }
    
    .theme-github-light .markdown-body h1,
    .theme-github-light .markdown-body h2,
    .theme-github-light .markdown-body h3,
    .theme-github-light .markdown-body h4 {
      border-bottom: 1px solid #d0d7de;
      color: #24292f;
    }

    .markdown-body h1 { font-size: 1.8em; }
    .markdown-body h2 { font-size: 1.4em; }
    .markdown-body h3 { font-size: 1.2em; }

    .markdown-body p, .markdown-body ul, .markdown-body ol {
      margin-top: 0;
      margin-bottom: 16px;
    }

    .markdown-body ul, .markdown-body ol {
      padding-left: 2em;
    }

    .markdown-body li {
      margin-top: 0.25em;
    }

    .markdown-body blockquote {
      padding: 0 1em;
      color: var(--gutter-text);
      border-left: 0.25em solid var(--border-color);
      margin-bottom: 16px;
      opacity: 0.85;
    }

    .markdown-body code {
      padding: 0.2em 0.4em;
      margin: 0;
      font-size: 85%;
      background-color: rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      font-family: var(--font-editor);
    }
    
    .theme-github-light .markdown-body code {
      background-color: rgba(0, 0, 0, 0.05);
      color: #24292f;
    }

    .markdown-body pre {
      padding: 16px;
      overflow: auto;
      font-size: 85%;
      line-height: 1.45;
      background-color: rgba(0, 0, 0, 0.2) !important;
      border-radius: 6px;
      margin-bottom: 16px;
      border: 1px solid var(--border-color);
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;
    }
    
    .theme-github-light .markdown-body pre {
      background-color: #f6f8fa !important;
    }

    .markdown-body pre code {
      padding: 0;
      background-color: transparent;
      border: none;
      font-size: 100%;
      border-radius: 0;
    }

    .markdown-body table {
      border-spacing: 0;
      border-collapse: collapse;
      margin-bottom: 16px;
      width: 100%;
      overflow: auto;
    }

    .markdown-body table th, .markdown-body table td {
      padding: 6px 13px;
      border: 1px solid var(--border-color);
    }

    .markdown-body table tr {
      background-color: transparent;
      border-top: 1px solid var(--border-color);
    }

    .markdown-body table tr:nth-child(2n) {
      background-color: rgba(255, 255, 255, 0.02);
    }
    
    .theme-github-light .markdown-body table tr:nth-child(2n) {
      background-color: #f6f8fa;
    }

    /* Style overrides for Prism line numbers inside Markdown code blocks */
    .markdown-body pre.line-numbers {
      padding-left: 3.8em !important;
      background-color: rgba(0, 0, 0, 0.2) !important;
      white-space: pre-wrap !important;
      word-wrap: break-word !important;
      word-break: break-all !important;
    }
    
    .theme-github-light .markdown-body pre.line-numbers {
      background-color: #f6f8fa !important;
    }

    /* Custom Scrollbar */
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
    }
    .theme-github-light ::-webkit-scrollbar-thumb {
      background: rgba(0, 0, 0, 0.1);
    }
  </style>

  <!-- Theme CSS Variable Definitions -->
  <style id="theme-vars"></style>
</head>
<body class="theme-placeholder">
  <div class="container">
    <div class="title-bar">
      <div class="window-controls">
        <div class="dot dot-close"></div>
        <div class="dot dot-minimize"></div>
        <div class="dot dot-maximize"></div>
      </div>
      <div class="window-title" id="window-title-text">render.md</div>
      <div class="window-lang" id="window-lang-text">TEXT</div>
    </div>
    <div class="content-area" id="content-parent">
      <!-- Content injected dynamically -->
    </div>
  </div>

  <!-- Markdown-It & PrismJS CDN with preloaded common languages -->
  <script src="https://fastly.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-core.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markup.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-css.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-clike.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-c.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-cpp.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-java.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-go.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-rust.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-yaml.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/prism-markdown.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/plugins/autoloader/prism-autoloader.min.js"></script>
  <script src="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.js"></script>
  <link rel="stylesheet" href="https://fastly.jsdelivr.net/npm/prismjs@1.29.0/plugins/line-numbers/prism-line-numbers.min.css">

  <script>
    // Configure Prism Autoloader CDN Path
    Prism.plugins.autoloader.languages_path = 'https://fastly.jsdelivr.net/npm/prismjs@1.29.0/components/';

    // Render configuration passed from node
    window.renderConfig = {
      base64Text: "${base64Text}",
      mode: "${mode}",
      lang: "${lang}",
      theme: "${theme}"
    };

    // Safe Decoding
    var text = decodeURIComponent(atob(window.renderConfig.base64Text));

    // Theme definitions (Tailored harmonious color palettes)
    var themeCSS = {
      'vscode-dark': 'body { --bg-gradient: linear-gradient(135deg, #1e1e1e 0%, #111111 100%); --editor-bg: #1e1e1e; --title-bg: #252526; --title-text: #cccccc; --gutter-bg: #1e1e1e; --gutter-text: #858585; --editor-text: #d4d4d4; --border-color: #2d2d2d; --shadow: 0 20px 40px rgba(0, 0, 0, 0.5); } .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #6a9955 !important; font-style: italic; } .token.punctuation { color: #d4d4d4 !important; } .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #b5cea8 !important; } .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #ce9178 !important; } .token.operator, .token.entity, .token.url { color: #d4d4d4 !important; } .token.atrule, .token.attr-value, .token.keyword { color: #c586c0 !important; } .token.keyword { color: #569cd6 !important; } .token.keyword.control-flow, .token.keyword.return, .token.keyword.if, .token.keyword.for, .token.keyword.while, .token.keyword.import, .token.keyword.from { color: #c586c0 !important; } .token.function, .token.class-name { color: #dcdcaa !important; } .token.regex, .token.important, .token.variable { color: #9cdcfe !important; }',
      'vscode-light': 'body { --bg-gradient: linear-gradient(135deg, #f3f3f3 0%, #e4e4e4 100%); --editor-bg: #ffffff; --title-bg: #f3f3f3; --title-text: #333333; --gutter-bg: #ffffff; --gutter-text: #a6a6a6; --editor-text: #333333; --border-color: #e4e4e4; --shadow: 0 20px 40px rgba(0, 0, 0, 0.08); } .token.comment, .token.prolog, .token.doctype, .token.cdata { color: #008000 !important; font-style: italic; } .token.punctuation { color: #333333 !important; } .token.property, .token.tag, .token.boolean, .token.number, .token.constant, .token.symbol, .token.deleted { color: #098658 !important; } .token.selector, .token.attr-name, .token.string, .token.char, .token.builtin, .token.inserted { color: #a31515 !important; } .token.operator, .token.entity, .token.url { color: #333333 !important; } .token.atrule, .token.attr-value, .token.keyword { color: #af00db !important; } .token.keyword { color: #0000ff !important; } .token.keyword.control-flow, .token.keyword.return, .token.keyword.if, .token.keyword.for, .token.keyword.while, .token.keyword.import, .token.keyword.from { color: #af00db !important; } .token.function { color: #795e26 !important; } .token.class-name { color: #267f99 !important; } .token.regex, .token.important, .token.variable { color: #001080 !important; }',
      'one-dark': 'body { --bg-gradient: linear-gradient(135deg, #2b303c 0%, #1a1d24 100%); --editor-bg: #282c34; --title-bg: #21252b; --title-text: #abb2bf; --gutter-bg: #21252b; --gutter-text: #4b5263; --editor-text: #abb2bf; --border-color: #181a1f; --shadow: 0 20px 40px rgba(0, 0, 0, 0.4); }',
      'dracula': 'body { --bg-gradient: linear-gradient(135deg, #282a36 0%, #111217 100%); --editor-bg: #282a36; --title-bg: #191a21; --title-text: #f8f8f2; --gutter-bg: #191a21; --gutter-text: #6272a4; --editor-text: #f8f8f2; --border-color: #44475a; --shadow: 0 20px 40px rgba(0, 0, 0, 0.5); }',
      'github-light': 'body { --bg-gradient: linear-gradient(135deg, #f0f2f5 0%, #e6e8eb 100%); --editor-bg: #ffffff; --title-bg: #f6f8fa; --title-text: #24292f; --gutter-bg: #f6f8fa; --gutter-text: #57606a; --editor-text: #24292f; --border-color: #d0d7de; --shadow: 0 20px 40px rgba(0, 0, 0, 0.08); }',
      'nord': 'body { --bg-gradient: linear-gradient(135deg, #3b4252 0%, #2e3440 100%); --editor-bg: #2e3440; --title-bg: #242933; --title-text: #d8dee9; --gutter-bg: #242933; --gutter-text: #4c566a; --editor-text: #d8dee9; --border-color: #3b4252; --shadow: 0 20px 40px rgba(0, 0, 0, 0.4); }',
      'monokai': 'body { --bg-gradient: linear-gradient(135deg, #272822 0%, #1a1b18 100%); --editor-bg: #272822; --title-bg: #191919; --title-text: #f8f8f2; --gutter-bg: #191919; --gutter-text: #75715e; --editor-text: #f8f8f2; --border-color: #272822; --shadow: 0 20px 40px rgba(0, 0, 0, 0.5); }'
    };

    var themeStylesheets = {
      'vscode-dark': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-vsc-dark-plus.min.css',
      'vscode-light': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-vs.min.css',
      'one-dark': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-one-dark.min.css',
      'dracula': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-dracula.min.css',
      'github-light': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-ghcolors.min.css',
      'nord': 'https://fastly.jsdelivr.net/npm/prism-themes@1.9.0/themes/prism-nord.min.css',
      'monokai': 'https://fastly.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-okaidia.min.css'
    };

    // Set Theme variables
    var activeTheme = window.renderConfig.theme || 'one-dark';
    document.body.className = 'theme-' + activeTheme;
    document.getElementById('theme-vars').textContent = themeCSS[activeTheme] || themeCSS['one-dark'];

    // Load theme-specific Prism style sheet
    var prismLink = document.createElement('link');
    prismLink.rel = 'stylesheet';
    prismLink.href = themeStylesheets[activeTheme] || themeStylesheets['one-dark'];
    document.head.appendChild(prismLink);

    // Set Window Titles
    var extMap = {
      'javascript': 'js',
      'typescript': 'ts',
      'python': 'py',
      'rust': 'rs',
      'csharp': 'cs',
      'c++': 'cpp',
      'powershell': 'ps1',
      'dockerfile': 'docker'
    };
    var ext = extMap[window.renderConfig.lang] || window.renderConfig.lang;
    if (ext === 'text') ext = 'txt';
    var filename = window.renderConfig.mode === 'markdown' ? 'preview.md' : 'editor.' + ext;
    document.getElementById('window-title-text').textContent = filename;
    var langUpper = window.renderConfig.lang ? window.renderConfig.lang.toUpperCase() : 'TEXT';
    document.getElementById('window-lang-text').textContent = window.renderConfig.mode === 'markdown' ? 'PREVIEW' : langUpper;

    function alignLineNumbers() {
      var preElements = document.querySelectorAll('pre.line-numbers');
      preElements.forEach(function(pre) {
        var code = pre.querySelector('code');
        if (!code) return;
        var rows = pre.querySelector('.line-numbers-rows');
        if (!rows) return;

        var sizer = document.createElement('div');
        var computedStyle = window.getComputedStyle(code);
        sizer.style.position = 'absolute';
        sizer.style.visibility = 'hidden';
        sizer.style.width = code.clientWidth + 'px';
        sizer.style.fontFamily = computedStyle.fontFamily;
        sizer.style.fontSize = computedStyle.fontSize;
        sizer.style.lineHeight = computedStyle.lineHeight;
        sizer.style.letterSpacing = computedStyle.letterSpacing;
        sizer.style.whiteSpace = 'pre-wrap';
        sizer.style.wordBreak = 'break-all';
        sizer.style.wordWrap = 'break-word';
        sizer.style.padding = '0';
        sizer.style.margin = '0';
        document.body.appendChild(sizer);

        var codeText = code.textContent;
        var lines = codeText.split('\\n');
        var spans = rows.children;
        for (var i = 0; i < spans.length; i++) {
          var lineText = lines[i] || '';
          sizer.textContent = lineText.replace(/\\r$/, '') === '' ? ' ' : lineText.replace(/\\r$/, '');
          var height = sizer.getBoundingClientRect().height;
          spans[i].style.height = height + 'px';
          spans[i].style.display = 'block';
        }
        document.body.removeChild(sizer);
      });
    }

    var parent = document.getElementById('content-parent');

    if (window.renderConfig.mode === 'markdown') {
      // 1. Markdown mode: Render Markdown using markdown-it
      var md = window.markdownit({
        html: true,
        linkify: true,
        typographer: true,
        highlight: function (str, lang) {
          var validLang = lang && Prism.languages[lang] ? lang : 'text';
          try {
            if (Prism.languages[validLang]) {
              return Prism.highlight(str, Prism.languages[validLang], validLang);
            }
          } catch (e) {
            console.error(e);
          }
          return ''; // fallback to default escaping
        }
      });

      var parsedHtml = md.render(text);
      var mdDiv = document.createElement('div');
      mdDiv.className = 'markdown-body';
      mdDiv.innerHTML = parsedHtml;

      // Add line numbers and language tag classes to code pre/code blocks in the document
      mdDiv.querySelectorAll('pre').forEach(function(pre) {
        pre.classList.add('line-numbers');
        var code = pre.querySelector('code');
        if (code) {
          var hasLang = false;
          code.classList.forEach(function(cls) {
            if (cls.startsWith('language-')) hasLang = true;
          });
          if (!hasLang) {
            code.classList.add('language-text');
          }
        }
      });

      parent.appendChild(mdDiv);
      Prism.highlightAll();
      alignLineNumbers();
    } else {
      // 2. Editor / Code mode: Display entire text inside a pre/code tag
      var pre = document.createElement('pre');
      pre.className = 'line-numbers';
      
      var code = document.createElement('code');
      code.className = 'language-' + (window.renderConfig.lang || 'text');
      code.textContent = text;

      pre.appendChild(code);
      parent.appendChild(pre);

      Prism.highlightAll();
      alignLineNumbers();
    }
  </script>
</body>
</html>`
}

async function renderImage(text: string, mode: 'markdown' | 'editor', lang: string, theme: string): Promise<Buffer | null> {
  let page;
  try {
    const instance = await getBrowser()
    page = await instance.newPage()

    // Enforce viewport size. The screenshot will crop exactly to the bounding box of the .container element.
    await page.setViewport({ width: 880, height: 1200, deviceScaleFactor: 2 })
    const html = renderHtml(text, mode, lang, theme)

    // Attempt networkidle0 to wait for PrismJS components to finish loading from CDN.
    // If offline or timeout, fallback to standard load.
    try {
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 6000 })
    } catch (err) {
      await page.setContent(html, { waitUntil: 'load', timeout: 3000 }).catch(() => {})
    }

    const container = await page.$('.container')
    const image = await (container || page).screenshot({
      type: 'png',
      encoding: 'binary'
    })

    return Buffer.from(image)
  } catch (err) {
    console.error('[渲染] 渲染图片出错:', err)
    return null
  } finally {
    if (page) {
      await page.close().catch(() => {})
    }
  }
}

export default definePlugin({
  name: PLUGIN_NAME,
  version: PLUGIN_VERSION,
  description: '将引用消息的文字渲染为精美的图片发出，支持 Markdown 和代码高亮，带有左侧编辑器行号与霞鹜文楷字体',
  dependencies: ['puppeteer-core'],
  setup(ctx) {
    const pluginDir = join(getAbsPluginDir(), PLUGIN_NAME)
    const configPath = join(pluginDir, 'config.json')

    const loadConfig = (): PluginConfig => {
      const defaultConfig: PluginConfig = {
        enabled: true,
        defaultMode: 'auto',
        defaultTheme: 'one-dark',
        whitelist: [],
        keywords: ['渲染', 'render', '转图片']
      }

      if (!existsSync(configPath)) {
        return defaultConfig
      }

      try {
        const fileContent = readFileSync(configPath, 'utf-8')
        return {
          ...defaultConfig,
          ...JSON.parse(fileContent)
        }
      } catch (err: any) {
        ctx.logger.error(`加载配置文件失败，将使用默认设置: ${err.message}`)
        return defaultConfig
      }
    }

    ctx.logger.info(`[${PLUGIN_NAME}] 插件启动中...`)

    // Supported modes and themes mapping
    const modesMap: Record<string, 'markdown' | 'editor'> = {
      'md': 'markdown',
      'markdown': 'markdown',
      'rich': 'markdown',
      'code': 'editor',
      'editor': 'editor',
      'txt': 'editor',
      'text': 'editor'
    }

    const themesList = ['vscode-dark', 'vscode-light', 'one-dark', 'dracula', 'github-light', 'nord', 'monokai']

    ctx.handle('message', async (e) => {
      const config = loadConfig()
      if (!config.enabled) return

      // Whitelist check
      if (e.message_type === 'group' && config.whitelist.length > 0) {
        if (!config.whitelist.includes(e.group_id)) {
          return
        }
      }

      const rawText = ctx.text(e).trim()
      
      // Keyword matching
      const matchedKeyword = config.keywords.find(kw => rawText.startsWith(kw))
      if (!matchedKeyword) return

      // Parse parameters (e.g. "渲染 md dracula")
      const commandArgs = rawText.substring(matchedKeyword.length).trim()
      const args = commandArgs.split(/\s+/).filter(Boolean)

      let targetText = ''
      let mode: 'markdown' | 'editor' | 'auto' = 'auto'
      let theme = config.defaultTheme
      let lang = 'text'

      let hasParsedMode = false
      let hasParsedTheme = false
      let hasParsedLang = false

      let parsedArgsCount = 0

      // Language alias mapping to canonical PrismJS language names
      const languageAliases: Record<string, string> = {
        'js': 'javascript',
        'javascript': 'javascript',
        'ts': 'typescript',
        'typescript': 'typescript',
        'jsx': 'jsx',
        'tsx': 'tsx',
        'py': 'python',
        'python': 'python',
        'go': 'go',
        'golang': 'go',
        'rs': 'rust',
        'rust': 'rust',
        'c': 'c',
        'cpp': 'cpp',
        'c++': 'cpp',
        'c#': 'csharp',
        'csharp': 'csharp',
        'java': 'java',
        'bash': 'bash',
        'sh': 'bash',
        'shell': 'bash',
        'json': 'json',
        'yaml': 'yaml',
        'yml': 'yaml',
        'md': 'markdown',
        'markdown': 'markdown',
        'html': 'html',
        'css': 'css',
        'sql': 'sql',
        'xml': 'xml',
        'txt': 'text',
        'text': 'text',
        'php': 'php',
        'rb': 'ruby',
        'ruby': 'ruby',
        'pl': 'perl',
        'perl': 'perl',
        'dart': 'dart',
        'swift': 'swift',
        'kt': 'kotlin',
        'kotlin': 'kotlin',
        'scala': 'scala',
        'hs': 'haskell',
        'haskell': 'haskell',
        'lua': 'lua',
        'r': 'r',
        'powershell': 'powershell',
        'ps1': 'powershell',
        'docker': 'dockerfile',
        'dockerfile': 'dockerfile',
        'ini': 'ini',
        'toml': 'toml',
        'diff': 'diff',
        'scss': 'scss',
        'less': 'less',
        'objc': 'objectivec',
        'objectivec': 'objectivec',
        'asm': 'asm'
      }

      // Get quoted message first
      const quoteMsg = await ctx.getQuoteMsg(e).catch(() => null)

      // Parse options from the arguments list
      for (const arg of args) {
        const lowerArg = arg.toLowerCase()

        if (!hasParsedMode && modesMap[lowerArg]) {
          mode = modesMap[lowerArg]
          hasParsedMode = true
          parsedArgsCount++
        } else if (!hasParsedTheme && themesList.includes(lowerArg)) {
          theme = lowerArg as any
          hasParsedTheme = true
          parsedArgsCount++
        } else if (!hasParsedLang && languageAliases[lowerArg]) {
          lang = languageAliases[lowerArg]
          hasParsedLang = true
          parsedArgsCount++
        } else {
          // Stop parsing options on first unrecognized token in direct text mode
          if (!quoteMsg) {
            break
          }
          // Accept arbitrary language specifiers in quoted mode
          if (!hasParsedLang && arg.length <= 15 && /^[a-zA-Z0-9+#-]+$/.test(arg)) {
            lang = lowerArg
            hasParsedLang = true
            parsedArgsCount++
          } else {
            break
          }
        }
      }

      if (quoteMsg) {
        // Quoted message rendering
        targetText = ctx.text(quoteMsg)
      } else {
        // Direct text rendering - extract remainder from raw commandArgs to preserve formatting
        if (parsedArgsCount === 0) {
          targetText = commandArgs
        } else {
          let tempArgsCount = parsedArgsCount
          let index = 0
          // Skip leading spaces
          while (index < commandArgs.length && /\s/.test(commandArgs[index])) {
            index++
          }
          for (let k = 0; k < tempArgsCount; k++) {
            // skip non-whitespace
            while (index < commandArgs.length && !/\s/.test(commandArgs[index])) {
              index++
            }
            // skip whitespace
            while (index < commandArgs.length && /\s/.test(commandArgs[index])) {
              index++
            }
          }
          targetText = commandArgs.substring(index)
        }
      }

      // Check if there is actual content to render
      if (!targetText.trim()) {
        await e.reply('❌ 请在回复(引用)一条消息后发送“渲染”进行转图，或者直接发送“渲染 [文本内容]”\n💡 支持参数（模式、主题、语言），例如：“渲染 md dracula”', true)
        return
      }

      // Auto-detect mode and language
      if (mode === 'auto') {
        const trimmed = targetText.trim()
        
        // 1. Detect if it's a code block
        const codeBlockMatch = trimmed.match(/^```(\w*)\n([\s\S]+?)\n```$/)
        if (codeBlockMatch) {
          mode = 'editor'
          const rawLang = (codeBlockMatch[1] || 'text').toLowerCase()
          lang = languageAliases[rawLang] || rawLang
          targetText = codeBlockMatch[2]
        } else if (
          trimmed.startsWith('# ') ||
          trimmed.startsWith('## ') ||
          trimmed.startsWith('### ') ||
          trimmed.startsWith('> ') ||
          trimmed.startsWith('- ') ||
          trimmed.startsWith('* ') ||
          trimmed.includes('\n# ') ||
          trimmed.includes('\n- ') ||
          trimmed.includes('\n* ') ||
          trimmed.includes('**')
        ) {
          mode = 'markdown'
        } else {
          mode = 'editor'
          // Keep the parsed language from arguments, if any. Otherwise it remains default 'text'
        }
      } else if (mode === 'editor') {
        // Strip code block wrapping if explicitly requested editor mode
        const trimmed = targetText.trim()
        const codeBlockMatch = trimmed.match(/^```(\w*)\n([\s\S]+?)\n```$/)
        if (codeBlockMatch) {
          const rawLang = (codeBlockMatch[1] || lang || 'text').toLowerCase()
          lang = languageAliases[rawLang] || rawLang
          targetText = codeBlockMatch[2]
        }
      }


      ctx.logger.info(`[渲染] 开始为用户 ${e.user_id} 渲染图片: 模式=${mode}, 主题=${theme}, 语言=${lang}`)
      
      let promptMsg: any = null
      try {
        promptMsg = await e.reply('正在生成渲染图片，请稍候...', false)
        
        const imageBuffer = await renderImage(targetText, mode as any, lang, theme)

        if (promptMsg && promptMsg.message_id) {
          await ctx.bot.recallMsg(promptMsg.message_id).catch(() => {})
        }

        if (imageBuffer) {
          const base64Img = `base64://${imageBuffer.toString('base64')}`
          await e.reply(ctx.segment.image(base64Img))
          ctx.logger.info(`[渲染] 渲染图片生成并发送成功`)
        } else {
          throw new Error('生成的图片缓冲区为空')
        }
      } catch (err: any) {
        ctx.logger.error(`[渲染] 渲染失败: ${err.message}`)
        if (promptMsg && promptMsg.message_id) {
          await ctx.bot.recallMsg(promptMsg.message_id).catch(() => {})
        }
        await e.reply(`❌ 渲染失败，错误信息: ${err.message}`, true)
      }
    })

    ctx.logger.info(`[${PLUGIN_NAME}] 插件启动成功`)

    // Clean up browser on uninstall
    return async () => {
      if (browserLaunchPromise) {
        try {
          const b = await browserLaunchPromise
          await b.close()
        } catch {}
        browserLaunchPromise = null
      } else if (browser) {
        try {
          await browser.close()
        } catch {}
      }
      browser = null
    }
  }
})
