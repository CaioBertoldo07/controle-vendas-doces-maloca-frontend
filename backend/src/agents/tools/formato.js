// Formato das saídas das tools: dados prontos para um agente, diferentes do
// formato da API HTTP (números em vez de Decimal/strings monetárias; datas de
// negócio como horário de Manaus com deslocamento, política da Etapa 0.5).
import { z } from "zod";
import { serializarCivil } from "../../lib/periodos.js";

/** Decimal do Prisma, string "199.00" ou número → número (2 casas de dinheiro preservadas). */
export const numero = (v) => (v == null ? null : Number(v));

/** Data de negócio (Date civil) → "2026-03-31T23:30:00.000-04:00". */
export const dataCivil = (d) => (d ? serializarCivil(d) : null);

// Fragmentos de schema reutilizados pelas tools e pelos contratos de ação.
export const idPositivo = z.number().int().positive();
export const diaCivil = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use AAAA-MM-DD (dia civil de Manaus)");
export const dataHoraCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?)?$/, "use AAAA-MM-DD ou AAAA-MM-DDTHH:MM[:SS] (horário de Manaus, sem fuso)");
export const itemSabor = z.object({ saborId: idPositivo, quantidade: z.number().int().positive() }).strict();
