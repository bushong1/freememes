import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
const help=`Usage: npm run release -- [tag] [--dry-run]

Build and push FreeMemes to GHCR. The tag defaults to package.json's version.
Stable version tags (1.2.3 or v1.2.3) also publish :latest.
Prerelease and custom tags publish only that tag.

Environment:
  GHCR_IMAGE         Override the untagged image name (ghcr.io/owner/image).
  RELEASE_PLATFORMS  Default: linux/amd64,linux/arm64.
  NODE_VERSION      Optional Docker build argument.
  YT_DLP_VERSION    Optional Docker build argument.

Authenticate first with docker login ghcr.io. See README.md for setup.`;

export function releasePlan(args,{version,env={},repository='bushong1/freememes',revision=''}={}) {
  if(args.includes('--help') || args.includes('-h'))return {help:true};
  if(args.some(arg=>arg.startsWith('-') && arg!=='--dry-run'))throw new Error(`Unknown option.\n${help}`);
  const tags=args.filter(arg=>!arg.startsWith('-'));
  if(tags.length>1)throw new Error(`Provide one release tag.\n${help}`);
  const tag=tags[0] || version;
  if(!tag || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(tag))throw new Error('Invalid image tag. Use a Docker tag such as 1.2.3 or 1.2.3-rc.1.');
  const image=(env.GHCR_IMAGE || `ghcr.io/${repository}`).toLowerCase();
  if(!/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_./-]+$/.test(image))throw new Error('GHCR_IMAGE must be an untagged ghcr.io/owner/image reference.');
  const platforms=env.RELEASE_PLATFORMS || 'linux/amd64,linux/arm64';
  if(!/^[a-z0-9]+\/[a-z0-9_]+(?:\/[a-z0-9_.-]+)?(?:,[a-z0-9]+\/[a-z0-9_]+(?:\/[a-z0-9_.-]+)?)*$/.test(platforms))throw new Error('RELEASE_PLATFORMS must contain comma-separated Docker platforms, such as linux/amd64,linux/arm64.');

  const images=[`${image}:${tag}`];
  if(/^v?\d+\.\d+\.\d+$/.test(tag))images.push(`${image}:latest`);
  const command=['buildx','build','--platform',platforms,'--pull'];
  for(const imageTag of images)command.push('--tag',imageTag);
  command.push('--label',`org.opencontainers.image.source=https://github.com/${repository}`,'--label',`org.opencontainers.image.version=${tag}`);
  if(revision)command.push('--label',`org.opencontainers.image.revision=${revision}`);
  for(const name of ['NODE_VERSION','YT_DLP_VERSION'])if(env[name])command.push('--build-arg',`${name}=${env[name]}`);
  command.push('--push','.');
  return {dryRun:args.includes('--dry-run'),images,platforms,command};
}

export function runRelease(plan,run=spawnSync,log=console.log) {
  if(plan.help){log(help);return 0;}
  log(`${plan.dryRun ? 'Would publish' : 'Publishing'}:\n${plan.images.map(tag=>`  ${tag}`).join('\n')}\nPlatforms: ${plan.platforms}`);
  if(plan.dryRun){
    const quote=value=>/^[\w./,:=@-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
    log(['docker',...plan.command].map(quote).join(' '));return 0;
  }
  // Argument arrays avoid shell interpolation; Docker uses its existing login.
  const result=run('docker',plan.command,{cwd:root,stdio:'inherit'});
  if(result.error)throw new Error(`Could not start Docker: ${result.error.message}. Install Docker with Buildx and start its engine.`);
  if(result.status!==0)return result.status || 1;
  log(`Published:\n${plan.images.map(tag=>`  ${tag}`).join('\n')}`);return 0;
}

function git(...args) {
  try{return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
  catch{return '';}
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const origin=git('remote','get-url','origin');
    const repository=origin.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i)?.[1] || 'bushong1/freememes';
    const {version}=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
    process.exitCode=runRelease(releasePlan(process.argv.slice(2),{version,env:process.env,repository,revision:git('rev-parse','HEAD')}));
  } catch(error){console.error(error.message);process.exitCode=1;}
}
