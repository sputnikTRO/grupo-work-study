-- Panel de prospectos (/panel): usuarios, sesiones, registro de accesos e índices.
-- Solo AGREGA tablas e índices: no cambia ni borra datos existentes.
-- CreateTable
CREATE TABLE "panel_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "advisor_name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_sessions" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,

    CONSTRAINT "panel_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "panel_access_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "email" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panel_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "panel_users_email_key" ON "panel_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "panel_sessions_token_hash_key" ON "panel_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "panel_sessions_user_id_idx" ON "panel_sessions"("user_id");

-- CreateIndex
CREATE INDEX "panel_sessions_expires_at_idx" ON "panel_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "panel_access_log_created_at_idx" ON "panel_access_log"("created_at");

-- CreateIndex
CREATE INDEX "panel_access_log_user_id_created_at_idx" ON "panel_access_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "conversations_contact_id_unit_last_message_at_idx" ON "conversations"("contact_id", "unit", "last_message_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "travel_leads_created_at_idx" ON "travel_leads"("created_at");

-- CreateIndex
CREATE INDEX "travel_leads_updated_at_idx" ON "travel_leads"("updated_at");

-- CreateIndex
CREATE INDEX "oxford_leads_created_at_idx" ON "oxford_leads"("created_at");

-- CreateIndex
CREATE INDEX "oxford_leads_updated_at_idx" ON "oxford_leads"("updated_at");

-- AddForeignKey
ALTER TABLE "panel_sessions" ADD CONSTRAINT "panel_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "panel_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
