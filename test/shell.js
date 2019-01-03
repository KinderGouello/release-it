const test = require('ava');
const sinon = require('sinon');
const sh = require('shelljs');
const mockStdIo = require('mock-stdio');
const path = require('path');
const uuid = require('uuid/v4');
const { EOL } = require('os');
const { readFile, readJSON } = require('./util/index');
const Shell = require('../lib/shell');

const cwd = process.cwd();

const shell = new Shell();

test('run (shell.exec)', async t => {
  t.is(await shell.run('echo bar'), 'bar');
});

test.serial('run (shelljs command)', async t => {
  const stub = sinon.spy(sh, 'pwd');
  await shell.run('!pwd foo');
  t.is(stub.callCount, 1);
  t.is(stub.firstCall.args[0], 'foo');
  stub.restore();
});

test.serial('run (dry-run/read-only)', async t => {
  const shell = new Shell({ isDryRun: true });
  {
    mockStdIo.start();
    const actual = await shell.run('!pwd');
    const { stdout } = mockStdIo.end();
    t.is(actual, cwd);
    t.regex(stdout, /\$ pwd/);
    t.notRegex(stdout, /not executed in dry run/);
  }
  {
    mockStdIo.start();
    const actual = await shell.run('!pwd', Shell.writes);
    const { stdout } = mockStdIo.end();
    t.is(actual, undefined);
    t.regex(stdout, /\$ pwd/);
    t.regex(stdout, /not executed in dry run/);
  }
});

test.serial('run (verbose)', async t => {
  const shell = new Shell({ isVerbose: true });
  mockStdIo.start();
  const actual = await shell.run('echo foo');
  const { stdout } = mockStdIo.end();
  t.is(stdout, `$ echo foo\nfoo${EOL}`);
  t.is(actual, 'foo');
});

test.serial('runTemplateCommand', async t => {
  const run = cmd => shell.runTemplateCommand(cmd, { verbose: false });
  t.is(await run(''), undefined);
  t.is(await run('!pwd'), cwd);
  t.is(await run('echo ${git.pushRepo}'), 'origin');
  t.is(await run('echo -*- ${github.tokenRef} -*-'), '-*- GITHUB_TOKEN -*-');
});

test.serial('pushd + popd', async t => {
  sh.dirs('-cq');
  const dir = 'test/resources';
  const outputPush = await shell.pushd(dir);
  const [to, from] = outputPush.split(',');
  const diff = to
    .replace(from, '')
    .replace(/^[/|\\\\]/, '')
    .replace(/\\/g, '/');
  t.is(diff, dir);
  const popOutput = await shell.popd();
  const trail = popOutput.split(',');
  t.is(trail.length, 1);
});

test.serial('copy', async t => {
  const source = path.resolve(cwd, 'test/resources');
  const target = path.resolve(cwd, `tmp/${uuid()}`);
  sh.mkdir('-p', target);
  await shell.copy(['file*'], target, { cwd: source });
  t.is(await readFile(`${source}/file1`), await readFile(`${target}/file1`));
  t.is(await readFile(`${source}/file2`), await readFile(`${target}/file2`));
});

test.serial('bump', async t => {
  const target = path.resolve(cwd, `tmp/${uuid()}`);
  sh.mkdir('-p', target);
  const manifestA = path.join(target, 'package.json');
  const manifestB = path.join(target, 'lockfile.json');
  sh.cp('package.json', manifestA);
  sh.cp('package.json', manifestB);
  await shell.bump(manifestA, '1.0.0');
  const pkg = await readJSON(manifestA);
  t.is(pkg.version, '1.0.0');
  await shell.bump([manifestA, manifestB], '2.0.0');
  const pkgA = await readJSON(manifestA);
  const pkgB = await readJSON(manifestB);
  t.is(pkgA.version, '2.0.0');
  t.is(pkgB.version, '2.0.0');
});

test.serial('bump (file not found)', async t => {
  mockStdIo.start();
  await shell.bump('foo.json');
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes('Could not bump foo.json'));
});

test.serial('bump (invalid)', async t => {
  mockStdIo.start();
  await shell.bump('test/resources/file1');
  const { stdout } = mockStdIo.end();
  t.true(stdout.includes('Could not bump test/resources/file1'));
});

test.serial('bump (none)', async t => {
  mockStdIo.start();
  await shell.bump(false);
  await shell.bump(null);
  await shell.bump([]);
  const { stdout } = mockStdIo.end();
  t.false(stdout.includes('Could not bump'));
});
