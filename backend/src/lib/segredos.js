// Barreira de saída contra vazamento de segredos (Etapa 5). Aplicada ao texto
// do assistente antes de gravar ou devolver: se aparecer o VALOR de uma
// variável sensível do ambiente ou um padrão típico de credencial, o texto é
// trocado por uma recusa. Os agentes nem recebem o ambiente; isto cobre o
// caso de o modelo inventar algo parecido com um segredo.
const VARIAVEIS_SENSIVEIS = ["DATABASE_URL", "DATABASE_URL_TEST", "DATABASE_URL_COLETA", "JWT_SECRET", "N8N_API_KEY", "ANTHROPIC_API_KEY", "MYSQL_PASSWORD", "MYSQL_ROOT_PASSWORD"];
const PADROES = [/sk-ant-[a-z0-9-]{8,}/i, /\b(mysql|postgres(ql)?|mongodb):\/\/\S+/i, /\b(DATABASE_URL|JWT_SECRET|ANTHROPIC_API_KEY|N8N_API_KEY)\s*[=:]/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];

export const RECUSA_SEGREDO = "Não posso mostrar configurações, credenciais ou detalhes internos do sistema.";

/** { texto, bloqueado } */
export function filtrarSegredos(texto, env = process.env) {
  const t = String(texto ?? "");
  const valores = VARIAVEIS_SENSIVEIS.map((k) => env[k]).filter((v) => typeof v === "string" && v.length >= 8);
  if (valores.some((v) => t.includes(v)) || PADROES.some((p) => p.test(t))) return { texto: RECUSA_SEGREDO, bloqueado: true };
  return { texto: t, bloqueado: false };
}
