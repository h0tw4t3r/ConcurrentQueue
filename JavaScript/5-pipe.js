'use strict';

class QueueFactory {
  constructor() {
    this.concurrency = 0;
    this.count = 0;
    this.waiting = [];
    this.priorityMode = false;
    this.waitTimeout = Infinity;
    this.processTimeout = Infinity;
    this.destination = null;
    this.onProcess = null;
    this.onDone = null;
    this.onSuccess = null;
    this.onFailure = null;
    this.onDrain = null;
  }

  static init() {
    return new QueueFactory();
  }

  build() {
    return new Queue(this);
  }

  priority(flag = true) {
    this.priorityMode = flag;
    return this;
  }

  wait(msec) {
    this.waitTimeout = msec;
    return this;
  }

  timeout(msec) {
    this.processTimeout = msec;
    return this;
  }

  channels(concurrency) {
    this.concurrency = concurrency;
    return this;
  }

  process(listener) {
    this.onProcess = listener;
    return this;
  }

  done(listener) {
    this.onDone = listener;
    return this;
  }

  success(listener) {
    this.onSuccess = listener;
    return this;
  }

  failure(listener) {
    this.onFailure = listener;
    return this;
  }

  drain(listener) {
    this.onDrain = listener;
    return this;
  }
}

class Queue {
  constructor(factoryContext) {
    this.paused = false;
    this.count = 0;
    this.waiting = [];
    this.destination = null;

    Object.assign(this, factoryContext);
  }

  add(task, priority = 0) {
    if (!this.paused) {
      const hasChannel = this.count < this.concurrency;
      if (hasChannel) {
        this.next(task);
        return;
      }
    }

    this.waiting.push({ task, start: Date.now(), priority });
    if (this.priorityMode) {
      this.waiting.sort((a, b) => b.priority - a.priority);
    }
  }

  next(task) {
    this.count++;
    let timer = null;
    let finished = false;
    const { processTimeout, onProcess } = this;
    const finish = (err, res) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.count--;
      this.finish(err, res);
      if (!this.paused && this.waiting.length > 0) this.takeNext();
    };

    if (processTimeout !== Infinity) {
      const err = new Error('Process timed out');
      timer = setTimeout(finish, processTimeout, err, task);
    }
    onProcess(task, finish);
  }

  takeNext() {
    const { waiting, waitTimeout } = this;
    const { task, start } = waiting.shift();

    if (waitTimeout !== Infinity) {
      const delay = Date.now() - start;
      if (delay > waitTimeout) {
        const err = new Error('Waiting timed out');
        this.finish(err, task);
        if (waiting.length > 0) {
          setTimeout(() => {
            if (!this.paused && waiting.length > 0) this.takeNext();
          }, 0);
        }
        return;
      }
    }

    const hasChannel = this.count < this.concurrency;
    if (hasChannel) this.next(task);
    return;
  }

  finish(err, res) {
    const { onFailure, onSuccess, onDone, onDrain } = this;

    if (err) {
      if (onFailure) onFailure(err, res);
    } else {
      if (onSuccess) onSuccess(res);
      if (this.destination) this.destination.add(res);
    }
    if (onDone) onDone(err, res);
    if (this.count === 0 && onDrain) onDrain();
  }

  pause() {
    this.paused = true;
    return this;
  }

  resume() {
    if (this.waiting.length > 0) {
      const channels = this.concurrency - this.count;
      for (let i = 0; i < channels; i++) {
        this.takeNext();
      }
    }
    this.paused = false;
    return this;
  }

  pipe(destination) {
    this.destination = destination;
    return this;
  }
}

// Usage

const destination = QueueFactory.init()
  .channels(2)
  .wait(5000)
  .process((task, next) => next(null, { ...task, processed: true }))
  .done((err, task) => console.log({ task }))
  .build();

const source = QueueFactory.init()
  .channels(3)
  .timeout(4000)
  .process((task, next) => setTimeout(next, task.interval, null, task))
  .build()
  .pipe(destination);

for (let i = 0; i < 10; i++) {
  source.add({ name: `Task${i}`, interval: 1000 });
}

