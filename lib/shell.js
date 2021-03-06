const { EOL } = require('os');
const cpy = require('cpy');
const sh = require('shelljs');
const _ = require('lodash');
const bumpFile = require('bump-file');
const isSubDir = require('@webpro/is-subdir');
const Log = require('./log');
const Config = require('./config');
const { debugShell: debug } = require('./debug');
const { format } = require('./util');

const noop = Promise.resolve();

const forcedCmdRe = /^!/;

class Shell {
  constructor({ isVerbose = false, isDryRun = false, log, config } = {}) {
    this.isVerbose = isVerbose;
    this.isDryRun = isDryRun;
    this.log = log || new Log({ isVerbose, isDryRun });
    this.config = config || new Config();
  }

  run(command, options = {}) {
    const normalizedCmd = command.replace(forcedCmdRe, '');
    const program = normalizedCmd.split(' ')[0];
    const programArgs = normalizedCmd.split(' ').slice(1);
    const isSilent = sh.config.silent;
    const isVerbose = typeof options.verbose === 'boolean' ? options.verbose : this.isVerbose;

    this.log.exec(normalizedCmd);

    if (this.isDryRun && options.isReadOnly === Shell.writes.isReadOnly) {
      this.log.dry();
      return noop;
    }

    return new Promise((resolve, reject) => {
      const cb = (code, stdout, stderr) => {
        stdout = stdout.toString();
        if (isVerbose && !stdout.endsWith(EOL)) process.stdout.write(EOL);
        stdout = stdout.trim();
        debug({ command, options, code, stdout, stderr });
        sh.config.silent = isSilent;
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(stderr || stdout));
        }
      };

      if (program in sh && typeof sh[program] === 'function' && forcedCmdRe.test(command)) {
        sh.config.silent = !isVerbose;
        cb(0, sh[program](...programArgs));
      } else {
        sh.exec(normalizedCmd, { async: true, silent: !isVerbose }, cb);
      }
    });
  }

  runTemplateCommand(command, options) {
    const context = this.config.getOptions();
    return command ? this.run(format(command, context), options) : noop;
  }

  pushd(path) {
    return this.run(`!pushd ${path}`);
  }

  popd() {
    return this.run('!popd');
  }

  copy(files, target, options = {}) {
    const opts = Object.assign({ parents: true, nodir: true }, options);
    this.log.exec('copy', files, target, opts);
    if (this.isDryRun) {
      this.log.dry();
      return noop;
    }
    return cpy(files, target, opts);
  }

  bump(files, version) {
    this.log.exec('bump', files, version);
    if (this.isDryRun) {
      this.log.dry();
      return noop;
    }
    const sanitizedFiles = _.compact(_.castArray(files));
    const bumper = file => bumpFile(file, version).catch(() => this.log.warn(`Could not bump ${file}`));
    return Promise.all(sanitizedFiles.map(bumper));
  }

  isSubDir(...args) {
    return isSubDir(...args);
  }
}

Shell.writes = { isReadOnly: false };

module.exports = Shell;
