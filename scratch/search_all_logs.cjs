const fs = require('fs');
const path = require('path');

function searchDir(logDir) {
  if (!fs.existsSync(logDir)) return;
  const files = fs.readdirSync(logDir);
  files.forEach(file => {
    const filePath = path.join(logDir, file);
    if (fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('19 个插件')) {
        console.log(`Found in file ${filePath}:`);
        const lines = content.split('\n');
        lines.forEach((line, i) => {
          if (line.includes('19 个插件')) {
            console.log(`  Line ${i + 1}: ${line}`);
          }
        });
      }
    }
  });
}

searchDir('c:/Workspace/Git/mioki/example/logs');
searchDir('C:/Users/Zellon/.gemini/antigravity/brain/145015b4-2aee-470a-adea-81328cf156af/example/logs');
