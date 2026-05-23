export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Returns a function that, when called, returns a promise that resolves after
// at least `ms` has elapsed since the last call settled. Used to prevent
// rapid re-validation during a burst of file events.
export function throttleAsync(fn, ms) {
  let lastRun = 0;
  let pending = null;
  return (...args) => {
    const now = Date.now();
    if (now - lastRun >= ms) {
      lastRun = now;
      return fn(...args);
    }
    if (!pending) {
      pending = new Promise((resolve) =>
        setTimeout(async () => {
          lastRun = Date.now();
          pending = null;
          resolve(await fn(...args));
        }, ms - (now - lastRun))
      );
    }
    return pending;
  };
}
