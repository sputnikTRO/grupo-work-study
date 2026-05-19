-- Agrega ticket_number como secuencia autoincremental a travel_leads
-- Los registros existentes reciben números secuenciales automáticamente

CREATE SEQUENCE IF NOT EXISTS "travel_leads_ticket_number_seq";

ALTER TABLE "travel_leads"
  ADD COLUMN "ticket_number" INTEGER NOT NULL
  DEFAULT nextval('"travel_leads_ticket_number_seq"');

ALTER SEQUENCE "travel_leads_ticket_number_seq"
  OWNED BY "travel_leads"."ticket_number";

CREATE UNIQUE INDEX "travel_leads_ticket_number_key"
  ON "travel_leads"("ticket_number");

-- Agrega valor cerrado_por_asesor al enum TravelLeadStatus
ALTER TYPE "TravelLeadStatus" ADD VALUE IF NOT EXISTS 'cerrado_por_asesor';
