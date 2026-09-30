/**
 * The only path to `updateImageRawData`, and also where page rebuilds run, so an
 * image send and a rebuild can never overlap.
 *
 *  - One task in flight at a time; ≥ gapMs between image sends.
 *  - Image tasks coalesce per container: a newer frame replaces a pending one,
 *    and frames are rendered lazily at send time, so only the latest state is sent.
 *  - A rebuild drops pending image frames queued before it (those containers
 *    are about to be recreated); callers enqueue fresh frames after it.
 *  - A failed send is retried once after retryMs, unless a newer frame for the
 *    same container is already waiting; then it is dropped.
 */

export interface ImageTarget {
  containerID: number
  containerName: string
}

export type ImageSend = (target: ImageTarget, bytes: Uint8Array) => Promise<boolean>
export type Sleep = (ms: number) => Promise<void>

type Task =
  | { kind: 'image'; target: ImageTarget; render: () => Uint8Array }
  | { kind: 'op'; run: () => Promise<void> }

export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export class CommandQueue {
  private tasks: Task[] = []
  private running = false
  private idleWaiters: Array<() => void> = []
  private lastImageAt = -Infinity

  constructor(
    private send: ImageSend,
    private opts: { gapMs: number; retryMs: number; sleep?: Sleep; now?: () => number } = { gapMs: 100, retryMs: 300 },
  ) {}

  private get sleep(): Sleep {
    return this.opts.sleep ?? realSleep
  }
  private get now(): () => number {
    return this.opts.now ?? (() => Date.now())
  }

  /** Queue (or replace) the frame for one image container. */
  image(target: ImageTarget, render: () => Uint8Array): void {
    // Only coalesce with a pending frame that is after the last queued op.
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const t = this.tasks[i]
      if (t.kind === 'op') break
      if (t.target.containerID === target.containerID) {
        this.tasks[i] = { kind: 'image', target, render }
        return
      }
    }
    this.tasks.push({ kind: 'image', target, render })
    this.pump()
  }

  /** Queue an exclusive operation (a page rebuild). Pending frames before it are dropped. */
  op(run: () => Promise<void>): Promise<void> {
    this.tasks = this.tasks.filter((t) => t.kind === 'op')
    return new Promise<void>((resolve, reject) => {
      this.tasks.push({
        kind: 'op',
        run: async () => {
          try {
            await run()
            resolve()
          } catch (err) {
            reject(err)
          }
        },
      })
      this.pump()
    })
  }

  /** Resolves when nothing is queued or in flight. */
  idle(): Promise<void> {
    if (!this.running && this.tasks.length === 0) return Promise.resolve()
    return new Promise((r) => this.idleWaiters.push(r))
  }

  private hasNewerFrame(containerID: number): boolean {
    return this.tasks.some((t) => t.kind === 'image' && t.target.containerID === containerID)
  }

  private pump(): void {
    if (this.running) return
    this.running = true
    void this.drain()
  }

  private async drain(): Promise<void> {
    try {
      while (this.tasks.length > 0) {
        const task = this.tasks.shift()!
        if (task.kind === 'op') {
          await task.run()
          continue
        }
        const wait = this.lastImageAt + this.opts.gapMs - this.now()
        if (wait > 0) await this.sleep(wait)
        let ok = await this.trySend(task)
        this.lastImageAt = this.now()
        if (!ok && !this.hasNewerFrame(task.target.containerID)) {
          await this.sleep(this.opts.retryMs)
          if (!this.hasNewerFrame(task.target.containerID)) {
            ok = await this.trySend(task)
            this.lastImageAt = this.now()
          }
        }
        if (!ok) console.warn('[wordlens] dropped image frame', task.target.containerName)
      }
    } finally {
      this.running = false
      const waiters = this.idleWaiters
      this.idleWaiters = []
      waiters.forEach((w) => w())
    }
  }

  private async trySend(task: Extract<Task, { kind: 'image' }>): Promise<boolean> {
    try {
      return await this.send(task.target, task.render())
    } catch (err) {
      console.warn('[wordlens] image send threw', err)
      return false
    }
  }
}
