/** Panel — registro de accesos. Nunca lanza: un fallo aquí no tumba el panel. */
import logger from '../utils/logger.js';

export async function logAccess(db, { user = null, email = null, action, detail = null, ip = null, userAgent = null }) {
  try {
    await db.panelAccessLog.create({
      data: {
        userId: user?.id || null,
        email: email || user?.email || null,
        action,
        detail: detail ? String(detail).slice(0, 300) : null,
        ip,
        userAgent: userAgent ? String(userAgent).slice(0, 200) : null,
      },
    });
  } catch (err) {
    logger.warn({ err, action }, 'No se pudo guardar el registro de acceso del panel');
  }
}
