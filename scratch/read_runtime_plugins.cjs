const fs = require('fs');
const content = fs.readFileSync('c:/Workspace/Git/mioki/packages/mioki/dist/index.cjs', 'utf8');
const lines = content.split('\n');
lines.forEach((line, i) => {
  if (line.includes('runtimePlugins')) {
    console.log(`Line ${i + 1}: ${line}`);
  }
});
