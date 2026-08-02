/**
 * Opções dos cookies de sessão do Supabase — SB-SEC-012.
 *
 * Um único objeto para os TRÊS clientes (navegador, servidor e middleware) de
 * propósito. Os três escrevem o MESMO cookie; se um deles gravar com atributos
 * diferentes dos outros, o navegador passa a tratar as gravações como cookies
 * distintos e a sessão fica com comportamento que depende de qual caminho
 * escreveu por último — o tipo de bug que só aparece em produção e some quando
 * alguém vai investigar.
 *
 * ============================================================================
 * `secure` — o que esta correção faz
 * ============================================================================
 * Sem `Secure`, o navegador envia o cookie também em HTTP puro. Basta um
 * downgrade — um link `http://`, um proxy hostil numa rede pública, um redirect
 * mal configurado — para o token de sessão viajar em claro. `Secure` faz o
 * navegador se recusar a mandá-lo fora de HTTPS.
 *
 * Condicional a `NODE_ENV` porque `localhost` não é HTTPS: com `secure` fixo em
 * true, o cookie simplesmente não seria gravado em desenvolvimento e o login
 * pararia de funcionar na máquina local. (Navegadores tratam `localhost` como
 * origem segura para várias APIs, mas NÃO aceitam cookie `Secure` sobre
 * `http://localhost`.)
 *
 * ============================================================================
 * `httpOnly` — por que NÃO está aqui
 * ============================================================================
 * Seria a proteção mais valiosa da lista: `HttpOnly` esconde o cookie do
 * JavaScript, e é o que transforma um XSS de "roubo de sessão" em "estrago
 * limitado à aba". Mas ela é INCOMPATÍVEL com a arquitetura atual.
 *
 * O cliente do navegador (`createBrowserClient`) LÊ a sessão do cookie para
 * montar o JWT que vai em toda chamada ao PostgREST e ao Storage — o upload do
 * Drive, por exemplo, fala direto com o Supabase sem passar pelo servidor Next.
 * Marcar `httpOnly` cegaria esse cliente e derrubaria tudo que não passa por
 * Server Action.
 *
 * Fazer `HttpOnly` valer exigiria um BFF: toda chamada ao Supabase passando por
 * uma rota do Next que anexa o token no servidor. É trabalho de arquitetura, não
 * uma opção de cookie, e está fora do escopo desta fase. Fica registrado aqui
 * para que a ausência seja lida como decisão, não como esquecimento.
 *
 * `sameSite` e `path` ficam com o padrão do `@supabase/ssr` (`lax` e `/`), que
 * já é o correto. Repeti-los aqui só criaria um segundo lugar para divergir da
 * biblioteca no dia em que ela mudar.
 */
export const cookieOptions = {
  secure: process.env.NODE_ENV === "production",
} as const;
