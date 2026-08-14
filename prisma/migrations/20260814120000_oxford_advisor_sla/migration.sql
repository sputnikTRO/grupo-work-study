-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OxfordLeadStatus" ADD VALUE 'en_atencion';
ALTER TYPE "OxfordLeadStatus" ADD VALUE 'sin_confirmar';

-- AlterTable
-- Aditiva y nullable (feature/ori-advisor-sla): SLA de confirmación del asesor.
-- NULL/0/[]/{} para todos los leads existentes; Travel y Work & Study nunca la usan.
ALTER TABLE "oxford_leads" ADD COLUMN     "assigned_at" TIMESTAMP(3),
ADD COLUMN     "confirmed_at" TIMESTAMP(3),
ADD COLUMN     "response_seconds" INTEGER,
ADD COLUMN     "sla_due_at" TIMESTAMP(3),
ADD COLUMN     "current_attempt" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reassign_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tried_advisor_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "advisor_attempts" JSONB DEFAULT '[]';
