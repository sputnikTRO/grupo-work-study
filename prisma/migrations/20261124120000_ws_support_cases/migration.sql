-- W&S OTCC: casos de soporte, capturas y alcance de los comandos.
-- Solo AGREGA (tablas nuevas + una columna con default): no toca datos existentes.

ALTER TABLE "advisor_commands" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'comercial';

CREATE TABLE "support_cases" (
    "id" TEXT NOT NULL,
    "case_number" SERIAL NOT NULL,
    "unit" "Unit" NOT NULL DEFAULT 'oxford_education',
    "programa" TEXT NOT NULL DEFAULT 'ws',
    "tema" TEXT NOT NULL DEFAULT 'otcc',
    "conversation_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "motivo" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendiente_aviso',
    "assigned_key" TEXT,
    "assigned_name" TEXT,
    "notify_at" TIMESTAMP(3),
    "notified_at" TIMESTAMP(3),
    "sla_due_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "tried_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "case_attachments" (
    "id" TEXT NOT NULL,
    "case_id" TEXT,
    "conversation_id" TEXT NOT NULL,
    "wa_media_id" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "data" BYTEA,
    "forwarded_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "support_cases_case_number_key" ON "support_cases"("case_number");
CREATE INDEX "support_cases_status_notify_at_idx" ON "support_cases"("status", "notify_at");
CREATE INDEX "support_cases_status_sla_due_at_idx" ON "support_cases"("status", "sla_due_at");
CREATE INDEX "support_cases_conversation_id_idx" ON "support_cases"("conversation_id");
CREATE INDEX "case_attachments_case_id_idx" ON "case_attachments"("case_id");
CREATE INDEX "case_attachments_conversation_id_idx" ON "case_attachments"("conversation_id");

ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
