-- CreateEnum
CREATE TYPE "OxfordLeadType" AS ENUM ('b2b_institutional', 'b2c_individual');

-- CreateEnum
CREATE TYPE "OxfordLeadStatus" AS ENUM ('nuevo', 'primer_contacto', 'en_calificacion', 'interesado', 'demo_agendada', 'demo_completada', 'propuesta_enviada', 'en_negociacion', 'cerrado_ganado', 'cerrado_perdido', 'no_interesado', 'archivado');

-- CreateEnum
CREATE TYPE "OxfordProduct" AS ENUM ('oxford_tcc', 'oxford_tcc_kids', 'english_teaching_certificate', 'alphable', 'oxford_life', 'rising_stars', 'work_study_spain');

-- CreateTable
CREATE TABLE "oxford_leads" (
    "id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "lead_type" "OxfordLeadType" NOT NULL DEFAULT 'b2c_individual',
    "source" TEXT,
    "source_detail" TEXT,
    "full_name" TEXT,
    "role" TEXT,
    "institution_name" TEXT,
    "institution_type" TEXT,
    "estimated_students" INTEGER,
    "current_cert" TEXT,
    "school_cycle" TEXT,
    "products_interest" "OxfordProduct"[],
    "primary_product" "OxfordProduct",
    "temperature" TEXT NOT NULL DEFAULT 'nuevo',
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "OxfordLeadStatus" NOT NULL DEFAULT 'nuevo',
    "assigned_agent" TEXT,
    "nurturing_sequence" TEXT,
    "nurturing_step" INTEGER NOT NULL DEFAULT 0,
    "next_follow_up" TIMESTAMP(3),
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "meeting_date" TIMESTAMP(3),
    "meeting_attended" BOOLEAN,
    "meeting_notes" TEXT,
    "proposal_sent" BOOLEAN NOT NULL DEFAULT false,
    "proposal_date" TIMESTAMP(3),
    "proposal_amount" DOUBLE PRECISION,
    "materials_sent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "extras" JSONB DEFAULT '{}',
    "zoho_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oxford_leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oxford_leads_contact_id_idx" ON "oxford_leads"("contact_id");

-- CreateIndex
CREATE INDEX "oxford_leads_lead_type_idx" ON "oxford_leads"("lead_type");

-- CreateIndex
CREATE INDEX "oxford_leads_temperature_idx" ON "oxford_leads"("temperature");

-- CreateIndex
CREATE INDEX "oxford_leads_status_idx" ON "oxford_leads"("status");

-- CreateIndex
CREATE INDEX "oxford_leads_primary_product_idx" ON "oxford_leads"("primary_product");

-- AddForeignKey
ALTER TABLE "oxford_leads" ADD CONSTRAINT "oxford_leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

