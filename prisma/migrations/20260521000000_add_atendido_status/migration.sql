-- Agrega estado 'atendido' a ConversationStatus
-- Representa una conversación atendida por un asesor donde Miri puede retomar si el prospecto vuelve a escribir.
ALTER TYPE "ConversationStatus" ADD VALUE IF NOT EXISTS 'atendido';

-- Agrega estado 'atendido_asesor' a TravelLeadStatus
-- El lead fue atendido pero sigue activo (puede reingresar al flujo con Miri).
ALTER TYPE "TravelLeadStatus" ADD VALUE IF NOT EXISTS 'atendido_asesor';
