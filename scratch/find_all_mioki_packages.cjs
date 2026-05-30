const fs = require('fs');
const path = require('path');

function searchAll(dir) {
  if (!fs.existsSync(dir)) return;
  let list;
  try {
    list = fs.readdirSync(dir);
  } catch (e) {
    return;
  }
  list.forEach(item => {
    const fullPath = path.join(dir, item);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      return;
    }
    if (stat.isDirectory()) {
      if (item !== 'node_modules' && item !== '.git' && item !== 'AppData') {
        searchAll(fullPath);
      }
    } else if (stat.isFile() && item === 'package.json') {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        if (content.includes('"mioki"')) {
          console.log(`Found package.json with "mioki": ${fullPath}`);
          const parsed = JSON.parse(content);
          if (parsed.mioki) {
            console.log(`  plugins: ${JSON.stringify(parsed.mioki.plugins)}`);
          }
        }
      } catch (e) {}
    }
  });
}

console.log('Searching in C:/Workspace...');
searchAll('C:/Workspace');
console.log('Searching in C:/Users/Zellon/Desktop...');
searchAll('C:/Users/Zellon/Desktop');
console.log('Searching in C:/Users/Zellon/mioki...');
searchAll('C:/Users/Zellon/mioki');
console.log('Done.');
