// Agente de Atendimento (Etapa 5): interface conversacional do gestor.
// Linguagem natural → (LLM) intenção estruturada → Coordenador → especialistas
// → (LLM) resposta redigida e verificada. Sem LLM configurado, responde que a
// conversa está indisponível; os especialistas seguem funcionando sozinhos.
//
//   CONVERSAR              → um turno  { mensagem, historico?, estado?, dataReferencia? }
//   SOLICITAR_DIAGNOSTICO  → diagnóstico técnico via Coordenador (Etapa 1)
//   PING
import { z } from "zod";
import { erro } from "../../../lib/erros.js";
import { LIMITES_CONVERSA } from "../../conversa/intencoes.js";
import { conversar } from "./conversa.js";

const pedidoConversa = z
  .object({
    mensagem: z.string().trim().min(1).max(LIMITES_CONVERSA.MAX_CARACTERES_MENSAGEM),
    historico: z.array(z.object({ papel: z.enum(["USUARIO", "ASSISTENTE"]), conteudo: z.string() }).passthrough()).max(50).optional(),
    estado: z.record(z.string(), z.unknown()).nullable().optional(),
    dataReferencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict();

export const atendimento = {
  nome: "atendimento",
  descricao: "Agente de Atendimento: conversa com o gestor em linguagem natural, consulta os especialistas pelo Coordenador e prepara propostas de ação para aprovação.",
  tools: ["resolverEntidades", "consultarNomesClientes"],
  limiteMs: 90000, // até 3 chamadas ao LLM + especialistas
  async executar(contexto) {
    const { tipo, dados = {} } = contexto.entrada ?? {};
    if (tipo === "PING") return { agente: "atendimento", pong: true };
    if (tipo === "SOLICITAR_DIAGNOSTICO") {
      const resposta = await contexto.enviarMensagem({ para: "coordenador", tipo: "DIAGNOSTICO_GERAL", dados: {} });
      return { agente: "atendimento", encaminhadoPara: "coordenador", resposta };
    }
    if (tipo === "CONVERSAR") {
      const r = pedidoConversa.safeParse(dados);
      if (!r.success) throw erro(400, `Mensagem inválida: ${r.error.issues.map((i) => `${i.path.join(".") || "dados"} ${i.message}`).join("; ")}`);
      return conversar(contexto, { ...r.data, estado: r.data.estado ?? {} });
    }
    throw erro(400, `Tipo de execução não suportado pelo agente atendimento: "${tipo}"`);
  },
};
