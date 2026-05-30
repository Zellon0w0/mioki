const { createJiti } = require('jiti');
const path = require('path');

// Simulate how jiti is created in packages/mioki/dist/index.cjs
const miokiDistDir = 'c:/Workspace/Git/mioki/packages/mioki/dist';
const jiti = createJiti(miokiDistDir, {
  extensions: ['.ts', '.js', '.cts', '.cjs', '.mts', '.mjs', '.tsx', '.jsx', '.json'],
  cache: false,
  fsCache: false,
  moduleCache: false,
  requireCache: false,
  interopDefault: true,
});

// Set a value in the CJS instance's runtimePlugins
const miokiCJS = require('c:/Workspace/Git/mioki/packages/mioki/dist/index.cjs');
console.log('Is globalThis.__mioki_runtime_plugins__ initialized?', !!globalThis.__mioki_runtime_plugins__);
miokiCJS.runtimePlugins.set('test-plugin', { name: 'test-plugin' });
console.log('CJS runtimePlugins keys after set:', Array.from(miokiCJS.runtimePlugins.keys()));

// Now import the plugin index.ts using jiti
const pluginPath = 'c:/Workspace/Git/mioki/plugins/菜单/index.ts';
console.log('Importing plugin using jiti...');
jiti.import(pluginPath).then(pluginModule => {
  console.log('Import success.');
  // Check the global map keys
  console.log('globalThis.__mioki_runtime_plugins__ keys:', Array.from(globalThis.__mioki_runtime_plugins__.keys()));
  
  // Let's also check where jiti resolved 'mioki' to. We can inspect the module cache or just print the runtimePlugins exported from index.ts if it was imported by jiti?
  // Wait, let's look at what the menu plugin resolved 'mioki' to.
  // We can see if the exported runtimePlugins from the plugin is the same
}).catch(err => {
  console.error('Import error:', err);
});
