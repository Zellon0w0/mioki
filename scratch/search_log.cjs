const fs = require('fs');
const content = fs.readFileSync('c:/Workspace/Git/mioki/example/logs/2026-05-22_12-06-31.log', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('欢迎') || line.includes('已就绪') || line.includes('成功加载了')) {
    console.log(`Line ${i + 1}: ${line}`);
  }
});
