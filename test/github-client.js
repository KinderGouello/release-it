const path = require('path');
const test = require('ava');
const sinon = require('sinon');
const proxyquire = require('proxyquire');
const GitHubApi = require('@octokit/rest');
const githubRequestMock = require('./mock/github.request');

const githubRequestStub = sinon.stub().callsFake(githubRequestMock);
const githubApi = new GitHubApi();
githubApi.hook.wrap('request', githubRequestStub);
const GithubApiStub = sinon.stub().returns(githubApi);

const GitHub = proxyquire('../lib/github-client', {
  '@octokit/rest': GithubApiStub
});

test.afterEach(() => {
  GithubApiStub.resetHistory();
  githubRequestStub.resetHistory();
});

test('validate', async t => {
  const tokenRef = 'MY_GITHUB_TOKEN';
  const github = new GitHub({ release: true, tokenRef, remoteUrl: '' });
  delete process.env[tokenRef];
  t.throws(() => github.validate(), {
    message: /Environment variable "MY_GITHUB_TOKEN" is required for GitHub releases/
  });
  process.env[tokenRef] = '123';
  t.notThrows(() => github.validate());
});

test.serial('release + uploadAssets', async t => {
  const remoteUrl = 'https://github.com/webpro/release-it-test';
  const asset = 'file1';
  const version = '2.0.1';
  const tagName = 'v${version}';

  const github = new GitHub({
    release: true,
    remoteUrl,
    tagName,
    assets: path.resolve('test/resources', asset)
  });

  const releaseResult = await github.release({
    version
  });

  t.is(releaseResult.tag_name, 'v' + version);
  t.is(releaseResult.name, 'Release ' + version);

  const [uploadResult] = await github.uploadAssets();

  t.is(GithubApiStub.callCount, 1);
  t.deepEqual(GithubApiStub.firstCall.args[0], {
    version: '3.0.0',
    url: 'https://api.github.com',
    timeout: 0,
    headers: { 'user-agent': 'webpro/release-it' }
  });

  t.is(githubRequestStub.callCount, 2);
  t.is(githubRequestStub.firstCall.lastArg.owner, 'webpro');
  t.is(githubRequestStub.firstCall.lastArg.repo, 'release-it-test');
  t.is(githubRequestStub.firstCall.lastArg.tag_name, 'v2.0.1');
  t.is(githubRequestStub.firstCall.lastArg.name, 'Release 2.0.1');
  t.is(githubRequestStub.secondCall.lastArg.name, 'file1');

  t.is(uploadResult.name, asset);
  t.is(uploadResult.state, 'uploaded');
  t.is(uploadResult.browser_download_url, `${remoteUrl}/releases/download/v${version}/${asset}`);
});

test.serial('release (enterprise)', async t => {
  const github = new GitHub({
    remoteUrl: 'https://github.my-GHE-enabled-company.com/user/repo'
  });

  await github.release({
    version: '1'
  });

  t.is(GithubApiStub.callCount, 1);
  t.is(GithubApiStub.firstCall.args[0].url, 'https://github.my-GHE-enabled-company.com/api/v3');
});

test.serial('release (override host)', async t => {
  const github = new GitHub({
    remoteUrl: 'https://github.my-GHE-enabled-company.com/user/repo',
    host: 'my-custom-host.org'
  });

  await github.release({
    version: '1'
  });

  t.is(GithubApiStub.callCount, 1);
  t.is(GithubApiStub.firstCall.args[0].url, 'https://my-custom-host.org/api/v3');
});
