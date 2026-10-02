// Textos determinísticos da conversa (Etapa 5). Puras. São usados quando o
// LLM não deve (ações, ajuda, recusas) ou não pode (indisponível, fatos não
// suportados) redigir a resposta.
import { ACOES, ROTAS_CONSULTA } from "./intencoes.js";

export const SUGESTOES = Object.freeze([
  "Como estão as vendas?",
  "Como está o estoque?",
  "Quais sabores estão em alta?",
  "Existem vendas pendentes?",
  "Quais clientes estão fora do padrão de recompra?",
  "Faça um diagnóstico geral.",
]);

export const TEXTOS = Object.freeze({
  INDISPONIVEL: "O assistente conversacional está temporariamente indisponível. Os agentes especializados continuam operacionais.",
  NAO_ENTENDI: "Não consegui interpretar o pedido com segurança. Pode reformular? Se for uma consulta, diga o assunto (vendas, estoque, demanda, pendências...).",
  FORA_DE_ESCOPO: "Posso ajudar só com a gestão do Doces da Maloca: vendas, estoque, demanda, pendências de pagamento e propostas de venda ou de pagamento. Não acesso configurações, segredos ou o banco de dados diretamente.",
  MUITAS_INTENCOES: "São muitos assuntos numa mensagem só. Pergunte por partes (até 3 assuntos por vez).",
  JANELA_FORA: "Consigo analisar janelas de 4 a 12 semanas completas. Quer usar uma delas?",
  SEM_VALOR: "Para propor a venda preciso do valor informado por você (o sistema não calcula o preço). Reenvie com o valor, por exemplo: \"... por R$ 55\".",
  VALOR_NAO_CITADO: "Não encontrei na sua mensagem algum dos números do pedido (quantidade, valor ou número da venda). Reenvie o pedido com esses números escritos, para eu não supor nada.",
  NOME_NAO_CITADO: "Não encontrei na sua mensagem o nome do cliente ou do sabor do pedido. Reenvie com os nomes, para eu não supor nada.",
  CANCELADO: "Tudo bem, deixei a escolha de lado. Nada foi proposto.",
  ACAO_COM_CONSULTA: "Fiz só a proposta; a consulta pode ser feita numa próxima mensagem.",
});

export function textoAjuda() {
  const consultas = Object.values(ROTAS_CONSULTA).map((r) => `• ${r.descricao}`);
  const acoes = Object.values(ACOES).map((a) => `• ${a.descricao}`);
  return [
    "Posso consultar os agentes do sistema e explicar o resultado:",
    ...consultas,
    "E posso preparar, para a sua aprovação:",
    ...acoes,
    "Nada é registrado sem você aprovar. Exemplos:",
    ...SUGESTOES.map((s) => `• ${s}`),
  ].join("\n");
}

const brl = (v) => `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Cartão de ação proposta: sempre "aguardando aprovação", nunca "executada". */
export function textoAcaoProposta(card) {
  const linhas = ["Ação proposta:", card.titulo, ""];
  if (card.tipo === "REGISTRAR_VENDA") {
    linhas.push(`Cliente: ${card.resumo.cliente.nome}`, `Itens: ${card.resumo.itens.map((i) => `${i.quantidade} × ${i.sabor}`).join(", ")}`, `Valor informado: ${brl(card.resumo.valorInformado)}`);
  } else {
    linhas.push(`Venda nº ${card.resumo.vendaId}`);
  }
  linhas.push("", card.reaproveitada ? "Status: aguardando aprovação (essa proposta já existia; não criei outra)." : "Status: aguardando aprovação.", "Nada foi registrado ainda: aprove ou rejeite a proposta.");
  return linhas.join("\n");
}

export function textoEscolha(campo, termo, opcoes) {
  const rotulo = campo === "cliente" ? "cliente" : "sabor";
  return [`Encontrei mais de um ${rotulo} para "${termo}". Qual deles?`, ...opcoes.map((o, i) => `${i + 1}. ${o.nome}`), "Responda com o número da opção ou com o nome completo (ou \"cancelar\")."].join("\n");
}

export const textoNaoEncontrado = (campo, termo) => `Não encontrei ${campo === "cliente" ? "cliente" : "sabor"} com o nome "${termo}". Confira o nome e tente de novo.`;

/** Resposta montada só com os fatos (frases dos próprios especialistas), sem LLM. */
export function textoDosFatos(resultados) {
  const blocos = [];
  for (const r of resultados) {
    if (r.status !== "OK") {
      blocos.push(`• ${r.intencao}: o agente ${r.agente} não respondeu agora (modo degradado).`);
      continue;
    }
    if (r.textos?.length) blocos.push(...r.textos.map((t) => `• ${t}`).filter((b) => !blocos.includes(b))); // a mesma frase de dois especialistas aparece uma vez
    else blocos.push(`• ${r.intencao}: dados disponíveis em anexo estruturado.`);
  }
  return blocos.length ? blocos.join("\n") : "Não há dados para responder a essa pergunta.";
}
