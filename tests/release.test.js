import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releasePlan, runRelease } from '../scripts/release.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const {version}=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

test('release dry run defaults to the package version without invoking Docker', () => {
  const plan=releasePlan(['--dry-run'],{version,env:{GHCR_IMAGE:'ghcr.io/OWNER/FreeMemes'}}),output=[];
  assert.equal(runRelease(plan,()=>assert.fail('Dry runs must never invoke Docker'),text=>output.push(text)),0);
  assert.ok(output.join('\n').includes(`ghcr.io/owner/freememes:${version}`));
  assert.match(output.join('\n'),/ghcr\.io\/owner\/freememes:latest/);
  assert.match(output.join('\n'),/docker buildx build --platform linux\/amd64,linux\/arm64/);
  assert.match(output.join('\n'),/--push \./);
});

test('stable release dispatches version and latest tags to multi-platform Buildx with repository metadata', () => {
  const plan=releasePlan(['v2.3.4'],{repository:'Owner/FreeMemes',revision:'abc123',env:{NODE_VERSION:'24.21.0',YT_DLP_VERSION:'2026.10.26'}}),output=[];
  let call;
  assert.equal(runRelease(plan,(...args)=>{call=args;return {status:0};},text=>output.push(text)),0);
  const [command,args,options]=call;
  assert.equal(command,'docker');assert.equal(path.resolve(options.cwd),path.resolve(root));assert.equal(options.stdio,'inherit');assert.equal(options.shell,undefined);
  assert.deepEqual(args.slice(0,5),['buildx','build','--platform','linux/amd64,linux/arm64','--pull']);
  const tags=args.flatMap((value,index)=>value==='--tag' ? [args[index+1]] : []);
  assert.deepEqual(tags,['ghcr.io/owner/freememes:v2.3.4','ghcr.io/owner/freememes:latest']);
  assert.ok(args.includes('org.opencontainers.image.source=https://github.com/Owner/FreeMemes'));
  assert.ok(args.includes('org.opencontainers.image.version=v2.3.4'));assert.ok(args.includes('org.opencontainers.image.revision=abc123'));
  assert.ok(args.includes('NODE_VERSION=24.21.0'));assert.ok(args.includes('YT_DLP_VERSION=2026.10.26'));
  assert.deepEqual(args.slice(-2),['--push','.']);assert.match(output.join('\n'),/Published:/);
});

test('prerelease and custom tags leave latest alone and honor image/platform overrides', () => {
  for(const tag of ['2.3.4-rc.1','preview','latest']){
    const plan=releasePlan([tag],{env:{GHCR_IMAGE:'ghcr.io/MyOrg/MyImage',RELEASE_PLATFORMS:'linux/arm64'}});
    assert.deepEqual(plan.images,[`ghcr.io/myorg/myimage:${tag}`]);
    assert.equal(plan.command[plan.command.indexOf('--platform')+1],'linux/arm64');
  }
});

test('failed builds preserve Docker exit codes without reporting a published release', () => {
  const plan=releasePlan(['2.3.4']),output=[];
  assert.equal(runRelease(plan,()=>({status:42}),text=>output.push(text)),42);
  assert.doesNotMatch(output.join('\n'),/Published:/);
  assert.equal(runRelease(plan,()=>({status:null,signal:'SIGTERM'}),()=>{}),1);
  assert.throws(()=>runRelease(plan,()=>({error:new Error('ENOENT')}),()=>{}),/Install Docker with Buildx/);
});

test('invalid release arguments are rejected before a publish plan can be run', () => {
  for(const [args,env] of [[['bad:tag'],{}],[['1.0.0','2.0.0'],{}],[['--push'],{}],[['1.0.0'],{GHCR_IMAGE:'docker.io/owner/image'}],[['1.0.0'],{RELEASE_PLATFORMS:'not-a-platform'}]])assert.throws(()=>releasePlan(args,{env}),Error);
});

test('release help is available without invoking Docker', () => {
  const output=[];
  assert.equal(runRelease(releasePlan(['--help']),()=>assert.fail('Help must never invoke Docker'),text=>output.push(text)),0);
  assert.match(output.join('\n'),/Usage: npm run release/);
});
