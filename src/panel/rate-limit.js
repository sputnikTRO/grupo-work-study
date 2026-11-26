/**
 * Panel — límite de intentos de login: 5 fallos en 15 min por correo y por IP.
 * Usa Redis si está disponible; si Redis falla, un contador en memoria. Un
 * error de Redis nunca deja la puerta abierta.
 */
export const MAX_FAILS = 5;
export const WINDOW_SEC = 15 * 60;

export function makeRateLimiter(redisClient = null) {
  const mem = new Map();
  const memGet = (k) => {
    const e = mem.get(k);
    if (!e || e.until < Date.now()) { mem.delete(k); return 0; }
    return e.n;
  };
  const key = (k) => `panel:login:${k}`;

  return {
    async count(k) {
      try { if (redisClient) return Number(await redisClient.get(key(k))) || 0; } catch { /* cae a memoria */ }
      return memGet(k);
    },
    async isBlocked(keys) {
      for (const k of keys) if (await this.count(k) >= MAX_FAILS) return true;
      return false;
    },
    async fail(keys) {
      for (const k of keys) {
        try {
          if (redisClient) {
            const n = await redisClient.incr(key(k));
            if (n === 1) await redisClient.expire(key(k), WINDOW_SEC);
            continue;
          }
        } catch { /* cae a memoria */ }
        mem.set(k, { n: memGet(k) + 1, until: Date.now() + WINDOW_SEC * 1000 });
      }
    },
    async reset(keys) {
      for (const k of keys) {
        try { if (redisClient) await redisClient.del(key(k)); } catch { /* */ }
        mem.delete(k);
      }
    },
  };
}
