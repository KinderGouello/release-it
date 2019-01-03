const path = require('path');
const { EOL } = require('os');
const test = require('ava');
const sh = require('shelljs');
const proxyquire = require('proxyquire');
const mockStdIo = require('mock-stdio');
const { gitAdd, readFile, readJSON } = require('./util/index');
const uuid = require('uuid/v4');
const GitHubApi = require('@octokit/rest');
const githubRequestMock = require('./mock/github.request');
const shell = require('../lib/shell');
const sinon = require('sinon');
const runTasks = require('../lib/tasks');
const {
  GitRepoError,
  GitRemoteUrlError,
  GitCleanWorkingDirError,
  GitUpstreamError,
  GithubTokenError,
  InvalidVersionError,
  DistRepoStageDirError
} = require('../lib/errors');

const cwd = process.cwd();

const githubRequestStub = sinon.stub().callsFake(githubRequestMock);
const githubApi = new GitHubApi();
githubApi.hook.wrap('request', githubRequestStub);
const GithubApiStub = sinon.stub().returns(githubApi);

const publishStub = sinon.stub().resolves();

class shellStub extends shell {
  run(command) {
    if (command.startsWith('npm publish')) {
      this.log.exec(command);
      return publishStub(...arguments);
    }
    return super.run(...arguments);
  }
}

const testConfig = {
  config: false,
  'non-interactive': true,
  'disable-metrics': true
};

const tasks = options => runTasks(Object.assign({}, testConfig, options));

test.serial.beforeEach(t => {
  const bare = path.resolve(cwd, 'tmp', uuid());
  const target = path.resolve(cwd, 'tmp', uuid());
  sh.pushd('-q', `${cwd}/tmp`);
  sh.exec(`git init --bare ${bare}`);
  sh.exec(`git clone ${bare} ${target}`);
  sh.pushd('-q', target);
  gitAdd('line', 'file', 'Add file');
  t.context = { bare, target };
});

test.serial.afterEach(t => {
  sh.pushd('-q', cwd);
  githubRequestStub.resetHistory();
  publishStub.resetHistory();
});

test.serial('should throw when not a Git repository', async t => {
  sh.pushd('-q', '../../..');
  mockStdIo.start();
  await t.throwsAsync(tasks, GitRepoError, { message: /Not a git repository/ });
  mockStdIo.end();
  sh.popd('-q');
});

test.serial('should throw if there is no remote Git url', async t => {
  sh.exec('git remote remove origin');
  mockStdIo.start();
  await t.throwsAsync(tasks, GitRemoteUrlError, { message: /Could not get remote Git url/ });
  mockStdIo.end();
});

test.serial('should throw if working dir is not clean', async t => {
  sh.exec('rm file');
  mockStdIo.start();
  await t.throwsAsync(tasks, GitCleanWorkingDirError, { message: /Working dir must be clean/ });
  mockStdIo.end();
});

test.serial('should throw if no upstream is configured', async t => {
  sh.exec('git checkout -b foo');
  mockStdIo.start();
  await t.throwsAsync(tasks, GitUpstreamError, { message: /No upstream configured for current branch/ });
  mockStdIo.end();
});

test.serial('should throw if no GitHub token environment variable is set', async t => {
  mockStdIo.start();
  await t.throwsAsync(
    tasks({
      github: {
        release: true,
        tokenRef: 'GITHUB_FOO'
      }
    }),
    GithubTokenError,
    { message: /Environment variable "GITHUB_FOO" is required for GitHub releases/ }
  );
  mockStdIo.end();
});

test.serial('should throw if invalid increment value is provided', async t => {
  mockStdIo.start();
  await t.throwsAsync(
    tasks({
      increment: 'mini'
    }),
    InvalidVersionError,
    { message: /invalid version was provided/ }
  );
  mockStdIo.end();
});

test.serial('should throw if not a subdir is provided for dist.stageDir', async t => {
  mockStdIo.start();
  await t.throwsAsync(
    tasks({
      dist: {
        repo: 'foo',
        stageDir: '..'
      }
    }),
    DistRepoStageDirError,
    { message: /`dist.stageDir` \(".."\) must resolve to a sub directory/ }
  );
  mockStdIo.end();
});

test.serial('should run tasks without throwing errors', async t => {
  mockStdIo.start();
  const { name, latestVersion, version } = await tasks({
    increment: 'patch',
    pkgFiles: null,
    manifest: false,
    npm: {
      publish: false
    }
  });
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes(`release ${name} (${latestVersion}...${version})`));
  t.regex(stdout, /Done \(in [0-9]+s\.\)/);
});

test.serial('should run tasks with minimal config and without any warnings/errors', async t => {
  gitAdd('{"name":"my-package","version":"1.2.3"}', 'package.json', 'Add package.json');
  sh.exec('git tag 1.2.3');
  gitAdd('line', 'file', 'More file');
  mockStdIo.start();
  await tasks({
    increment: 'patch',
    npm: {
      publish: false
    }
  });
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes('release my-package (1.2.3...1.2.4)'));
  t.regex(stdout, /Done \(in [0-9]+s\.\)/);
  const pkg = await readJSON('package.json');
  t.is(pkg.version, '1.2.4');
  {
    const { stdout } = sh.exec('git describe --tags --abbrev=0');
    t.is(stdout.trim(), '1.2.4');
  }
});

test.serial('should use pkg.version if no git tag', async t => {
  gitAdd('{"name":"my-package","version":"1.2.3"}', 'package.json', 'Add package.json');
  mockStdIo.start();
  await tasks({
    increment: 'minor',
    npm: {
      publish: false
    }
  });
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes('release my-package (1.2.3...1.3.0)'));
  t.regex(stdout, /Done \(in [0-9]+s\.\)/);
  const pkg = await readJSON('package.json');
  t.is(pkg.version, '1.3.0');
  {
    const { stdout } = sh.exec('git describe --tags --abbrev=0');
    t.is(stdout.trim(), '1.3.0');
  }
});

test.serial('should use pkg.version (in sub dir) w/o tagging repo', async t => {
  gitAdd('{"name":"root-package","version":"1.0.0"}', 'package.json', 'Add package.json');
  sh.exec('git tag 1.0.0');
  sh.mkdir('my-package');
  sh.pushd('-q', 'my-package');
  gitAdd('{"name":"my-package","version":"1.2.3"}', 'package.json', 'Add package.json');
  mockStdIo.start();
  await tasks({
    increment: 'minor',
    git: {
      tag: false
    },
    npm: {
      publish: false
    }
  });
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes('release my-package (1.2.3...1.3.0)'));
  t.regex(stdout, /Done \(in [0-9]+s\.\)/);
  const pkg = await readJSON('package.json');
  t.is(pkg.version, '1.3.0');
  sh.popd('-q');
  {
    const { stdout } = sh.exec('git describe --tags --abbrev=0');
    t.is(stdout.trim(), '1.0.0');
    const pkg = await readJSON('package.json');
    t.is(pkg.version, '1.0.0');
  }
});

test.serial('should run tasks without package.json', async t => {
  sh.exec('git tag 1.0.0');
  mockStdIo.start();
  const { name } = await tasks({
    increment: 'major',
    npm: {
      publish: false
    }
  });
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes(`release ${name} (1.0.0...2.0.0)`));
  t.true(stdout.includes('Could not bump package.json'));
  t.true(stdout.includes('Could not stage package.json'));
  t.regex(stdout, /Done \(in [0-9]+s\.\)/);
  {
    const { stdout } = sh.exec('git describe --tags --abbrev=0');
    t.is(stdout.trim(), '2.0.0');
  }
});

{
  const runTasks = proxyquire('../lib/tasks', {
    '@octokit/rest': Object.assign(GithubApiStub, { '@global': true }),
    './shell': Object.assign(shellStub, { '@global': true })
  });

  const tasks = options => runTasks(Object.assign({}, testConfig, options));

  test.serial('should release all the things (basic)', async t => {
    const { bare, target } = t.context;
    const repoName = path.basename(bare);
    const pkgName = path.basename(target);
    sh.exec('git tag 1.0.0');
    gitAdd('line', 'file', 'More file');
    mockStdIo.start();
    await tasks({
      github: {
        release: true
      },
      npm: {
        name: pkgName,
        publish: true
      }
    });
    const { stdout } = mockStdIo.end();

    const githubReleaseArg = githubRequestStub.firstCall.lastArg;
    t.is(githubRequestStub.callCount, 1);
    t.is(githubReleaseArg.url, '/repos/:owner/:repo/releases');
    t.is(githubReleaseArg.owner, null);
    t.is(githubReleaseArg.repo, repoName);
    t.is(githubReleaseArg.tag_name, '1.0.1');
    t.is(githubReleaseArg.name, 'Release 1.0.1');
    t.true(githubReleaseArg.body.startsWith('* More file'));
    t.is(githubReleaseArg.prerelease, false);
    t.is(githubReleaseArg.draft, false);

    t.is(publishStub.firstCall.args[0].trim(), 'npm publish . --tag latest');

    t.true(stdout.includes(`release ${pkgName} (1.0.0...1.0.1)`));
    t.true(stdout.includes(`https://github.com/null/${repoName}/releases/tag/1.0.1`));
    t.true(stdout.includes(`https://www.npmjs.com/package/${pkgName}`));
  });

  test.serial('should release all the things (pre-release, assets, dist repo)', async t => {
    const { bare, target } = t.context;
    const repoName = path.basename(bare);
    const pkgName = path.basename(target);
    const owner = null;
    {
      // Prepare fake dist repo
      sh.exec('git checkout -b dist');
      gitAdd(`dist-line${EOL}`, 'dist-file', 'Add dist file');
      sh.exec('git push -u origin dist');
    }
    sh.exec('git checkout -b master');
    sh.exec('git tag 1.0.0');
    gitAdd('line', 'file', 'More file');
    sh.exec('git push --follow-tags');
    mockStdIo.start();
    await tasks({
      increment: 'minor',
      preRelease: 'alpha',
      github: {
        release: true,
        assets: ['file']
      },
      npm: {
        name: pkgName
      },
      dist: {
        repo: `${bare}#dist`,
        scripts: {
          beforeStage: `echo release-line >> dist-file`
        },
        npm: {
          publish: true
        }
      }
    });
    const { stdout } = mockStdIo.end();

    t.is(githubRequestStub.callCount, 2);

    const githubReleaseArg = githubRequestStub.firstCall.lastArg;
    t.is(githubReleaseArg.url, '/repos/:owner/:repo/releases');
    t.is(githubReleaseArg.owner, owner);
    t.is(githubReleaseArg.repo, repoName);
    t.is(githubReleaseArg.tag_name, '1.1.0-alpha.0');
    t.is(githubReleaseArg.name, 'Release 1.1.0-alpha.0');
    t.true(githubReleaseArg.body.startsWith('* More file'));
    t.is(githubReleaseArg.prerelease, true);
    t.is(githubReleaseArg.draft, false);

    const githubAssetsArg = githubRequestStub.secondCall.lastArg;
    const { id } = githubRequestStub.firstCall.returnValue.data;
    t.true(githubAssetsArg.url.endsWith(`/repos/${owner}/${repoName}/releases/${id}/assets{?name,label}`));
    t.is(githubAssetsArg.name, 'file');

    t.is(publishStub.callCount, 1);
    t.is(publishStub.firstCall.args[0].trim(), 'npm publish . --tag alpha');

    sh.exec('git checkout dist');
    sh.exec('git pull');
    const distFile = await readFile('dist-file');
    t.is(distFile.trim(), `dist-line${EOL}release-line`);

    const [, sourceOutput, distOutput] = stdout.split('🚀');
    t.true(sourceOutput.includes(`release ${pkgName} (1.0.0...1.1.0-alpha.0)`));
    t.true(sourceOutput.includes(`https://github.com/${owner}/${repoName}/releases/tag/1.1.0-alpha.0`));
    t.true(distOutput.includes(`release the distribution repo for ${pkgName}`));
    t.true(distOutput.includes(`https://www.npmjs.com/package/${pkgName}`));
    t.true(/Done \(in [0-9]+s\.\)/.test(distOutput));
  });
}
