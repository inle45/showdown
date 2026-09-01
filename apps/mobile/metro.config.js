const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// This app depends on @showdown-mobile/core, a sibling workspace package whose
// source lives outside apps/mobile (packages/core, symlinked into
// node_modules by npm workspaces). Metro only watches projectRoot by default,
// so without watchFolders it never sees changes to — or in a fresh clone,
// never resolves — that source at all.
config.watchFolders = [workspaceRoot];

// Dependencies hoisted to the workspace root's node_modules (most of them,
// under npm workspaces) must also be resolvable from here.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
