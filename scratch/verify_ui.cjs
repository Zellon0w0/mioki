const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// Mock Song Items
const mockSongs = [
  {
    name: '晴天',
    artists: '周杰伦',
    duration: 269,
    coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000004Ne5s00g4Ne.jpg'
  },
  {
    name: '晴天 (深情版)',
    artists: 'Lucky小爱',
    duration: 235,
    coverUrl: 'https://p3-luna.douyinpic.com/img/tplv-b829550vbb~c5_375x375.jpg'
  },
  {
    name: '像晴天像雨天',
    artists: '汪苏泷',
    duration: 236,
    coverUrl: 'https://y.gtimg.cn/music/photo_new/T002R300x300M000001V8PDy1om05K.jpg'
  },
  {
    name: '晴天 (温柔女声版)',
    artists: '吉拉朵',
    duration: 130,
    coverUrl: 'http://imge.kugou.com/stdmusic/400/20230417/20230417153347394677.jpg'
  },
  {
    name: '晴天 (女声独唱版)',
    artists: '梅菜扣肉肉',
    duration: 268,
    coverUrl: 'http://imge.kugou.com/stdmusic/400/20260513/20260513001916595930.jpg'
  }
];

function escapeHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDuration(duration) {
  if (!duration) return '00:00'
  const minutes = Math.floor(duration / 60)
  const seconds = Math.floor(duration % 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function renderHtml(keyword, platformName, songs) {
  const songCardsHtml = songs.map((song, idx) => {
    const num = String(idx + 1).padStart(2, '0')
    const name = escapeHtml(song.name)
    const artists = escapeHtml(song.artists)
    const duration = formatDuration(song.duration)
    const coverUrl = song.coverUrl || 'https://p3-luna.douyinpic.com/img/tplv-b829550vbb~c5_375x375.jpg'
    
    return `
      <div class="song-card">
        <div class="song-num">#${num}</div>
        <div class="avatar-wrapper">
          <img class="avatar" src="${coverUrl}" alt="cover" />
        </div>
        <div class="song-info">
          <div class="song-title">${name}</div>
          <div class="song-singer">${artists}</div>
        </div>
        <div class="song-duration">${duration}</div>
      </div>
    `
  }).join('')

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
          background-color: #121318;
          background-image: 
            linear-gradient(rgba(255, 61, 0, 0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 61, 0, 0.03) 1px, transparent 1px);
          background-size: 20px 20px;
          font-family: 'Outfit', 'Noto Sans SC', sans-serif;
        }
        .menu-wrapper {
          width: 800px;
        }
        .menu-container {
          border: 2px solid #ff3d00;
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
          background: repeating-linear-gradient(-45deg, #ffb300, #ffb300 10px, #121318 10px, #121318 20px);
        }
        
        /* Header styles */
        .header-card {
          background: rgba(26, 27, 35, 0.95);
          border: 1px solid #ff3d00;
          border-top: 4px solid #ff3d00;
          padding: 20px;
          margin-bottom: 20px;
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
          color: #ffb300;
          font-family: monospace;
          letter-spacing: 1px;
        }
        .header-info h1 {
          font-size: 24px;
          font-weight: 800;
          color: #ffffff;
          margin: 0 0 4px 0;
          letter-spacing: 2px;
          text-transform: uppercase;
          text-shadow: 0 0 10px rgba(229, 57, 53, 0.4);
        }
        .header-subtitle {
          font-size: 12px;
          color: #ffb300;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }
        .header-meta {
          font-size: 11px;
          color: #8c8d99;
          font-family: monospace;
        }
        .header-meta span {
          color: #ff6d00;
          font-weight: bold;
        }

        /* Song card list */
        .songs-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .song-card {
          background: rgba(26, 27, 35, 0.85);
          border: 1px solid rgba(255, 61, 0, 0.2);
          border-left: 4px solid #ff3d00;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          clip-path: polygon(0 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
        }
        .song-num {
          font-size: 20px;
          font-weight: 800;
          color: #ffb300;
          font-family: monospace;
          width: 40px;
          text-shadow: 0 0 5px rgba(255, 179, 0, 0.3);
        }
        .avatar-wrapper {
          width: 50px;
          height: 50px;
          border: 1px solid #ff3d00;
          padding: 2px;
          background: #121318;
          clip-path: polygon(15% 0%, 85% 0%, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0% 85%, 0% 15%);
          margin-right: 20px;
        }
        .avatar {
          width: 100%;
          height: 100%;
          object-fit: cover;
          clip-path: polygon(15% 0%, 85% 0%, 100% 15%, 100% 85%, 85% 100%, 15% 100%, 0% 85%, 0% 15%);
        }
        .song-info {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .song-title {
          font-size: 16px;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 450px;
        }
        .song-singer {
          font-size: 13px;
          color: #ff6d00;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 450px;
        }
        .song-duration {
          font-size: 14px;
          font-weight: bold;
          color: #8c8d99;
          font-family: monospace;
          margin-left: 20px;
        }

        /* Footer */
        .footer-card {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 20px;
          background: rgba(26, 27, 35, 0.95);
          border: 1px solid #ff3d00;
          margin-top: 20px;
          font-size: 10px;
          font-family: monospace;
          color: #8c8d99;
          clip-path: polygon(0 10px, 10px 0, 100% 0, 100% 100%, 0 100%);
        }
        .footer-side strong {
          color: #ffb300;
        }
      </style>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&family=Noto+Sans+SC:wght@400;500;700;900&display=swap" rel="stylesheet">
    </head>
    <body>
      <div class="menu-wrapper">
        <div class="menu-container">
          <div class="header-card">
            <div class="header-info">
              <div class="header-subtitle">MUSIC SELECTION HUD [EVA UNIT-02]</div>
              <h1>点歌搜索结果</h1>
              <div class="header-meta">
                SEARCH KEYWORD: <span>${escapeHtml(keyword)}</span> // PLATFORM: <span>${escapeHtml(platformName)}</span>
              </div>
            </div>
          </div>

          <div class="songs-list">
            ${songCardsHtml}
          </div>

          <div class="footer-card">
            <div class="footer-side">
              SYSTEM: <strong>MIOKI MUSIC SYSTEM</strong>
            </div>
            <div class="footer-side">
              STATUS: <strong>SELECTION_PENDING</strong>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

function getChromeCandidates() {
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
    programFiles ? path.join(programFiles, 'Google/Chrome/Application/chrome.exe') : '',
    programFilesX86 ? path.join(programFilesX86, 'Google/Chrome/Application/chrome.exe') : '',
    localAppData ? path.join(localAppData, 'Google/Chrome/Application/chrome.exe') : '',
  ].filter(Boolean)
}

function findChromeExecutable() {
  const executablePath = getChromeCandidates().find((candidate) => fs.existsSync(candidate))
  if (!executablePath) {
    throw new Error('未找到 Chrome/Chromium，请设置 PUPPETEER_EXECUTABLE_PATH 或 CHROME_PATH')
  }
  return executablePath
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 850, height: 1000, deviceScaleFactor: 2 });
  
  const html = renderHtml('晴天', '网易云音乐', mockSongs);
  await page.setContent(html, { waitUntil: 'networkidle2', timeout: 15000 });
  
  const target = await page.$('.menu-container');
  const image = await (target || page).screenshot({
    type: 'png',
    encoding: 'binary',
  });
  
  const outputPath = path.join(__dirname, 'eva_music_ui.png');
  fs.writeFileSync(outputPath, Buffer.from(image));
  console.log('Successfully saved screenshot to:', outputPath);
  
  await browser.close();
}

main().catch(console.error);
