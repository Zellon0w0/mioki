const fs = require('fs');
const path = require('path');

function searchAll(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  list.forEach(item => {
    const fullPath = path.join(dir, item);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      return;
    }
    if (stat.isDirectory()) {
      if (item !== 'node_modules' && item !== '.git') {
        searchAll(fullPath);
      }
    } else if (stat.isFile() && item.endsWith('.log')) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('19 个插件') || content.includes('成功加载了')) {
          console.log(`Found in: ${fullPath}`);
          const lines = content.split('\n');
          lines.forEach((line, i) => {
            if (line.includes('19 个插件') || line.includes('成功加载了')) {
              console.log(`  Line ${i+1}: ${line}`);
            }
          });
        }
      } catch (e) {}
    }
  });
}

console.log('Searching in C:/Users/Zellon/.gemini/antigravity...');
searchAll('C:/Users/Zellon/.gemini/antigravity');
console.log('Searching in C:/Workspace/Git/mioki...');
searchAll('C:/Workspace/Git/mioki');
console.log('Done.');
