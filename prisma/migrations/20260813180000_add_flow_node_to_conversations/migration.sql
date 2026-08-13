-- AlterTable
-- Aditiva y nullable: agrega el nodo actual del flujo determinístico de Ori
-- (feature/ori-flow-redesign). NULL para conversaciones existentes y para
-- Travel/Work & Study, que nunca la usan. No borra ni modifica nada existente.
ALTER TABLE "conversations" ADD COLUMN     "flow_node" TEXT;
