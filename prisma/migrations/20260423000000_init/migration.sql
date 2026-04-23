-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('travel', 'work_study', 'oxford_education');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('whatsapp', 'web', 'instagram');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('active', 'waiting_human', 'closed', 'follow_up');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('user', 'bot', 'agent');

-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('text', 'image', 'document', 'audio', 'template', 'interactive');

-- CreateEnum
CREATE TYPE "TravelLeadStatus" AS ENUM ('nuevo', 'contactado', 'interesado', 'materiales_enviados', 'derivado_asesor', 'en_proceso_pago', 'inscrito', 'no_interesado');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "source_unit" "Unit" NOT NULL,
    "active_units" "Unit"[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'whatsapp',
    "status" "ConversationStatus" NOT NULL DEFAULT 'active',
    "assigned_agent" TEXT,
    "interest_score" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB DEFAULT '{}',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "sender_type" "SenderType" NOT NULL,
    "content_type" "ContentType" NOT NULL DEFAULT 'text',
    "content" TEXT NOT NULL,
    "media_url" TEXT,
    "wa_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "travel_leads" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "trip_id" TEXT,
    "school_code" TEXT,
    "program_interest" TEXT,
    "traveler_name" TEXT,
    "traveler_age" INTEGER,
    "parent_name" TEXT,
    "budget_range" TEXT,
    "status" "TravelLeadStatus" NOT NULL DEFAULT 'nuevo',
    "materials_sent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "follow_up_date" TIMESTAMP(3),
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "extras" JSONB DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "travel_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_phone_key" ON "contacts"("phone");

-- CreateIndex
CREATE INDEX "conversations_contact_id_unit_idx" ON "conversations"("contact_id", "unit");

-- CreateIndex
CREATE INDEX "conversations_status_idx" ON "conversations"("status");

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");

-- CreateIndex
CREATE INDEX "messages_wa_message_id_idx" ON "messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "travel_leads_contact_id_idx" ON "travel_leads"("contact_id");

-- CreateIndex
CREATE INDEX "travel_leads_status_idx" ON "travel_leads"("status");

-- CreateIndex
CREATE INDEX "travel_leads_school_code_idx" ON "travel_leads"("school_code");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "travel_leads" ADD CONSTRAINT "travel_leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

