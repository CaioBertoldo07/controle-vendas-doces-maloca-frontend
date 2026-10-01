// Barramento de eventos in-process (Etapa 1): só a interface. Nenhum service
// publica eventos ainda e não há cron; a autonomia por evento/agenda será
// ligada junto com os agentes específicos (Etapa 2+). Eventos in-process se
// perdem num restart: o cron futuro também precisará reconciliar.
export function criarBarramento() {
  const assinantes = new Map(); // tipo → Set<handler>

  return {
    assinar(tipo, handler) {
      if (!assinantes.has(tipo)) assinantes.set(tipo, new Set());
      assinantes.get(tipo).add(handler);
      return () => assinantes.get(tipo)?.delete(handler);
    },
    /** Entrega a todos os assinantes; a falha de um não impede os outros. */
    async publicar(tipo, dados) {
      // Promise.resolve().then: um handler que lança de forma síncrona também vira falha isolada
      const resultados = await Promise.allSettled([...(assinantes.get(tipo) ?? [])].map((h) => Promise.resolve().then(() => h(dados, tipo))));
      return { entregues: resultados.length, falhas: resultados.filter((r) => r.status === "rejected").length };
    },
  };
}
