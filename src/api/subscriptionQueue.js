// One queue per realtime client. Replacing a React lease never creates more workers.
export class SubscriptionQueue {
  constructor(attach, { concurrency = 6, isSubscribed = () => false,
    yieldTask = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
    this.attach = attach;
    this.concurrency = concurrency;
    this.isSubscribed = isSubscribed;
    this.yieldTask = yieldTask;
    this.topics = new Set();
    this.inFlight = new Map();
    this.attempted = new Set();
    this.paused = true;
    this.lease = 0;
    this.scheduled = false;
  }

  replace(topics) {
    const lease = ++this.lease;
    this.topics = new Set(topics.filter((topic) => typeof topic === 'string' && topic));
    this.attempted.clear();
    this.schedule();
    return () => { if (this.lease === lease) this.clear(); };
  }

  clear() { this.lease++; this.topics.clear(); this.attempted.clear(); }
  pause() { this.paused = true; }
  resume() { this.paused = false; this.attempted.clear(); this.schedule(); }

  schedule() {
    if (this.paused || this.scheduled || !this.topics.size || this.inFlight.size >= this.concurrency) return;
    this.scheduled = true;
    // Yield before the first batch too, so foreground messages/calls and paint can run.
    Promise.resolve().then(() => this.yieldTask()).then(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  pump() {
    if (this.paused) return;
    for (const topic of this.topics) {
      if (this.inFlight.size >= this.concurrency) break;
      if (this.inFlight.has(topic) || this.attempted.has(topic) || this.isSubscribed(topic)) continue;
      this.attempted.add(topic);
      const lease = this.lease;
      const request = Promise.resolve().then(() => {
        if (!this.paused && this.lease === lease && this.topics.has(topic)) return this.attach(topic);
      });
      this.inFlight.set(topic, request);
      request.catch(() => {}).finally(() => {
        if (this.inFlight.get(topic) === request) this.inFlight.delete(topic);
        this.schedule();
      });
    }
  }
}
