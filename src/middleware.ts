import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { CABECALHO_CSP, politicaDeSegurancaDeConteudo } from "@/lib/csp";

/**
 * A política é constante dentro do processo (só depende de env), então é
 * montada UMA vez por instância e não a cada requisição. Vira função de novo no
 * dia em que a promoção trouxer o nonce por requisição — ver src/lib/csp.ts.
 */
const CSP = politicaDeSegurancaDeConteudo();

export async function middleware(request: NextRequest) {
  const response = await updateSession(request);

  /*
    O cabeçalho é carimbado AQUI, sobre a resposta que `updateSession` já
    decidiu, e não lá dentro. `updateSession` devolve três coisas diferentes
    (um `next()`, um `next()` reconstruído pelo `setAll` dos cookies, e
    `redirect()`s de sessão), e mexer naquele arquivo para carimbar cada uma
    seria arriscar a propagação dos cookies de sessão — o custo mais caro
    possível para um cabeçalho que, em modo relatório, não bloqueia nada.
    Carimbar no fim pega todos os caminhos com uma linha só.
  */
  response.headers.set(CABECALHO_CSP, CSP);
  return response;
}

export const config = {
  // Run on everything except static assets and image optimization.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
