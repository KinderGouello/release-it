const path = require('path');
const _ = require('lodash');
const isCI = require('is-ci');
const defaultConfig = require('../conf/release-it.json');
const { FileNotFoundError } = require('./errors');
const { debugConfig: debug } = require('./debug');

const LOCAL_CONFIG_FILE = '.release-it.json';
const LOCAL_PACKAGE_FILE = 'package.json';

const getLocalConfig = localConfigFile => {
  let localConfig = {};
  if (localConfigFile === false) return localConfig;
  const localConfigPath = path.resolve(localConfigFile || LOCAL_CONFIG_FILE);
  try {
    localConfig = require(localConfigPath);
  } catch (error) {
    debug(error);
    if (!localConfigFile && error.code === 'MODULE_NOT_FOUND') return {};
    if (error.code === 'MODULE_NOT_FOUND') throw new FileNotFoundError(localConfigPath);
    throw error;
  }
  return localConfig;
};

const getNpmPackageManifest = manifestFile => {
  let npm = {};
  if (manifestFile === false) return npm;
  const manifestPath = path.resolve(manifestFile || LOCAL_PACKAGE_FILE);
  try {
    npm = require(manifestPath);
  } catch (err) {
    debug(err);
  }
  return npm;
};

class Config {
  constructor(config = {}) {
    this.constructorConfig = this.parsePreReleaseShorthand(config);
    this.localConfig = getLocalConfig(config.config);
    this.localPackageManifest = getNpmPackageManifest(config.manifest);
    this.options = this._mergeOptions();
    this.runtimeOptions = {};
    if (!this.options.increment && !this.isInteractive && !this.options.preRelease) {
      this.options.increment = 'patch';
    }
    debug(this.getOptions());
  }

  parsePreReleaseShorthand(options) {
    const { preRelease } = options;
    if (preRelease) {
      const preReleaseId = preRelease === true ? undefined : preRelease;
      options.preReleaseId = preReleaseId;
      options.preRelease = !!preRelease;
      options.npm = options.npm || {};
      options.npm.tag = options.npm.tag || preReleaseId;
    }
    return options;
  }

  _mergeOptions() {
    return _.defaultsDeep(
      {},
      this.constructorConfig,
      {
        'non-interactive': isCI || undefined
      },
      this.localPackageManifestConfig,
      this.localConfig,
      {
        name: this.npmConfig.name || path.basename(process.cwd()),
        npm: this.npmConfig
      },
      this.defaultConfig
    );
  }

  getOptions() {
    return Object.assign({}, this.options, this.runtimeOptions);
  }

  setRuntimeOptions(options) {
    Object.assign(this.runtimeOptions, options);
  }

  get defaultConfig() {
    return defaultConfig;
  }

  get npmConfig() {
    const { version, name, private: isPrivate } = this.localPackageManifest;
    return {
      version,
      name,
      private: isPrivate,
      publish: !!name
    };
  }

  get localPackageManifestConfig() {
    return this.localPackageManifest['release-it'] || {};
  }

  get isDryRun() {
    return Boolean(this.options['dry-run']);
  }

  get isVerbose() {
    return Boolean(this.options.verbose);
  }

  get isDebug() {
    return Boolean(this.options.debug);
  }

  get isInteractive() {
    return !this.options['non-interactive'];
  }

  get isCollectMetrics() {
    return !this.options['disable-metrics'];
  }
}

module.exports = Config;
