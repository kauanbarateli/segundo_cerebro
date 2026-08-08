/**
 * O canal de contato para quem não consegue entrar.
 *
 * ============================================================================
 * ⚠️ O NÚMERO AINDA NÃO FOI DEFINIDO — e o vazio é um estado previsto
 * ============================================================================
 * Enquanto `NUMERO_DE_WHATSAPP` estiver em branco, `linkDeContato()` devolve
 * `null` e a tela de login NÃO desenha o link. A alternativa — deixar um número
 * de exemplo no lugar — é pior de um jeito específico: um link de WhatsApp
 * aponta para uma pessoa REAL, e um número inventado é o telefone de alguém que
 * passaria a receber pedidos de suporte de um sistema que não conhece.
 *
 * Para ligar: preencha a constante com o número em formato internacional, só
 * dígitos (`55` + DDD + número). O link aparece sozinho.
 */
const NUMERO_DE_WHATSAPP = "";

/**
 * O texto que já vai escrito na conversa.
 *
 * Existe porque a mensagem que a pessoa manda sozinha costuma ser "oi" — e aí a
 * conversa gasta duas idas e voltas para chegar ao assunto. Dizer de onde o
 * contato partiu economiza as duas.
 */
const MENSAGEM_PADRAO = "Olá! Estou com problemas para acessar o Segundo Cérebro.";

/** Só dígitos: o `wa.me` recusa espaço, parêntese, hífen e o `+`. */
const SO_DIGITOS = /^\d{10,15}$/;

export interface Contato {
  href: string;
  rotulo: string;
}

/**
 * Devolve o link pronto, ou `null` quando não há número configurado.
 *
 * `null` e não uma string vazia: quem chama precisa DECIDIR o que fazer sem
 * canal, e uma string vazia num `href` produz um link que recarrega a própria
 * página — o pior dos dois mundos, porque parece funcionar.
 *
 * A validação de formato existe para o mesmo tipo de erro que ela pega em todo
 * lugar deste projeto: um número colado com `+55 (11) 99999-9999` viraria uma
 * URL malformada, e o defeito só apareceria quando alguém clicasse — que é
 * justamente o momento em que a pessoa já está com problema.
 */
export function linkDeContato(numero: string = NUMERO_DE_WHATSAPP): Contato | null {
  const limpo = numero.trim();
  if (limpo.length === 0) return null;
  if (!SO_DIGITOS.test(limpo)) return null;

  return {
    href: `https://wa.me/${limpo}?text=${encodeURIComponent(MENSAGEM_PADRAO)}`,
    rotulo: "Problemas de acesso? Entre em contato",
  };
}
