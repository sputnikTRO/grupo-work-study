-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OxfordLeadStatus" ADD VALUE 'derivado_asesor';
ALTER TYPE "OxfordLeadStatus" ADD VALUE 'atendido_asesor';

-- AlterTable
ALTER TABLE "oxford_leads" ADD COLUMN     "assigned_advisor" TEXT,
ADD COLUMN     "municipality" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "ticket_number" SERIAL NOT NULL,
ADD COLUMN     "zone_key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "oxford_leads_ticket_number_key" ON "oxford_leads"("ticket_number");

