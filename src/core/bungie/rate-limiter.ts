export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private queue: Array<() => void> = [];

  constructor(private readonly tokensPerSecond: number, private readonly burstSize: number) {
    this.tokens = burstSize;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.burstSize, this.tokens + elapsed * this.tokensPerSecond);
    this.lastRefill = now;
  }

  acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  private scheduleDrain(): void {
    const msPerToken = 1000 / this.tokensPerSecond;
    setTimeout(() => this.drain(), msPerToken);
  }

  private drain(): void {
    this.refill();
    while (this.queue.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
    if (this.queue.length > 0) this.scheduleDrain();
  }
}

export const bungieRateLimiter = new RateLimiter(10, 20);
