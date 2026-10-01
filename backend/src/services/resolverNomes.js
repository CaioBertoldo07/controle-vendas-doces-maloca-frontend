/**
 * Resolução de cliente e sabores a partir de texto livre (ex.: /vendas/auto e,
 * no futuro, os agentes).
 *
 * Etapa 0.6: a resolução CLASSIFICA o resultado e nunca escolhe um registro
 * por ordem de cadastro:
 *   EXATO          → nome normalizado igual a um único registro;
 *   PARCIAL_UNICO  → nenhum exato e um único registro "contém/está contido";
 *   AMBIGUO        → mais de um candidato (exato ou parcial): nenhum é escolhido;
 *   NAO_ENCONTRADO → nenhum candidato;
 *   INVALIDO       → o texto não tem letras nem números depois de normalizado.
 * Candidatos saem só com { id, nome }.
 */
import { prisma } from "../lib/prisma.js";

export const RESOLUCAO = Object.freeze({
  EXATO: "EXATO",
  PARCIAL_UNICO: "PARCIAL_UNICO",
  AMBIGUO: "AMBIGUO",
  NAO_ENCONTRADO: "NAO_ENCONTRADO",
  INVALIDO: "INVALIDO",
});

// Normaliza string para comparação: "Doce de Leite" -> "docedeleite"
function normalizar(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/[^a-z0-9]/g, ""); // remove espaços e especiais
}

const candidato = (r) => ({ id: r.id, nome: r.nome });

/**
 * Classifica `texto` contra `registros` ({ id, nome }, na ordem desejada para
 * os candidatos). Pura. Devolve { tipo, registro? , candidatos? }.
 */
export function classificar(texto, registros) {
  const alvo = typeof texto === "string" ? normalizar(texto) : "";
  if (!alvo) return { tipo: RESOLUCAO.INVALIDO };

  const comNome = registros.map((r) => ({ r, n: normalizar(r.nome) }));

  // 1. Exato tem prioridade sobre parcial
  const exatos = comNome.filter((x) => x.n === alvo).map((x) => x.r);
  if (exatos.length === 1) return { tipo: RESOLUCAO.EXATO, registro: exatos[0] };
  if (exatos.length > 1) return { tipo: RESOLUCAO.AMBIGUO, candidatos: exatos.map(candidato) };

  // 2. Parcial: o texto contém o nome ou está contido nele
  const parciais = comNome.filter((x) => x.n && (x.n.includes(alvo) || alvo.includes(x.n))).map((x) => x.r);
  if (parciais.length === 1) return { tipo: RESOLUCAO.PARCIAL_UNICO, registro: parciais[0] };
  if (parciais.length > 1) return { tipo: RESOLUCAO.AMBIGUO, candidatos: parciais.map(candidato) };

  return { tipo: RESOLUCAO.NAO_ENCONTRADO };
}

/** { tipo, cliente } se resolvido; { tipo, candidatos } se ambíguo; { tipo } nos demais. */
export async function resolverCliente(nomeTexto) {
  const clientes = await prisma.cliente.findMany({ orderBy: { id: "asc" } });
  const { tipo, registro, candidatos } = classificar(nomeTexto, clientes);
  if (registro) return { tipo, cliente: registro };
  return candidatos ? { tipo, candidatos } : { tipo };
}

/**
 * itens: [{ nome, quantidade }]. Só sabores ATIVOS são considerados.
 * Devolve { sabores: [{ saborId, quantidade }], naoEncontrados: [nome],
 * ambiguos: [{ nome, candidatos }], invalidos: [nome | null] }.
 * KNOWN_BEHAVIOR (mantido): o mesmo sabor pode aparecer em dois itens.
 */
export async function resolverSabores(saboresTexto) {
  const saboresDB = await prisma.sabor.findMany({ where: { ativo: true }, orderBy: { id: "asc" } });

  const resultado = { sabores: [], naoEncontrados: [], ambiguos: [], invalidos: [] };

  for (const item of saboresTexto) {
    const { tipo, registro, candidatos } = classificar(item?.nome, saboresDB);
    if (registro) resultado.sabores.push({ saborId: registro.id, quantidade: item.quantidade });
    else if (tipo === RESOLUCAO.AMBIGUO) resultado.ambiguos.push({ nome: item.nome, candidatos });
    else if (tipo === RESOLUCAO.INVALIDO) resultado.invalidos.push(item?.nome ?? null);
    else resultado.naoEncontrados.push(item.nome);
  }
  return resultado;
}
