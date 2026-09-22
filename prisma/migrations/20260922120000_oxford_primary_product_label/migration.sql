-- Etiqueta libre del producto de interés para el ticket de la asesora.
--
-- El enum OxfordProduct cubre 7 de los ~16 productos del menú de Ori, así que
-- los demás (Smile and Learn, AINARA, Visual Camp, Checkpoint, Global Insights…)
-- no tenían dónde guardarse y el apartado "Producto" del ticket llegaba vacío.
--
-- Aditiva y nullable: no toca filas existentes ni rompe a ningún lector previo.
-- Es TEXTO y no un valor de enum a propósito — el cliente agrega productos en la
-- pestaña "Flujo Ori" y deben capturarse sin otra migración.
ALTER TABLE "oxford_leads" ADD COLUMN "primary_product_label" TEXT;
