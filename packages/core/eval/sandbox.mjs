// Where the eval agent's shell commands (its Bash tool) and the hidden acceptance tests run: an
// isolated environment that can see the task's repository and nothing else of this machine, and
// can't reach the network. See docs/design/round-2-scoring-and-evaluation.md for what each backend
// does and doesn't prevent.
//
// Backends, strongest first. `auto` picks the first one that is available here:
// - docker:       a container per command: no network, read-only root filesystem, no capabilities,
//                 memory/process limits, only the repository mounted. Used by `auto` only when the
//                 image is already present (`docker pull node:22-bookworm` once); set
//                 CTXJEV_SANDBOX=docker to let docker pull it.
// - bwrap:        bubblewrap (Linux): new namespaces, a root built from read-only system directories.
// - unshare:      the same with util-linux `unshare` and `chroot` (Linux, user namespaces).
// - sandbox-exec: macOS's built-in sandbox profile language: no network, no reads under the home
//                 directory or the temp directory except the repository, writes only there.
// - none:         no isolation. Only with CTXJEV_SANDBOX=none, never picked by `auto`.
//
// Whatever the backend, probeSandbox() checks it before an agent runs: the repository is readable
// and writable, node and git work, and a file outside the repository, the home directory, this
// checkout (where .env.local keeps the API keys), and the network are all out of reach. An agent
// run refuses to start if any check fails, so a backend that doesn't do what it says (a macOS
// profile rule written wrong, say) fails closed instead of running the agent unconfined.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_DOCKER_IMAGE = 'node:22-bookworm'
const BACKENDS = ['docker', 'bwrap', 'unshare', 'sandbox-exec', 'none']
const checkout = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '../../..'))

// Node's own install, wherever it is (/usr, /opt/node22, a version manager's directory): mounted
// read-only so `node` works inside, and nothing else under its parent.
const nodePrefix = dirname(dirname(realpathSync(process.execPath)))
const INNER_PATH = [...new Set([join(nodePrefix, 'bin'), '/usr/local/bin', '/usr/bin', '/bin'])].join(':')

const works = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: 20_000 })
  return r.status === 0
}

function available(name, image) {
  switch (name) {
    case 'docker':
      return works('docker', ['info']) && works('docker', ['image', 'inspect', image])
    case 'bwrap':
      return process.platform === 'linux' && works('bwrap', ['--ro-bind', '/', '/', '--unshare-all', 'true'])
    case 'unshare':
      return process.platform === 'linux' && works('unshare', ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', 'true'])
    case 'sandbox-exec':
      return process.platform === 'darwin' && works('sandbox-exec', ['-p', '(version 1)(allow default)', 'true'])
    default:
      return false
  }
}

/**
 * The sandbox to run agent commands in. `CTXJEV_SANDBOX` picks a backend (default `auto`);
 * `CTXJEV_SANDBOX_IMAGE` the docker image.
 */
export function createSandbox({ backend = process.env.CTXJEV_SANDBOX ?? 'auto', image = process.env.CTXJEV_SANDBOX_IMAGE ?? DEFAULT_DOCKER_IMAGE } = {}) {
  let name = backend
  if (backend === 'auto') {
    name = BACKENDS.find((b) => b !== 'none' && available(b, image))
    if (!name) {
      throw new Error(
        'no sandbox available for the eval agent: install Docker and run `docker pull node:22-bookworm` (any OS), or bubblewrap (Linux), or allow user namespaces (Linux); ' +
          'CTXJEV_SANDBOX=none runs without isolation (see docs/design/round-2-scoring-and-evaluation.md)',
      )
    }
  } else if (!BACKENDS.includes(backend)) {
    throw new Error(`CTXJEV_SANDBOX must be auto or one of ${BACKENDS.join(', ')}, got ${backend}`)
  }
  return { name, image, run: (command, options) => runIn(name, image, command, options) }
}

/**
 * Runs `command` with bash in `repo` (its working directory; readable and writable, at the same
 * path as outside), with `readOnly` paths visible read-only too. Returns spawnSync's result:
 * `status`, `stdout`, `stderr`, and `error` (ETIMEDOUT past `timeoutMs`).
 */
function runIn(name, image, command, { repo, readOnly = [], env = {}, timeoutMs = 60_000 }) {
  const innerEnv = { PATH: INNER_PATH, HOME: repo, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', ...env }
  const spawn = (cmd, args, extra = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, killSignal: 'SIGKILL', ...extra })

  if (name === 'none') return spawn('bash', ['-c', command], { cwd: repo, env: innerEnv })

  if (name === 'docker') {
    const uid = typeof process.getuid === 'function' ? [`--user`, `${process.getuid()}:${process.getgid()}`] : []
    const args = [
      'run', '--rm', '-i', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--pids-limit', '256', '--memory', '1g', '--cpus', '2', '--tmpfs', '/tmp:rw,size=256m', ...uid,
      '-v', `${repo}:${repo}`, ...readOnly.flatMap((p) => ['-v', `${p}:${p}:ro`]), '-w', repo,
      ...Object.entries({ ...innerEnv, PATH: '/usr/local/bin:/usr/bin:/bin' }).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      ...(process.env.CTXJEV_SANDBOX === 'docker' ? [] : ['--pull', 'never']),
      image, 'timeout', '-s', 'KILL', String(Math.ceil(timeoutMs / 1000)), 'bash', '-c', command,
    ]
    return spawn('docker', args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_HOST: process.env.DOCKER_HOST } })
  }

  if (name === 'bwrap') {
    const ro = ['/usr', '/bin', '/sbin', '/lib', '/lib64', '/lib32', '/libx32', nodePrefix, ...ETC_FILES.map((f) => `/etc/${f}`), ...readOnly]
    const args = [
      '--unshare-all', '--die-with-parent', '--new-session', '--clearenv', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp',
      ...ro.flatMap((p) => ['--ro-bind-try', p, p]), '--bind', repo, repo, '--chdir', repo,
      ...Object.entries(innerEnv).flatMap(([k, v]) => ['--setenv', k, v]),
      'bash', '-c', command,
    ]
    return spawn('bwrap', args, { env: { PATH: process.env.PATH } })
  }

  if (name === 'unshare') {
    // A throwaway root in a new mount namespace: tmpfs, with system directories and node bound in
    // read-only, the repository read-write, a private /tmp and /proc, then chroot into it. The new
    // network namespace has no interface but a down loopback.
    const root = join(dirname(repo), '.sandbox-root')
    mkdirSync(root, { recursive: true })
    return spawn('unshare', ['--user', '--map-root-user', '--mount', '--net', '--pid', '--fork', '--kill-child', '--', '/bin/sh', '-c', UNSHARE_SETUP], {
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        SB_ROOT: root,
        SB_REPO: repo,
        SB_RO: readOnly.join('\n'),
        SB_NODE: nodePrefix,
        SB_ETC: ETC_FILES.join(' '),
        SB_CMD: command,
        SB_ENV: Object.entries(innerEnv).map(([k, v]) => `${k}=${v}`).join('\n'),
      },
    })
  }

  if (name === 'sandbox-exec') {
    const home = realpathSync(homedir())
    const tmp = realpathSync(tmpdir())
    const scratch = mkdtempSync(join(tmpdir(), 'ctxjev-sandbox-tmp-'))
    try {
      const q = (p) => JSON.stringify(realpathSync(p))
      // Later rules take precedence over earlier ones for the same operation.
      const profile = [
        '(version 1)',
        '(allow default)',
        '(deny network*)',
        `(deny file-read* (subpath ${JSON.stringify(home)}) (subpath ${JSON.stringify(tmp)}) (subpath ${q(checkout)}) (subpath "/Volumes"))`,
        '(deny file-write*)',
        `(allow file-read* (subpath ${q(repo)}) ${readOnly.map((p) => `(subpath ${q(p)})`).join(' ')} (subpath ${q(scratch)}) (subpath ${JSON.stringify(nodePrefix)}))`,
        `(allow file-write* (subpath ${q(repo)}) (subpath ${q(scratch)}) (literal "/dev/null") (literal "/dev/tty") (regex #"^/dev/fd/"))`,
      ].join('\n')
      return spawn('sandbox-exec', ['-p', profile, 'bash', '-c', command], { cwd: repo, env: { ...innerEnv, TMPDIR: scratch } })
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
  throw new Error(`unknown sandbox backend ${name}`)
}

// What a program needs from /etc to run (user names, the dynamic linker's cache, the time zone):
// never the whole directory, which can hold keys and password hashes.
const ETC_FILES = ['passwd', 'group', 'hosts', 'nsswitch.conf', 'ld.so.cache', 'localtime']

const UNSHARE_SETUP = String.raw`
set -e
R="$SB_ROOT"
mount -t tmpfs -o mode=755 tmpfs "$R"
robind() { mkdir -p "$R$1"; mount --rbind "$1" "$R$1"; mount -o remount,bind,ro "$R$1"; }
for d in /usr /bin /sbin /lib /lib64 /lib32 /libx32; do
  if [ -L "$d" ]; then ln -s "$(readlink "$d")" "$R$d"; elif [ -d "$d" ]; then robind "$d"; fi
done
case "$SB_NODE" in /usr|/usr/*) ;; *) robind "$SB_NODE" ;; esac
mkdir -p "$R/etc"
for f in $SB_ETC; do if [ -f "/etc/$f" ]; then touch "$R/etc/$f"; mount --bind "/etc/$f" "$R/etc/$f"; fi; done
mkdir -p "$R/dev"
for f in null zero random urandom; do touch "$R/dev/$f"; mount --bind "/dev/$f" "$R/dev/$f"; done
mkdir -p "$R/proc" && mount -t proc proc "$R/proc"
mkdir -p "$R/tmp" && mount -t tmpfs -o mode=1777 tmpfs "$R/tmp"
echo "$SB_RO" | while IFS= read -r p; do if [ -n "$p" ]; then robind "$p"; fi; done
mkdir -p "$R$SB_REPO" && mount --bind "$SB_REPO" "$R$SB_REPO"
set -f
OLDIFS="$IFS"; IFS='
'
set -- $SB_ENV
IFS="$OLDIFS"
exec chroot "$R" /usr/bin/env -i "$@" /bin/bash -c 'cd "$1" && eval "$2"' sandbox "$SB_REPO" "$SB_CMD"
`

/**
 * Checks `sandbox` does what it says, from inside it, before any agent runs. Returns the failed
 * checks, empty when everything holds.
 */
export function probeSandbox(sandbox) {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'ctxjev-sandbox-probe-')))
  const repo = join(work, 'repo')
  const outside = join(work, 'outside')
  mkdirSync(repo)
  mkdirSync(outside)
  writeFileSync(join(repo, 'inside.txt'), 'inside')
  writeFileSync(join(outside, 'secret.txt'), 'SECRET-OUTSIDE-THE-REPO')
  const failures = []
  const run = (command) => sandbox.run(command, { repo, timeoutMs: 30_000 })
  const expect = (label, command, ok) => {
    const r = run(command)
    if (!ok(r)) failures.push(`${label}: \`${command}\` gave status ${r.status}${r.error ? ` (${r.error.code})` : ''}: ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim().slice(0, 200)}`)
  }
  try {
    expect('reads the repository', 'cat inside.txt', (r) => r.status === 0 && r.stdout.includes('inside'))
    expect('writes the repository', 'echo written > new.txt && cat new.txt', (r) => r.status === 0 && r.stdout.includes('written'))
    expect('runs node and git', 'node -e "process.stdout.write(\'node ok\')" && git --version', (r) => r.status === 0 && r.stdout.includes('node ok') && r.stdout.includes('git version'))
    expect('cannot read a file outside the repository', `cat ${JSON.stringify(join(outside, 'secret.txt'))}`, (r) => !`${r.stdout}`.includes('SECRET-OUTSIDE'))
    // A file planted in the home directory for the check and removed right after.
    let homeProbe
    try {
      homeProbe = mkdtempSync(join(homedir(), '.ctxjev-sandbox-probe-'))
      writeFileSync(join(homeProbe, 'secret.txt'), 'SECRET-IN-HOME')
    } catch {
      failures.push(`could not plant a file in ${homedir()} to check it can't be read`)
    }
    if (homeProbe) {
      try {
        expect('cannot read a file in the home directory', `cat ${JSON.stringify(join(homeProbe, 'secret.txt'))}`, (r) => !`${r.stdout}`.includes('SECRET-IN-HOME'))
      } finally {
        rmSync(homeProbe, { recursive: true, force: true })
      }
    }
    expect("cannot read this checkout (where .env.local keeps the keys)", `cat ${JSON.stringify(join(checkout, 'package.json'))}`, (r) => r.status !== 0)
    expect('cannot write outside the repository', `echo x > ${JSON.stringify(join(outside, 'written.txt'))}`, (r) => r.status !== 0)
    expect(
      'cannot reach the network',
      `node -e "require('net').connect({host:'1.1.1.1',port:443}).on('connect',()=>process.exit(0)).on('error',()=>process.exit(3));setTimeout(()=>process.exit(4),5000)"`,
      (r) => r.status !== 0,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  return failures
}

/**
 * The sandbox an agent run uses: created, then probed. Throws if any check fails, so no agent runs
 * unconfined by accident. With CTXJEV_SANDBOX=none, says loudly that nothing is isolated instead.
 */
export function requireSandbox(log = (line) => process.stderr.write(`${line}\n`)) {
  const sandbox = createSandbox()
  if (sandbox.name === 'none') {
    log('WARNING: CTXJEV_SANDBOX=none: the agent\'s commands and the hidden tests run with no isolation, with this user\'s access to files and network.')
    return sandbox
  }
  const failures = probeSandbox(sandbox)
  if (failures.length > 0) {
    throw new Error(`the ${sandbox.name} sandbox failed its checks, so no agent will run:\n  ${failures.join('\n  ')}\nTry another backend (CTXJEV_SANDBOX=docker after \`docker pull ${DEFAULT_DOCKER_IMAGE}\`).`)
  }
  log(`sandbox: ${sandbox.name}${sandbox.name === 'docker' ? ` (${sandbox.image})` : ''}, all isolation checks passed`)
  return sandbox
}
