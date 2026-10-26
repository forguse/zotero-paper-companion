/* SPDX-License-Identifier: MIT — independent FIFO lanes for local transactions. */
var PCKeyedQueue = class {
  constructor() { this.tails = new Map(); }

  run(key, task) {
    const result = (this.tails.get(key) || Promise.resolve()).then(task);
    // Keep a fulfilled tail so a failed operation never poisons its successors.
    const tail = result.catch(() => {});
    this.tails.set(key, tail);
    tail.then(() => { if (this.tails.get(key) === tail) this.tails.delete(key); });
    return result;
  }

  async drain() {
    // A task may enqueue another lane while the previous snapshot is settling.
    while (this.tails.size) await Promise.all([...this.tails.values()]);
  }
};
if (typeof module === 'object' && module.exports) module.exports = PCKeyedQueue;
