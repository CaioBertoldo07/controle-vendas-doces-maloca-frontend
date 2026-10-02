// Tools de leitura do Agente de Atendimento (Etapa 5). Só resolvem nomes:
// nenhuma consulta de negócio (isso é dos especialistas, via Coordenador) e
// nenhuma escrita.
import { z } from "zod";
import * as clientesService from "../../services/clientesService.js";
import * as resolverNomes from "../../services/resolverNomes.js";
import { definirTool } from "./definirTool.js";
import { idPositivo } from "./formato.js";

const nome = z.string().trim().min(1).max(80);

export const resolverEntidades = definirTool({
  nome: "resolverEntidades",
  descricao:
    "Resolve nomes digitados pelo gestor para cliente e sabores cadastrados (resolução segura da Etapa 0.6): EXATO ou PARCIAL_UNICO devolvem o registro; AMBIGUO devolve candidatos e NUNCA escolhe; NAO_ENCONTRADO e INVALIDO não devolvem nada. Só sabores ativos.",
  entrada: z.object({ cliente: nome.optional(), sabores: z.array(nome).max(10).optional() }).strict(),
  async executar({ cliente, sabores = [] }) {
    const r = { sabores: [] };
    if (cliente !== undefined) {
      const c = await resolverNomes.resolverCliente(cliente);
      r.cliente = { termo: cliente, status: c.tipo, ...(c.cliente && { registro: { id: c.cliente.id, nome: c.cliente.nome } }), ...(c.candidatos && { candidatos: c.candidatos }) };
    }
    for (const termo of sabores) {
      const s = await resolverNomes.resolverSabor(termo);
      r.sabores.push({ termo, status: s.tipo, ...(s.sabor && { registro: s.sabor }), ...(s.candidatos && { candidatos: s.candidatos }) });
    }
    return r;
  },
  resumir: (d) => ({ cliente: d.cliente?.status ?? null, sabores: d.sabores.map((s) => s.status) }),
});

export const consultarNomesClientes = definirTool({
  nome: "consultarNomesClientes",
  descricao: "Nomes dos clientes pelos ids (para mostrar listas ao gestor). Os nomes não são enviados ao LLM.",
  entrada: z.object({ ids: z.array(idPositivo).min(1).max(200) }).strict(),
  async executar({ ids }) {
    return { clientes: await clientesService.nomesClientes(ids) };
  },
  resumir: (d) => ({ clientes: d.clientes.length }),
});
