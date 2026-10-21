import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { isAbsolute } from 'node:path'

async function checkPublish() {
  const root = process.cwd()
  const npmPath = process.env.npm_execpath
  if (!npmPath || !isAbsolute(npmPath)) {
    throw new Error('npm_execpath is unavailable. Run this check through npm before publishing.')
  }
  const npmRequire = createRequire(npmPath)
  const PackageJson = npmRequire('@npmcli/package-json')
  const git = (...args) => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  const head = git('rev-parse', '--verify', 'HEAD')
  const pkg = await PackageJson.fix(root)
  const { content } = await pkg.prepare()
  if (content.gitHead !== head) {
    throw new Error(`npm prepared gitHead ${JSON.stringify(content.gitHead ?? null)} instead of HEAD ${head}. Publish from an ordinary git clone with a .git directory; do not use a linked worktree.`)
  }
  console.log(`Publish source verified: ${content.name}@${content.version} gitHead=${head}`)
}

try {
  await checkPublish()
} catch (error) {
  console.error(`Publish source check failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
