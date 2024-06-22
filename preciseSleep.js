// preciseSleep.js
import { performance } from 'perf_hooks';

export async function preciseSleep(milliseconds) {
  return new Promise(resolve => {
    const start = performance.now();
    function check() {
      const now = performance.now();
      if (now - start >= milliseconds) {
        resolve();
      } else {
        setImmediate(check);
      }
    }
    setImmediate(check);
  });
}
