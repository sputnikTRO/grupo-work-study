-- Rastro de las notificaciones de lead que se mandan a las asesoras (Ori y Miri).
--
-- Hasta ahora no se guardaba NADA de ese envío: ni qué plantilla salió, ni el ID
-- que devuelve Meta (wamid), ni los webhooks de status (sent/delivered/read/
-- failed), que se descartaban. En la auditoría de nov-2026 no se pudo responder
-- "¿le llegó a la asesora?" — Meta acepta el envío (HTTP 200) y los fallos de
-- entrega (p. ej. 131049, límite de mensajes de marketing por usuario) solo
-- llegan después, por webhook.
--
-- Tabla NUEVA y aislada: no toca filas ni columnas existentes. `lead_id` no lleva
-- FK a propósito (apunta a oxford_leads o travel_leads según `unit`) para que un
-- reset de leads no borre el rastro de entregas.
CREATE TABLE "advisor_notifications" (
    "id" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "lead_id" TEXT,
    "ticket_number" INTEGER,
    "advisor_name" TEXT NOT NULL,
    "advisor_phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'nuevo_lead',
    "via" TEXT NOT NULL,
    "template_name" TEXT,
    "wa_message_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'accepted',
    "error_code" INTEGER,
    "error_title" TEXT,
    "error_detail" TEXT,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advisor_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "advisor_notifications_wa_message_id_key" ON "advisor_notifications"("wa_message_id");
CREATE INDEX "advisor_notifications_unit_lead_id_idx" ON "advisor_notifications"("unit", "lead_id");
CREATE INDEX "advisor_notifications_status_idx" ON "advisor_notifications"("status");
CREATE INDEX "advisor_notifications_created_at_idx" ON "advisor_notifications"("created_at");
