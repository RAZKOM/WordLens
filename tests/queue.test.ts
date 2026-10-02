import { describe, expect, it } from 'vitest'
import { CommandQueue, type ImageTarget } from '../src/imageQueue'

const A: ImageTarget = { containerID: 1, containerName: 'a' }
const B: ImageTarget = { containerID: 2, containerName: 'b' }
const bytes = (n: number) => () => new Uint8Array([n])

function harness(fail: (n: number) => boolean = () => false) {
  const log: string[] = []
  let inFlight = 0
  let maxInFlight = 0
  const q = new CommandQueue(
    async (t, b) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight--
      log.push(`${t.containerName}${b[0]}`)
      return !fail(b[0])
    },
    {
      gapMs: 100,
      retryMs: 300,
      sleep: async () => {},
      sendText: async (t, c) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await Promise.resolve()
        inFlight--
        log.push(`${t.containerName}:${c}`)
        return true
      },
    },
  )
  return { q, log, max: () => maxInFlight }
}

describe('CommandQueue', () => {
  it('coalesces pending frames per container and never overlaps sends', async () => {
    const { q, log, max } = harness()
    q.image(A, bytes(1))
    q.image(A, bytes(2)) // replaces nothing: frame 1 is already in flight
    q.image(A, bytes(3)) // replaces pending frame 2
    q.image(B, bytes(1))
    await q.idle()
    expect(log).toEqual(['a1', 'a3', 'b1'])
    expect(max()).toBe(1)
  })

  it('text updates coalesce and jump ahead of waiting frames, but not of ops', async () => {
    const { q, log, max } = harness()
    q.image(A, bytes(1)) // in flight
    q.image(B, bytes(1)) // waiting
    q.text(A, () => 'x')
    q.text(A, () => 'y') // replaces 'x'
    await q.idle()
    expect(log).toEqual(['a1', 'a:y', 'b1'])
    const ran: string[] = []
    q.image(A, bytes(2))
    void q.op(async () => void ran.push('op'))
    q.text(A, () => 'z')
    await q.idle()
    expect(ran).toEqual(['op'])
    expect(log.slice(3)).toEqual(['a2', 'a:z'])
    expect(max()).toBe(1)
  })

  it('an op drops frames queued before it and runs exclusively', async () => {
    const { q, log } = harness()
    q.image(A, bytes(1))
    q.image(B, bytes(1))
    q.image(A, bytes(2))
    const op = q.op(async () => {
      log.push('rebuild')
    })
    q.image(A, bytes(9))
    await op
    await q.idle()
    expect(log).toEqual(['a1', 'rebuild', 'a9'])
  })

  it('retries a failed frame once, then drops it', async () => {
    const { q, log } = harness((n) => n === 7)
    q.image(A, bytes(7))
    await q.idle()
    expect(log).toEqual(['a7', 'a7'])
  })
})
