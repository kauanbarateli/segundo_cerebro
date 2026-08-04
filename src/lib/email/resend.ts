import "server-only";

import { serverEnv } from "@/lib/env";

/**
 * ENVIO DE E-MAIL PELA RESEND — e é o ÚNICO arquivo que fala com ela.
 *
 * Mesmo desenho de `clickup/capabilities.ts`: uma superfície só. Quando alguém
 * precisar de "mais um endpoint da Resend", a conversa acontece aqui e não
 * espalhada por três rotas.
 *
 * ============================================================================
 * ZERO DEPENDÊNCIA NOVA
 * ============================================================================
 * O SDK oficial existe e não é usado: o envio é um `POST` com JSON. Uma
 * dependência a mais no `package.json` é superfície de auditoria, é uma linha a
 * mais no `npm audit --omit=dev` do CI e é um pacote que precisa de atualização
 * — em troca de montar um objeto e chamar `fetch`.
 *
 * ============================================================================
 * ⚠️ SEM DOMÍNIO VERIFICADO, O DESTINATÁRIO É OBRIGATORIAMENTE O DONO DA CONTA
 * ============================================================================
 * A Resend deixa enviar de `onboarding@resend.dev` sem verificar domínio, com
 * uma restrição: o destinatário tem que ser o e-mail da conta Resend. Para um
 * aplicativo de uma pessoa só, que manda para si mesma, isso não é limitação —
 * é exatamente o caso.
 *
 * Quando houver domínio verificado, `RESEND_FROM` troca o remetente e nada mais
 * muda. Por isso ele é variável e não constante.
 */

const ENDERECO_DA_API = "https://api.resend.com/emails";

/** O remetente de fábrica da Resend, que dispensa domínio verificado. */
const REMETENTE_PADRAO = "Segundo Cérebro <onboarding@resend.dev>";

/**
 * Dez segundos, igual ao do ClickUp.
 *
 * Sem teto, uma requisição pendurada segura a execução agendada até o limite da
 * plataforma — e uma função de cron que estoura o tempo é indistinguível, no
 * log, de uma que travou.
 */
const TEMPO_LIMITE_MS = 10_000;

export type ResultadoDeEnvio =
  | { ok: true; id: string | null }
  | { ok: false; erro: string };

export interface Mensagem {
  para: string;
  assunto: string;
  html: string;
  texto: string;
}

/** A chave está configurada? Quem chama decide o que fazer com "não". */
export function resendConfigurado(): boolean {
  return Boolean(serverEnv().resendApiKey);
}

/**
 * Manda o e-mail.
 *
 * ⚠️ NUNCA LANÇA. Devolve `{ ok: false, erro }` para tudo — rede, 4xx, 5xx,
 * tempo esgotado. Uma exceção aqui subiria pela rota de cron e viraria 500, e
 * um 500 na plataforma costuma virar RETENTATIVA: o segundo disparo cairia na
 * UNIQUE de idempotência e não reenviaria, mas o log ficaria contando uma
 * história de erro de servidor que não é a verdade. Erro devolvido é erro que
 * dá para registrar na linha da entrega.
 *
 * A mensagem de erro é truncada porque ela vai para uma coluna de texto que
 * ninguém vai ler inteira — e porque resposta de provedor às vezes vem com um
 * HTML de página de erro dentro.
 */
export async function enviarEmail(mensagem: Mensagem): Promise<ResultadoDeEnvio> {
  const { resendApiKey, resendFrom } = serverEnv();
  if (!resendApiKey) return { ok: false, erro: "RESEND_API_KEY não configurada" };

  try {
    const resposta = await fetch(ENDERECO_DA_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom || REMETENTE_PADRAO,
        to: [mensagem.para],
        subject: mensagem.assunto,
        html: mensagem.html,
        // As duas versões vão juntas — ver `corpoDoEmail` em metrics.ts.
        text: mensagem.texto,
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      // Nada aqui pode ser cacheado pelo Next: é um POST com efeito colateral.
      cache: "no-store",
    });

    if (!resposta.ok) {
      const detalhe = (await resposta.text().catch(() => "")).slice(0, 300);
      return { ok: false, erro: `Resend respondeu ${resposta.status}: ${detalhe}` };
    }

    const corpo = (await resposta.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, id: corpo?.id ?? null };
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e);
    return { ok: false, erro: motivo.slice(0, 300) };
  }
}
