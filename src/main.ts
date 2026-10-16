import {
  AudioInputSource,
  CreateStartUpPageContainer,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import { Wordlens, type Host } from './controller'
import { EV, type RawEvent } from './input'
import { DEFAULT_SETTINGS, NAMES, VOICE, type Settings } from './config'
import { demoFromUrl } from './demo'
import type { EngineStatus } from './voice/engine'
import { fakeMic } from './voice/fakemic'
import { VoiceSession, type Mic, type Recognizer } from './voice/session'

// input.ts mirrors the SDK enum to stay SDK-free for tests; fail loudly if they drift.
const ENUM_PAIRS: Array<[number, number]> = [
  [EV.CLICK, OsEventTypeList.CLICK_EVENT],
  [EV.SCROLL_TOP, OsEventTypeList.SCROLL_TOP_EVENT],
  [EV.SCROLL_BOTTOM, OsEventTypeList.SCROLL_BOTTOM_EVENT],
  [EV.DOUBLE_CLICK, OsEventTypeList.DOUBLE_CLICK_EVENT],
  [EV.FOREGROUND_ENTER, OsEventTypeList.FOREGROUND_ENTER_EVENT],
  [EV.FOREGROUND_EXIT, OsEventTypeList.FOREGROUND_EXIT_EVENT],
  [EV.ABNORMAL_EXIT, OsEventTypeList.ABNORMAL_EXIT_EVENT],
  [EV.SYSTEM_EXIT, OsEventTypeList.SYSTEM_EXIT_EVENT],
  [EV.LONG_PRESS, OsEventTypeList.LONG_PRESS_EVENT],
  [EV.LONG_PRESS_RELEASE, OsEventTypeList.LONG_PRESS_RELEASE_EVENT],
]
for (const [ours, sdk] of ENUM_PAIRS) if (ours !== sdk) throw new Error(`event enum drift: ${ours} != ${sdk}`)

/**
 * Settings: DEFAULT_SETTINGS in config.ts, optionally overridden by URL
 * parameters for quick testing, e.g. ?picker=horizontal&order=alphabetical&board=left&hold=talk (picker:
 * keyboard, vertical or horizontal; hold: delete or talk; keys: full or controls; hold and keys also win
 * over the saved menu choices)
 */
function overridesFromUrl(): Partial<Settings> {
  const q = new URLSearchParams(location.search)
  const s: Partial<Settings> = {}
  const picker = q.get('picker')
  const order = q.get('order')
  const board = q.get('board')
  const hold = q.get('hold')
  const keys = q.get('keys')
  if (picker === 'keyboard' || picker === 'vertical' || picker === 'horizontal') s.picker = picker
  if (order === 'frequency' || order === 'alphabetical') s.letterOrder = order
  if (board === 'left' || board === 'right') s.boardSide = board
  if (hold === 'delete' || hold === 'talk') s.hold = hold
  if (keys === 'full' || keys === 'controls') s.keys = keys
  return s
}
const overrides = overridesFromUrl()
const settings: Settings = { ...DEFAULT_SETTINGS, ...overrides }

// ── Phone companion view: mirrors the frames sent to the glasses. ──
const statusEl = document.getElementById('status')
const leftImg = document.getElementById('mirror-left') as HTMLImageElement | null
const rightImg = document.getElementById('mirror-right') as HTMLImageElement | null
const mirror: Record<string, HTMLImageElement | null> = {
  [NAMES.board]: settings.boardSide === 'right' ? rightImg : leftImg,
  [NAMES.keys]: settings.boardSide === 'right' ? leftImg : rightImg,
  [NAMES.kbLeft]: document.getElementById('mirror-kb-left') as HTMLImageElement | null,
  [NAMES.kbRight]: document.getElementById('mirror-kb-right') as HTMLImageElement | null,
}
const kbTextEl = document.getElementById('mirror-kb-text')
/** Keyboard mode: the keyboard text, over the key-frame images on the phone page. */
function mirrorText(content: string): void {
  if (kbTextEl) kbTextEl.textContent = content
}
const kbBand = document.getElementById('mirror-kb')
if (kbBand) kbBand.hidden = settings.picker !== 'keyboard'
/** A page build carries the keyboard text too. */
function mirrorPage(c: { textObject?: Array<Record<string, unknown>> }): void {
  const kb = c.textObject?.find((t) => t.containerName === NAMES.kbText)
  if (typeof kb?.content === 'string') mirrorText(kb.content)
}
let mainStatus = ''
let voiceStatus = ''
function setStatus(text: string): void {
  mainStatus = text
  if (statusEl) statusEl.textContent = voiceStatus ? `${mainStatus} ${voiceStatus}` : mainStatus
}
const VOICE_STATUS: Record<EngineStatus, string> = {
  idle: '',
  loading: 'Voice: loading the model…',
  ready: 'Voice: ready.',
  failed: 'Voice: the model failed to load (npm run voice-model).',
}
function setVoiceStatus(s: EngineStatus, detail?: string): void {
  voiceStatus = VOICE_STATUS[s]
  if (detail) console.info(`[wordlens] voice model ${s}: ${detail}`)
  setStatus(mainStatus)
}
function mirrorFrame(name: string, bytes: Uint8Array): void {
  const img = mirror[name]
  if (!img) return
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }))
  const old = img.src
  img.src = url
  if (old.startsWith('blob:')) URL.revokeObjectURL(old)
}

setStatus('Connecting to your glasses…')
const bridge = await waitForEvenAppBridge()

// Push-to-talk: the glasses mic is open only while a hold lasts; recognition runs offline on the phone.
// The engine (~6 MB of WebAssembly) is a separate chunk, loaded only once push-to-talk is switched on.
type Engine = import('./voice/engine').VoskEngine
let enginePromise: Promise<Engine> | null = null
function loadEngine(): Promise<Engine> {
  enginePromise ??= import('./voice/engine').then(
    (m) => new m.VoskEngine(new URL(VOICE.modelPath, location.href).href, setVoiceStatus),
    (err: unknown) => {
      enginePromise = null
      setVoiceStatus('failed', String(err))
      throw err
    },
  )
  return enginePromise
}
const engine: Recognizer = {
  prepare: () => void loadEngine().then((e) => e.prepare(), () => {}),
  recognise: async (samples, typedLen) => (await loadEngine()).recognise(samples, typedLen),
}
const glassesMic: Mic = {
  open: () => bridge.audioControl(true, AudioInputSource.Glasses),
  close: () => bridge.audioControl(false),
}
// Dev only: ?fakemic=<wav url> plays a recording instead of the mic (see fakemic.ts).
const fakeMicUrl = new URLSearchParams(location.search).get('fakemic')
const voice: VoiceSession = new VoiceSession(
  fakeMicUrl ? fakeMic(fakeMicUrl, (frame) => voice.push(frame)) : glassesMic,
  engine,
)

const host: Host = {
  async createPage(c) {
    mirrorPage(c)
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(c as never))
    return result === StartUpPageCreateResult.success
  },
  async rebuildPage(c) {
    mirrorPage(c)
    return bridge.rebuildPageContainer(new RebuildPageContainer(c as never))
  },
  async sendImage(target, bytes) {
    const result = await bridge.updateImageRawData(
      new ImageRawDataUpdate({
        containerID: target.containerID,
        containerName: target.containerName,
        imageData: bytes,
      }),
    )
    const ok = result === ImageRawDataUpdateResult.success
    if (ok) mirrorFrame(target.containerName, bytes)
    else console.warn('[wordlens] updateImageRawData:', result)
    return ok
  },
  async updateText(target, content) {
    const ok = await bridge.textContainerUpgrade(
      new TextContainerUpgrade({ containerID: target.containerID, containerName: target.containerName, content }),
    )
    if (ok) mirrorText(content)
    return ok
  },
  shutDown: (mode) => bridge.shutDownPageContainer(mode),
  kv: {
    get: (key) => bridge.getLocalStorage(key),
    set: (key, value) => bridge.setLocalStorage(key, value),
  },
  voice,
}

// Dev only (store screenshots): ?demo=… plays a fixed round from memory; see demo.ts.
const demo = await demoFromUrl(location.search)
if (demo) host.kv = demo.kv
const app = new Wordlens(host, { settings: overrides })
if (demo) app.kbFocus = demo.focus
const unsubscribe = bridge.onEvenHubEvent((event) => {
  if (event.audioEvent) {
    voice.push(event.audioEvent.audioPcm)
    return
  }
  app.handle(event as RawEvent)
  const sys = event.sysEvent
  if (sys && (sys.eventType === OsEventTypeList.SYSTEM_EXIT_EVENT || sys.eventType === OsEventTypeList.ABNORMAL_EXIT_EVENT)) {
    unsubscribe()
  }
})

await app.start()
setStatus('Ready. Play on your glasses.')
