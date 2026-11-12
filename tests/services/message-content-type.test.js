import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storableContentType } from '../../src/services/message.service.js';

// El enum ContentType de la base solo acepta 6 valores. WhatsApp manda más
// (sticker, video, location, contacts, button, reaction, unknown…): guardarlos
// tal cual hacía fallar el INSERT y el turno se caía sin responder al prospecto.

test('los tipos que el enum no acepta se guardan como text', () => {
  for (const t of ['sticker', 'video', 'location', 'contacts', 'button', 'reaction', 'unknown', undefined, null, '']) {
    assert.equal(storableContentType(t), 'text', String(t));
  }
});

test('los tipos válidos se conservan', () => {
  for (const t of ['text', 'image', 'document', 'audio', 'template', 'interactive']) {
    assert.equal(storableContentType(t), t);
  }
});
