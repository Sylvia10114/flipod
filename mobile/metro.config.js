const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const mobileNodeModulesPath = path.resolve(__dirname, 'node_modules');

config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [mobileNodeModulesPath];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = new Proxy(
  {},
  {
    get: (_, name) => path.join(mobileNodeModulesPath, name),
  }
);

module.exports = config;
