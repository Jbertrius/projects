/**
 * Simple in-memory TTL cache — no external dependency needed at this scale.
 *
 * Usage:
 *   const cache = createCache();
 *   const data  = await cache.get("key", 5 * 60_000, () => fetchExpensiveData());
 *   cache.invalidate("key");
 *   cache.clear();
 */

function createCache() {
  const store = new Map();

  /**
   * Return cached value if still fresh, otherwise call fetchFn, cache, and return.
   * @param {string}   key     - Cache key
   * @param {number}   ttlMs   - Time-to-live in milliseconds
   * @param {Function} fetchFn - Async function that produces the value
   */
  async function get(key, ttlMs, fetchFn) {
    const entry = store.get(key);
    if (entry && Date.now() - entry.ts < ttlMs) {
      return entry.value;
    }

    const value = await fetchFn();
    store.set(key, { value, ts: Date.now() });
    return value;
  }

  /** Drop a single key so next access re-fetches. */
  function invalidate(key) {
    store.delete(key);
  }

  /** Drop all cached entries. */
  function clear() {
    store.clear();
  }

  /** How many entries are currently stored. */
  function size() {
    return store.size;
  }

  return { get, invalidate, clear, size };
}

// Shared application cache — import this singleton everywhere
const appCache = createCache();

module.exports = { createCache, appCache };
