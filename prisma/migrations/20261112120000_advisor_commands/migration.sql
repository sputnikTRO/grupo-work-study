-- Bitácora de los mensajes que las asesoras le mandan al bot (ATIENDO, LISTO,
-- PENDIENTES…) y de qué les contestó: aceptado o rechazado, con el motivo.
--
-- Antes no se guardaba nada: en la auditoría de nov-2026 una asesora respondió
-- "ATIENDO 5", el bot se lo rechazó ("no está asignado a ti") y en la base ese
-- intento solo aparecía como "no confirmó".
--
-- Sirve además para saber si la ventana de 24h de WhatsApp de una asesora está
-- abierta (su último mensaje entrante), y así no mandarle texto libre que Meta
-- no va a entregar.
--
-- Tabla NUEVA y aislada: no toca filas ni columnas existentes.
CREATE TABLE "advisor_commands" (
    "id" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "advisor_name" TEXT NOT NULL,
    "advisor_phone" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "ticket_number" INTEGER,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "wa_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advisor_commands_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "advisor_commands_unit_advisor_phone_created_at_idx" ON "advisor_commands"("unit", "advisor_phone", "created_at");
CREATE INDEX "advisor_commands_unit_ticket_number_idx" ON "advisor_commands"("unit", "ticket_number");
