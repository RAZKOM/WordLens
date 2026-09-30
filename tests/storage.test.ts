import { describe, expect, it } from 'vitest'
import { EMPTY_STATS } from '../src/game'
import { KEYS, Storage, parseCount, parseDist, parseRound, serializeRound, type KeyValueStore } from '../src/storage'

class MemKV implements KeyValueStore {
  data = new Map<string, string>()
  async get(k: string) {
    return this.data.get(k) ?? ''
  }
  async set(k: string, v: string) {
    this.data.set(k, v)
    return true
  }
}

describe('storage parsing', () => {
  it('counts fall back to 0 on garbage', () => {
    expect(parseCount('12')).toBe(12)
    for (const bad of ['', 'abc', '-3', '1.5', 'NaN', '99999999999', undefined, null]) expect(parseCount(bad as never)).toBe(0)
  })

  it('round round-trips and rejects malformed JSON', () => {
    const r = { target: 'crane', guesses: ['slate'], typed: 'cr' }
    expect(parseRound(serializeRound(r))).toEqual(r)
    for (const bad of ['', '{', '[]', '{"v":2}', '{"v":1,"target":"CRANE","guesses":[]}', '{"v":1,"target":"crane","guesses":["x"]}'])
      expect(parseRound(bad)).toBeNull()
    expect(parseRound('{"v":1,"target":"crane","guesses":[],"typed":"TOOLONGX"}')).toEqual({ target: 'crane', guesses: [], typed: '' })
  })

  it('distribution round-trips and rejects malformed values', async () => {
    const kv = new MemKV()
    const st = new Storage(kv)
    await st.saveStats({ ...EMPTY_STATS, played: 4, wins: 3, dist: [1, 0, 2, 0, 0, 0, 1], last: 2 })
    expect((await st.load()).stats).toMatchObject({ dist: [1, 0, 2, 0, 0, 0, 1], last: 2 })
    for (const bad of ['', 'x', '{"v":1,"counts":[1,2]}', '{"v":1,"counts":[1,2,3,4,5,6,-1]}', '{"v":2,"counts":[0,0,0,0,0,0,0]}'])
      expect(parseDist(bad)).toEqual({ dist: [0, 0, 0, 0, 0, 0, 0], last: null })
    expect(parseDist('{"v":1,"counts":[0,0,0,0,0,0,0],"last":9}').last).toBeNull()
  })

  it('loads defaults from an empty store and repairs impossible stats', async () => {
    const kv = new MemKV()
    expect((await new Storage(kv).load()).stats).toEqual(EMPTY_STATS)
    kv.data.set(KEYS.streak, '5')
    kv.data.set(KEYS.best, '2')
    kv.data.set(KEYS.wins, '9')
    kv.data.set(KEYS.played, '3')
    expect((await new Storage(kv).load()).stats).toMatchObject({ streak: 5, best: 5, played: 9, wins: 9 })
  })

  it('survives a store that throws', async () => {
    const kv: KeyValueStore = {
      get: async () => {
        throw new Error('boom')
      },
      set: async () => {
        throw new Error('boom')
      },
    }
    const s = new Storage(kv)
    await expect(s.load()).resolves.toMatchObject({ round: null, deck: null })
    await expect(s.saveStats({ ...EMPTY_STATS, played: 1 })).resolves.toBeUndefined()
  })
})
