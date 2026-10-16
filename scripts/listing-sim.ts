/**
 * Store-listing play screenshots from evenhub-simulator: the keyboard's letters are firmware text, which only
 * the simulator (or the glasses) draws. Each shot starts the app on a fixed round (`?demo=`, see src/demo.ts),
 * optionally sends gestures, and saves the glasses screenshot (green on transparent, 576×288, like the
 * code-rendered help and stats shots from listing-shots.ts).
 *
 * Voice shots play a recorded word through `?fakemic=` (src/voice/fakemic.ts). The clip is made with macOS
 * `say` into previews/ (not committed) and needs the speech model (npm run voice-model).
 *   npx tsx scripts/listing-sim.ts
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const OUT = 'docs/screenshots'
const PORT = 5173
const API = 'http://127.0.0.1:9898/api'

type Input = 'up' | 'down' | 'click' | 'long_press' | 'long_press_release' | 'context_menu'
interface Shot {
  name: string
  /** target:guesses (dot-separated):typed */
  demo: string
  focus: string
  /** Gestures after start, e.g. a click on ENTER to show the win or loss message. */
  inputs?: Input[]
  /** Extra URL parameters, e.g. keys=controls. */
  params?: string
  /** Plays VOICE_CLIP through the fake mic; waits for the speech model before the gestures. */
  voice?: boolean
  /** Wait after the last gesture (default 2000 ms). */
  settleMs?: number
}

const VOICE_CLIP = 'previews/audio/listing-crane.wav'

const SHOTS: Shot[] = [
  { name: '01-playing', demo: 'crane:slate.eerie:cra', focus: 'N' },
  { name: '02-win', demo: 'crane:slate.eerie:crane', focus: 'ENTER', inputs: ['click'] },
  { name: '03-not-in-list', demo: 'crane:slate:xxxxx', focus: 'ENTER', inputs: ['click'] },
  // Help, opened from the OS menu: Enter guess, Backspace, Hold to delete, Enter and Del only, Help.
  { name: '04-help', demo: 'crane:slate:', focus: 'Q', inputs: ['context_menu', 'down', 'down', 'down', 'down', 'click'] },
  { name: '06-mid-guess', demo: 'crane:slate:mo', focus: 'U' },
  { name: '07-mid-guess-late', demo: 'crane:slate.mourn.eerie:cr', focus: 'A' },
  { name: '08-winner', demo: 'crane:slate.mourn.eerie:crane', focus: 'ENTER', inputs: ['click'] },
  { name: '09-loser', demo: 'abbey:slate.crane.mourn.ghoul.fizzy:wacky', focus: 'ENTER', inputs: ['click'] },
  { name: '10-voice-listening', demo: 'crane:slate.mourn:', focus: 'Q', voice: true, inputs: ['long_press'], settleMs: 700 },
  { name: '11-voice-choices', demo: 'crane:slate.mourn:', focus: 'Q', voice: true, inputs: ['long_press', 'long_press_release'], settleMs: 3000 },
  { name: '12-controls', demo: 'crane:slate.mourn:', focus: 'Q', params: 'keys=controls' },
  { name: '13-controls-choices', demo: 'crane:slate.mourn:', focus: 'Q', params: 'keys=controls', voice: true, inputs: ['long_press', 'long_press_release'], settleMs: 3000 },
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
if (SHOTS.some((s) => s.voice) && !existsSync(VOICE_CLIP)) {
  mkdirSync(dirname(VOICE_CLIP), { recursive: true })
  execFileSync('say', ['-v', 'Samantha', '-o', VOICE_CLIP, '--data-format=LEI16@16000', 'crane'])
}

/** Wait until the page logs that the speech model is loaded (and warmed). */
async function voiceReady(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const log = await (await fetch(`${API}/console`)).text()
    if (log.includes('voice model ready')) return
    if (log.includes('voice model failed')) throw new Error('speech model failed to load: run npm run voice-model')
    await sleep(500)
  }
  throw new Error('timed out waiting for the speech model')
}
procs.push(spawn(process.execPath, [join('node_modules', 'vite', 'bin', 'vite.js'), '--port', String(PORT), '--strictPort'], { stdio: 'ignore' }))
await waitFor(`http://localhost:${PORT}/`)

for (const shot of SHOTS) {
  const extra = [shot.params, shot.voice ? `fakemic=/${VOICE_CLIP}` : ''].filter(Boolean).join('&')
  const url = `http://localhost:${PORT}/?demo=${shot.demo}&focus=${shot.focus}${extra ? `&${extra}` : ''}`
  const sim = spawn(simBinary(), [url, '--automation-port', '9898', '--no-glow'], { stdio: 'ignore' })
  await waitFor(`${API}/ping`)
  await sleep(4000)
  if (shot.voice) await voiceReady()
  const inputs = shot.inputs ?? []
  for (const [i, action] of inputs.entries()) {
    await fetch(`${API}/input`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) })
    // A hold lasts long enough for the fake mic to play the clip before the release.
    const between = action === 'long_press' ? 1200 : action === 'down' ? 400 : action === 'context_menu' ? 1000 : 2000
    await sleep(i === inputs.length - 1 ? (shot.settleMs ?? 2000) : between)
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
