/** Doble en memoria de las tablas del panel (usuarios, sesiones, registro). */
export function fakeDb() {
  const users = new Map(); const sessions = new Map(); const log = [];
  return {
    users, sessions, log,
    panelUser: {
      findUnique: async ({ where }) => [...users.values()].find((u) => (where.email ? u.email === where.email : u.id === where.id)) || null,
      update: async ({ where, data }) => Object.assign(users.get(where.id), data),
    },
    panelSession: {
      create: async ({ data }) => { const s = { id: `s${sessions.size + 1}`, ...data }; sessions.set(s.id, s); return s; },
      findUnique: async ({ where }) => { const s = [...sessions.values()].find((x) => x.tokenHash === where.tokenHash); return s ? { ...s, user: users.get(s.userId) } : null; },
      update: async ({ where, data }) => Object.assign(sessions.get(where.id), data),
      deleteMany: async ({ where }) => {
        for (const [id, s] of sessions) {
          const match = (where.id && s.id === where.id) || (where.tokenHash && s.tokenHash === where.tokenHash)
            || (where.userId && s.userId === where.userId && !(where.NOT && s.tokenHash === where.NOT.tokenHash));
          if (match) sessions.delete(id);
        }
        return {};
      },
    },
    panelAccessLog: { create: async ({ data }) => { log.push(data); return data; } },
  };
}
