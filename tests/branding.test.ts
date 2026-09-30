import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : [p]
  })
}

// "wordlens" itself contains "wordle" as a substring, so match the other
// brand only when it is not the start of our own name.
const OTHER_BRAND = /wordle(?!ns)/i

describe('branding', () => {
  it('no other-brand name anywhere that ships (src, index.html, app.json)', () => {
    for (const f of [...files('src'), 'index.html', 'app.json']) {
      expect(OTHER_BRAND.test(readFileSync(f, 'utf8')), f).toBe(false)
      expect(OTHER_BRAND.test(f), f).toBe(false)
    }
    const app = JSON.parse(readFileSync('app.json', 'utf8'))
    expect(app.package_id).toBe('com.razkom.wordlens')
    expect(app.name.length).toBeLessThanOrEqual(20)
  })
})
