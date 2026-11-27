#!/usr/bin/env node
/**
 * Usuarios del panel de prospectos (/panel). No hay registro público: se crean aquí.
 *
 *   node scripts/panel-user.mjs list
 *   node scripts/panel-user.mjs add --email x@y.com --name "Nombre" [--role admin|asesora] [--advisor "Rosaura Pinto"]
 *   node scripts/panel-user.mjs reset --email x@y.com     → nueva contraseña temporal; cierra sus sesiones
 *   node scripts/panel-user.mjs disable --email x@y.com   → no puede entrar; cierra sus sesiones
 *   node scripts/panel-user.mjs enable --email x@y.com
 *
 * `add` y `reset` imprimen UNA vez una contraseña temporal; en el primer ingreso
 * el panel obliga a cambiarla. Requiere DATABASE_URL.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hashPassword, temporaryPassword } from '../src/panel/password.js';

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : null; };
const email = (arg('email') || '').trim().toLowerCase();
const prisma = new PrismaClient();
const fail = (m) => { console.error(`❌ ${m}`); process.exit(2); };

try {
  if (cmd === 'list') {
    const users = await prisma.panelUser.findMany({ orderBy: { createdAt: 'asc' } });
    for (const u of users) console.log(`${u.active ? '✓' : '✗'} ${u.email} · ${u.name} · ${u.role}${u.advisorName ? ` (${u.advisorName})` : ''} · último ingreso ${u.lastLoginAt?.toISOString() || 'nunca'}${u.mustChangePassword ? ' · debe cambiar contraseña' : ''}`);
    if (!users.length) console.log('Sin usuarios.');
  } else if (cmd === 'add') {
    const name = arg('name');
    const role = arg('role') || 'admin';
    const advisorName = arg('advisor');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Falta --email válido.');
    if (!name) fail('Falta --name.');
    if (!['admin', 'asesora'].includes(role)) fail('--role debe ser admin o asesora.');
    if (role === 'asesora' && !advisorName) fail('Una asesora necesita --advisor con su nombre tal como aparece en los leads.');
    if (await prisma.panelUser.findUnique({ where: { email } })) fail(`Ya existe ${email}. Usa reset o enable.`);
    const temp = temporaryPassword();
    await prisma.panelUser.create({ data: { email, name, role, advisorName, passwordHash: await hashPassword(temp), mustChangePassword: true } });
    console.log(`✅ ${email} (${role}) creado.\nContraseña temporal (se muestra una sola vez; se cambia en el primer ingreso):\n\n  ${temp}\n`);
  } else if (cmd === 'reset') {
    const u = await prisma.panelUser.findUnique({ where: { email } });
    if (!u) fail(`No existe ${email}.`);
    const temp = temporaryPassword();
    await prisma.panelUser.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(temp), mustChangePassword: true } });
    await prisma.panelSession.deleteMany({ where: { userId: u.id } });
    console.log(`✅ Contraseña de ${email} reiniciada y sesiones cerradas.\nTemporal (una sola vez):\n\n  ${temp}\n`);
  } else if (cmd === 'disable' || cmd === 'enable') {
    const u = await prisma.panelUser.findUnique({ where: { email } });
    if (!u) fail(`No existe ${email}.`);
    await prisma.panelUser.update({ where: { id: u.id }, data: { active: cmd === 'enable' } });
    if (cmd === 'disable') await prisma.panelSession.deleteMany({ where: { userId: u.id } });
    console.log(`✅ ${email} ${cmd === 'enable' ? 'activado' : 'desactivado (sesiones cerradas)'}.`);
  } else {
    console.log('Uso: list | add --email --name [--role --advisor] | reset --email | disable --email | enable --email');
  }
} finally {
  await prisma.$disconnect();
}
