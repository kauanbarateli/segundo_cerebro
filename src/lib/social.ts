/**
 * Links sociais — a parte PURA: validar a URL que o usuário digita e escolher o
 * ícone a partir do domínio. Sem I/O, sem zod, sem React.
 *
 * POR QUE ESTE ARQUIVO EXISTE SEPARADO
 *
 * O valor que sai daqui vira o atributo `href` de um `<a>`. Um `href` não é
 * texto: o navegador EXECUTA o esquema. `href="javascript:alert(1)"` roda script
 * no contexto da sessão da pessoa — no mesmo site onde mora o Cofre, com acesso
 * ao mesmo cookie de sessão e à mesma origem. Ou seja, o campo "meu Instagram"
 * é, sem tratamento, um XSS armazenado com persistência no banco.
 *
 * `z.string().url()` NÃO resolve. Por baixo ele constrói `new URL()`, e
 * `new URL("javascript:alert(1)")` é uma URL perfeitamente VÁLIDA — só não é
 * navegável. Validade sintática e segurança são perguntas diferentes.
 *
 * As três barreiras do recurso, e onde cada uma mora:
 *   1. `urlSegura` (aqui) — allowlist de protocolo, no caminho da server action.
 *   2. CHECK em `social_links.url` (migration 0012) — pega qualquer caminho de
 *      escrita futuro que não passe por aqui.
 *   3. `rel="noopener noreferrer"` no `<a>` (interface) — sem `noopener` a página
 *      de destino recebe `window.opener` e pode trocar o conteúdo da SUA aba por
 *      uma tela falsa de login (tabnabbing).
 * Nenhuma das três substitui as outras: 1 e 2 impedem o esquema perigoso de
 * entrar, 3 protege de um destino https legítimo que se comporta mal.
 *
 * ZOD NÃO É IMPORTADO AQUI DE PROPÓSITO. `iconePorDominio` roda em componente de
 * cliente (a lista de links é renderizada no navegador), e importar `validation.ts`
 * arrastaria o zod inteiro para o pacote do navegador só para escolher um ícone.
 * O schema zod vive em `validation.ts` e CHAMA `urlSegura` num `superRefine` —
 * a regra continua escrita num lugar só.
 */

/* ------------------------------------------------------------------- limites */

/**
 * Quantos links um usuário pode ter. Exportado para que a interface (desabilitar
 * o botão "adicionar"), a server action (recusar o nono) e a migration 0012
 * (trigger de contagem) usem o MESMO número. Três cópias do literal `8` viram,
 * na primeira mudança, uma interface que promete o que o banco recusa.
 */
export const LIMITE_DE_LINKS = 8;

/**
 * Teto de caracteres da URL já normalizada. 2048 é o limite prático que os
 * navegadores e servidores toleram sem truncar. Existe aqui para casar com o
 * `varchar`/CHECK da 0012: sem teto, uma `data:` gigante... que aliás nem passa
 * do protocolo — mas uma https com querystring de 200 KB passaria, e o custo de
 * carregar isso em toda listagem é real.
 */
export const TAMANHO_MAXIMO_DA_URL = 2048;

/**
 * ALLOWLIST — a lista do que é PERMITIDO, nunca do que é proibido.
 *
 * Uma blocklist de "javascript:" esqueceria `data:`, `vbscript:`, `blob:`,
 * `file:`, `filesystem:`, `about:`, `intent:` (Android), `jar:`, e as variantes
 * que os navegadores toleram por compatibilidade histórica. Toda blocklist é uma
 * aposta em ter lembrado de tudo; a allowlist erra para o lado seguro (recusa
 * algo legítimo) em vez de para o lado do XSS.
 *
 * Só `https:`. `http:` fica de fora porque o link é público e sai da página em
 * texto claro — e porque não há site social relevante que ainda não tenha https.
 */
const PROTOCOLOS_PERMITIDOS = ["https:"] as const;

/* ------------------------------------------------------------------ urlSegura */

export type ResultadoDeUrl = { ok: true; url: string } | { ok: false; motivo: string };

/**
 * Um esquema já está escrito na entrada?
 *
 * A pergunta é literalmente "existe ':' ANTES da primeira '/'". Se existe, a
 * string se declara com um esquema (qualquer que seja) e NÃO pode ser prefixada:
 * `"https://" + "javascript:alert(1)"` produziria `https://javascript:alert(1)`,
 * que o parser lê como host `javascript` na porta `alert(1)` — comportamento
 * imprevisível e, pior, um jeito de o texto perigoso atravessar a checagem de
 * protocolo com aparência inofensiva. Só prefixamos o que claramente não tem
 * esquema nenhum.
 *
 * Efeito colateral aceito: `"exemplo.com:8080/x"` (host com porta, sem esquema)
 * cai aqui como "tem esquema" e acaba recusado. É o lado seguro do erro — a
 * pessoa escreve `https://` na frente e resolve.
 */
function pareceTerEsquema(valor: string): boolean {
  const doisPontos = valor.indexOf(":");
  if (doisPontos === -1) return false;
  const barra = valor.indexOf("/");
  return barra === -1 || doisPontos < barra;
}

/**
 * Normaliza e valida uma URL digitada pelo usuário.
 *
 * A CHECAGEM É NO `url.protocol` DEPOIS DE CONSTRUIR — nunca em regex sobre a
 * string crua. Este é o ponto inteiro da função, e o motivo é que o parser de
 * URL do WHATWG normaliza ANTES de entregar o `protocol`:
 *
 *   - remove espaços e controles do início e do fim
 *     -> "  javascript:alert(1)"   vira protocol "javascript:"
 *   - remove TODO tab (U+0009), LF (U+000A) e CR (U+000D) de dentro da string
 *     -> "java\tscript:alert(1)"   vira protocol "javascript:"
 *   - baixa o esquema para minúscula
 *     -> "JavaScript:alert(1)"     vira protocol "javascript:"
 *
 * Uma regex sobre a string crua teria que reimplementar essas três regras (e
 * acertar as três) para ver o mesmo que o navegador vê. É exatamente aí que as
 * variantes escapam: `/^javascript:/i` não casa com `"java\tscript:alert(1)"`,
 * mas o navegador executa. Deixamos o parser normalizar e perguntamos a ELE o
 * que o esquema virou — a mesma resposta que o `<a>` vai usar.
 *
 * DECISÃO: entrada SEM esquema é ACEITA e prefixada com "https://". Digitar
 * "instagram.com/fulano" é o caso comum, e obrigar o "https://" só transformaria
 * o recurso em fonte de erro chato. O prefixo só é aplicado quando não há ':'
 * antes da primeira '/' (ver `pareceTerEsquema`).
 *
 * DECISÃO: o hostname precisa ter um ponto. Sem essa regra, "fulano" viraria
 * `https://fulano/` — URL válida, link morto. Pior: "/etc/passwd" prefixado vira
 * `https://etc/passwd` (o parser engole as barras extras e chama "etc" de host),
 * e sem a regra do ponto isso passaria como link legítimo.
 *
 * DECISÃO: credenciais embutidas são RECUSADAS. Em
 * `https://github.com@evil.example/` o host de verdade é `evil.example` e
 * `github.com` é só o nome de usuário — a string parece o GitHub para quem lê e
 * leva para outro lugar. Como a interface mostra a URL e escolhe o ícone pelo
 * host, aceitar isso seria servir phishing com selo de aprovação.
 */
export function urlSegura(entrada: string): ResultadoDeUrl {
  if (typeof entrada !== "string") return { ok: false, motivo: "Informe um endereço." };

  const limpa = entrada.trim();
  if (limpa.length === 0) return { ok: false, motivo: "Informe um endereço." };
  if (limpa.length > TAMANHO_MAXIMO_DA_URL) {
    return { ok: false, motivo: `O endereço passa de ${TAMANHO_MAXIMO_DA_URL} caracteres.` };
  }

  const candidata = pareceTerEsquema(limpa) ? limpa : `https://${limpa}`;

  let url: URL;
  try {
    url = new URL(candidata);
  } catch {
    // TypeError do parser: não é URL de jeito nenhum.
    return { ok: false, motivo: "Endereço inválido." };
  }

  // A barreira. `includes` sobre a allowlist, com o protocol JÁ normalizado.
  if (!(PROTOCOLOS_PERMITIDOS as readonly string[]).includes(url.protocol)) {
    return { ok: false, motivo: "Só endereços https:// são aceitos." };
  }

  if (url.username.length > 0 || url.password.length > 0) {
    return { ok: false, motivo: "Endereço com usuário e senha embutidos não é aceito." };
  }

  if (url.hostname.length === 0 || !url.hostname.includes(".")) {
    return { ok: false, motivo: "Endereço sem domínio válido." };
  }

  // `toString()` devolve a forma canônica: host em minúscula, IDN em punycode
  // ("açaí.com.br" -> "xn--aa-4iaz.com.br"), espaços percent-encoded. Guardar o
  // canônico evita que dois links iguais escritos diferente virem duas linhas.
  const normalizada = url.toString();
  if (normalizada.length > TAMANHO_MAXIMO_DA_URL) {
    return { ok: false, motivo: `O endereço passa de ${TAMANHO_MAXIMO_DA_URL} caracteres.` };
  }

  return { ok: true, url: normalizada };
}

/* ----------------------------------------------------------- ícone por domínio */

/**
 * Nomes de ícone que a interface precisa ter em `src/components/ui/Icons.tsx`.
 *
 * É união de literais em vez de `string` para que o `Record<IconeSocial, ...>` do
 * componente seja EXAUSTIVO: acrescentar uma plataforma aqui e esquecer o SVG
 * vira erro de compilação, não um buraco na tela.
 *
 * ATENÇÃO AO "XTwitter": `Icon.X` JÁ EXISTE em Icons.tsx e é o X de FECHAR
 * (dois traços cruzados, usado em modal e toast). Chamar o ícone do x.com de "X"
 * faria a lista de links renderizar um botão de fechar — colisão silenciosa, sem
 * erro de tipo, porque a chave existiria.
 */
export type IconeSocial =
  | "Instagram"
  | "LinkedIn"
  | "GitHub"
  | "XTwitter"
  | "YouTube"
  | "Facebook"
  | "WhatsApp"
  | "Telegram"
  | "TikTok"
  | "Discord"
  | "Reddit"
  | "Spotify"
  | "Twitch"
  | "Threads"
  | "Link";

/** O ícone de quem não está na tabela. Nunca lançamos erro por domínio novo. */
export const ICONE_GENERICO: IconeSocial = "Link";

/**
 * Domínios REGISTRÁVEIS por ícone — sem "www.", sem caminho.
 *
 * Os encurtadores oficiais entram junto do domínio principal porque é o que a
 * pessoa copia do botão "compartilhar" do próprio app (youtu.be, wa.me, t.me).
 * Cuidado com o par `t.me` (Telegram) e `t.co` (X): um caractere de diferença,
 * donos diferentes.
 */
const DOMINIOS_POR_ICONE: ReadonlyArray<readonly [IconeSocial, readonly string[]]> = [
  ["Instagram", ["instagram.com", "instagr.am"]],
  ["LinkedIn", ["linkedin.com", "lnkd.in"]],
  ["GitHub", ["github.com", "github.io"]],
  ["XTwitter", ["x.com", "twitter.com", "t.co"]],
  ["YouTube", ["youtube.com", "youtu.be"]],
  ["Facebook", ["facebook.com", "fb.com", "fb.me"]],
  ["WhatsApp", ["whatsapp.com", "wa.me"]],
  ["Telegram", ["telegram.org", "telegram.me", "t.me"]],
  ["TikTok", ["tiktok.com"]],
  ["Discord", ["discord.com", "discord.gg", "discordapp.com"]],
  ["Reddit", ["reddit.com", "redd.it"]],
  ["Spotify", ["spotify.com"]],
  ["Twitch", ["twitch.tv"]],
  ["Threads", ["threads.net", "threads.com"]],
];

/**
 * O hostname é o domínio alvo, ou um subdomínio dele?
 *
 * A comparação é por HOSTNAME e o subdomínio só vale com o ponto separador.
 * `url.includes("github.com")` — o jeito óbvio e errado — casaria com
 * `https://github.com.evil.example/`, onde o domínio registrável é
 * `evil.example` e o "github.com" é só um rótulo à esquerda que qualquer um pode
 * criar. O selo do GitHub ao lado de um link para um site de terceiro é
 * exatamente o empurrão que falta para a pessoa clicar.
 *
 * O ponto em `"." + alvo` é o que separa `gist.github.com` (subdomínio de
 * verdade) de `notgithub.com` (outro domínio que só termina igual).
 */
function ehDominioOuSubdominio(hostname: string, alvo: string): boolean {
  return hostname === alvo || hostname.endsWith(`.${alvo}`);
}

/**
 * Nome do ícone a partir do domínio da URL. Pura, total, nunca lança.
 *
 * NÃO exige https: isto é escolha de ícone, não autorização de navegação — quem
 * decide o que pode ser gravado é `urlSegura`. Uma entrada impossível de
 * interpretar simplesmente recebe o ícone genérico, porque a alternativa (jogar
 * exceção) derrubaria a renderização da lista inteira por causa de uma linha.
 */
export function iconePorDominio(url: string): IconeSocial {
  if (typeof url !== "string") return ICONE_GENERICO;

  const limpa = url.trim();
  if (limpa.length === 0) return ICONE_GENERICO;

  let hostname: string;
  try {
    // Mesmo critério de prefixo da urlSegura, para que "instagram.com/fulano"
    // (ainda não normalizada, vinda de um campo em digitação) já mostre o ícone.
    hostname = new URL(pareceTerEsquema(limpa) ? limpa : `https://${limpa}`).hostname;
  } catch {
    return ICONE_GENERICO;
  }

  if (hostname.length === 0) return ICONE_GENERICO;

  for (const [icone, dominios] of DOMINIOS_POR_ICONE) {
    for (const alvo of dominios) {
      if (ehDominioOuSubdominio(hostname, alvo)) return icone;
    }
  }
  return ICONE_GENERICO;
}
