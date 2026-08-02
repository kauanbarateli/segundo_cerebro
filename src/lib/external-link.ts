/**
 * Links EXTERNOS que a aplicação exibe — validação e rotulagem (SB-SEC-019).
 *
 * ============================================================================
 * O DEFEITO
 * ============================================================================
 * `conference_data` é um blob JSON copiado do Google Agenda e gravado sem
 * inspeção. A interface pescava `entryPoints[].uri`, transformava em `<a href>`
 * e escrevia **"Google Meet"** ao lado — o rótulo era uma constante no JSX, não
 * uma conclusão sobre o link.
 *
 * O convite de agenda é conteúdo de TERCEIRO: qualquer pessoa que saiba seu
 * e-mail cria um evento e te convida, e o Google sincroniza. Quem controla o
 * convite controla aquele `uri`. Resultado: um endereço arbitrário aparecia na
 * sua agenda com o selo de Google Meet, num aplicativo em que você já está
 * logado — a montagem de phishing pronta, com a credibilidade emprestada pela
 * própria interface.
 *
 * ============================================================================
 * AS TRÊS REGRAS
 * ============================================================================
 *   1. Só `https:`. Fecha `javascript:` (executa script na origem do Cofre),
 *      `data:` (documento inteiro embutido na URL) e `http:` (texto em claro).
 *   2. O HOSTNAME é exibido. O usuário decide clicar vendo para onde vai, em vez
 *      de ver um rótulo escolhido pelo remetente.
 *   3. O rótulo "Google Meet" exige `meet.google.com` EXATO.
 *
 * ============================================================================
 * POR QUE IGUALDADE EXATA, E NÃO `includes` OU `endsWith`
 * ============================================================================
 * As duas formas óbvias são as duas erradas:
 *
 *   - `hostname.includes("meet.google.com")` aceita
 *     `meet.google.com.phishing.example` — o domínio de verdade é
 *     `phishing.example`, e o resto é só rótulo.
 *   - `hostname.endsWith("google.com")` aceita `evilgoogle.com`. Sem o ponto, a
 *     verificação de sufixo casa no meio de um nome.
 *
 * E o terceiro caso, que nenhuma comparação de string pega:
 * `https://meet.google.com@phishing.example/x` tem hostname
 * `phishing.example` — o trecho antes do `@` é usuário e senha. Por isso a
 * credencial embutida é recusada ANTES de qualquer comparação de host: é o
 * disfarce mais eficaz que existe contra leitura humana da URL.
 *
 * ============================================================================
 * DIFERENÇA PARA `urlSegura` (social.ts)
 * ============================================================================
 * `urlSegura` valida o que o USUÁRIO DIGITA e por isso é gentil: aceita
 * "instagram.com/fulano" e completa o `https://`. Aqui a entrada é dado de
 * MÁQUINA, vindo de terceiro. Completar esquema ausente seria transformar uma
 * string malformada — sinal de que algo está errado — em link navegável. Aqui,
 * sem `https://` explícito, não há link.
 */

/** Mesmo teto de `urlSegura`, pelo mesmo motivo: URL não é lugar de payload. */
const TAMANHO_MAXIMO = 2048;

/** Host exato do Google Meet. Ver "POR QUE IGUALDADE EXATA" acima. */
const HOST_GOOGLE_MEET = "meet.google.com";

export interface LinkExterno {
  /** Forma canônica, pronta para o `href`. */
  href: string;
  /** Para exibir ao lado do link: `meet.google.com`, `zoom.us`, … */
  hostname: string;
  /** `true` SOMENTE quando o host é exatamente `meet.google.com`. */
  ehGoogleMeet: boolean;
  /** O que escrever no link: "Google Meet" ou o próprio hostname. */
  rotulo: string;
}

/**
 * Devolve `null` para tudo que não for um https legítimo — e `null` significa
 * NÃO RENDERIZAR LINK NENHUM. Recusar é a resposta certa: um link que não passa
 * nestas regras não tem versão segura de si mesmo que valha a pena exibir.
 */
export function analisarLinkExterno(bruto: unknown): LinkExterno | null {
  if (typeof bruto !== "string") return null;

  const limpa = bruto.trim();
  if (limpa.length === 0 || limpa.length > TAMANHO_MAXIMO) return null;

  let url: URL;
  try {
    url = new URL(limpa);
  } catch {
    return null;
  }

  // Regra 1. `url.protocol` já vem em minúscula e com os dois-pontos, então
  // "HTTPS://", "https://" e "hTtPs://" convergem aqui — comparar a string
  // original deixaria passar variações de caixa.
  if (url.protocol !== "https:") return null;

  // Credencial embutida: o disfarce descrito no cabeçalho. Recusado antes de
  // olhar o host.
  if (url.username.length > 0 || url.password.length > 0) return null;

  const hostname = url.hostname.toLowerCase();
  if (hostname.length === 0 || !hostname.includes(".")) return null;

  const ehGoogleMeet = hostname === HOST_GOOGLE_MEET;

  return {
    href: url.toString(),
    hostname,
    ehGoogleMeet,
    // Quando não é o Meet, o rótulo É o hostname: não existe nome amigável em
    // que se possa confiar para um domínio arbitrário, e inventar um ("Entrar
    // na reunião") devolveria ao link exatamente a credibilidade que a regra 2
    // tirou dele.
    rotulo: ehGoogleMeet ? "Google Meet" : hostname,
  };
}
