/**
 * Store-listing play screenshots from evenhub-simulator: the keyboard's letters are firmware text, which only
 * the simulator (or the glasses) draws. Each shot starts the app on a fixed round (`?demo=`, see src/demo.ts),
 * optionally sends gestures, and saves the glasses screenshot (green on transparent, 576×288, like the
 * code-rendered help and stats shots from listing-shots.ts).
 *   npx tsx scripts/listing-sim.ts
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const OUT = 'docs/screenshots'
const PORT = 5173
const API = 'http://127.0.0.1:9898/api'

type Input = 'up' | 'down' | 'click'
interface Shot {
  name: string
  /** target:guesses (dot-separated):typed */
  demo: string
  focus: string
  /** Gestures after start, e.g. a click on ENTER to show the win or loss message. */
  inputs?: Input[]
}

const SHOTS: Shot[] = [
  { name: '01-playing', demo: 'crane:slate.eerie:cra', focus: 'N' },
  { name: '02-win', demo: 'crane:slate.eerie:crane', focus: 'ENTER', inputs: ['click'] },
  { name: '03-not-in-list', demo: 'crane:slate:xxxxx', focus: 'ENTER', inputs: ['click'] },
  { name: '06-mid-guess', demo: 'crane:slate:mo', focus: 'U' },
  { name: '07-mid-guess-late', demo: 'crane:slate.mourn.eerie:cr', focus: 'A' },
  { name: '08-winner', demo: 'crane:slate.mourn.eerie:crane', focus: 'ENTER', inputs: ['click'] },
  { name: '09-loser', demo: 'abbey:slate.crane.mourn.ghoul.fizzy:wacky', focus: 'ENTER', inputs: ['click'] },
]

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const procs: ChildProcess[] = []
process.on('exit', () => procs.forEach((p) => p.kill()))

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      /* not up yet */
    }
    await sleep(500)
  }
  throw new Error(`timed out waiting for ${url}`)
}

function simBinary(): string {
  const require = createRequire(import.meta.url)
  const pkg = `@evenrealities/sim-${process.platform}-${process.arch}`
  const exe = join(dirname(require.resolve(`${pkg}/package.json`)), 'bin', process.platform === 'win32' ? 'evenhub-simulator.exe' : 'evenhub-simulator')
  if (!existsSync(exe)) throw new Error(`simulator binary not found at ${exe}`)
  return exe
}

mkdirSync(OUT, { recursive: true })
procs.push(spawn(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }))
await waitFor(`http://localhost:${PORT}/`)

for (const shot of SHOTS) {
  const url = `http://localhost:${PORT}/?demo=${shot.demo}&focus=${shot.focus}`
  const sim = spawn(simBinary(), [url, '--automation-port', '9898', '--no-glow'], { stdio: 'ignore' })
  await waitFor(`${API}/ping`)
  await sleep(4000)
  for (const action of shot.inputs ?? []) {
    await fetch(`${API}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    await sleep(2000)
  }
  const png = new Uint8Array(await (await fetch(`${API}/screenshot/glasses`)).arrayBuffer())
  writeFileSync(join(OUT, `${shot.name}.png`), png)
  console.log(`${OUT}/${shot.name}.png`)
  sim.kill()
  // The automation port must be free before the next simulator starts.
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`${API}/ping`)
      await sleep(300)
    } catch {
      break
    }
  }
}
process.exit(0)
