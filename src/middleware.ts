import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { CABECALHO_CSP, gerarNonce, politicaDeSegurancaDeConteudo } from "@/lib/csp";

/**
 * A política deixou de ser constante de módulo: ela agora carrega um NONCE
 * diferente a cada requisição (E3). Montá-la uma vez por processo é
 * exatamente o que não pode acontecer — um nonce reutilizado entre
 * requisições é um nonce adivinhável, e uma CSP com nonce previsível não
 * protege de nada.
 */
export async function middleware(request: NextRequest) {
  const nonce = gerarNonce();
  const csp = politicaDeSegurancaDeConteudo(nonce);

  /*
    O NONCE PRECISA CHEGAR AO NEXT PELA REQUISIÇÃO, e é isto que faz a peça
    inteira funcionar.

    O Next carimba os próprios scripts inline (o bootstrap e os
    `self.__next_f.push` do streaming) com um nonce que ele NÃO inventa: ele o
    EXTRAI do cabeçalho de CSP que encontra na requisição — `app-render` aceita
    tanto `content-security-policy` quanto `content-security-policy-report-only`.
    Sem escrever a política aqui, o Next não sabe que existe nonce, não carimba
    nada, e todo script dele viraria violação.

    Por isso a política é escrita DUAS vezes, com o mesmo valor:
      - na REQUISIÇÃO (abaixo), para o Next ler o nonce;
      - na RESPOSTA (no fim), para o navegador aplicar a política.

    `updateSession` recebe a requisição já com o cabeçalho porque é ele quem
    constrói o `NextResponse.next({ request })` que propaga os cabeçalhos de
    requisição adiante.
  */
  request.headers.set(CABECALHO_CSP, csp);
  request.headers.set("x-nonce", nonce);

  const response = await updateSession(request);

  /*
    O cabeçalho é carimbado AQUI, sobre a resposta que `updateSession` já
    decidiu, e não lá dentro. `updateSession` devolve três coisas diferentes
    (um `next()`, um `next()` reconstruído pelo `setAll` dos cookies, e
    `redirect()`s de sessão), e mexer naquele arquivo para carimbar cada uma
    seria arriscar a propagação dos cookies de sessão. Carimbar no fim pega
    todos os caminhos com uma linha só.
  */
  response.headers.set(CABECALHO_CSP, csp);
  return response;
}

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
