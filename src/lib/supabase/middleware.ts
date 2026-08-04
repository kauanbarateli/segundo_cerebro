import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { publicEnv, isSupabaseConfigured } from "@/lib/env";
import { cookieOptions } from "@/lib/supabase/cookie-options";

const PUBLIC_PATHS = ["/login", "/auth"];

/**
 * Rotas que o portão de SESSÃO deste middleware precisa deixar passar porque
 * ELAS PRÓPRIAS autenticam — e por um mecanismo que não é cookie.
 *
 * O caso concreto: /api/google/calendar/sync tem dois chamadores. O usuário
 * clicando "Sincronizar agora" (sessão) e um AGENDADOR autenticando com
 * `CRON_SECRET` (ver src/lib/cron-auth.ts). O agendador é um robô: por
 * definição ele não tem cookie de sessão. Como o matcher de src/middleware.ts
 * casa /api/*, a requisição do robô batia na regra `!user && !isPublic` logo
 * abaixo e virava um 307 para /login — a validação do segredo NUNCA rodava, e o
 * ramo que sincroniza as contas de todo mundo era código morto. Pior: o
 * agendador registraria 307/200 (a página de login) e a falha seria silenciosa,
 * com aparência de sucesso.
 *
 * POR QUE NÃO BASTA PÔR "/api" EM PUBLIC_PATHS: isso tiraria o portão de sessão
 * de TODAS as rotas de API de uma vez, incluindo as que dependem dele. A
 * isenção é nominal, uma rota por vez, e cada entrada aqui é uma promessa de
 * que aquele handler recusa sozinho quem não se autenticou.
 *
 * POR QUE A COMPARAÇÃO É EXATA (e não `startsWith` como a de PUBLIC_PATHS):
 * prefixo isentaria qualquer caminho que só COMEÇASSE com o nome — um futuro
 * /api/google/calendar/sync-tudo entraria de carona numa isenção que ninguém
 * escreveu para ele. Isenção de segurança não se herda por parentesco de nome.
 *
 * A rota isentada continua fechada: com credencial de cron errada ela devolve
 * 401 na hora; sem credencial nenhuma ela cai no caminho da sessão e devolve
 * 401 se não houver usuário. O middleware deixa de bloquear; ninguém deixa de
 * autenticar.
 */
const SELF_AUTHENTICATED_PATHS = [
  "/api/google/calendar/sync",
  /*
    ⚠️ SEM ESTA LINHA, O E-MAIL SEMANAL NUNCA SAI — e sai em silêncio.

    O agendador chama sem cookie. O middleware o redirecionaria para /login, e o
    log da Vercel registraria 307/200: a aparência exata de um job que funciona.
    É a mesma armadilha que a rota de sync documenta logo acima, e ela custou
    para ser encontrada uma vez.

    A promessa que esta entrada faz: `/api/metrics/email` recusa sozinha quem
    não se autenticou. E ela é mais estrita que a do sync — não tem caminho de
    sessão nenhum, então credencial ausente é 401 igual a credencial errada.
  */
  "/api/metrics/email",
];

/** Exportado para o teste conseguir afirmar sobre a decisão sem subir servidor. */
export function isSelfAuthenticatedPath(pathname: string): boolean {
  // A barra final é aparada porque `/rota` e `/rota/` são a MESMA rota para o
  // Next, e a igualdade crua trataria a segunda como estranha e a redirecionaria.
  const normalizado = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return SELF_AUTHENTICATED_PATHS.includes(normalizado);
}

/**
 * Refreshes the Supabase session on every request and redirects unauthenticated
 * users to /login. Keeps the cookie in sync between server and client.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  // If Supabase isn't configured yet, let the app render (it will show setup
  // states) instead of crashing.
  if (!isSupabaseConfigured()) {
    return response;
  }

  // Este é o cliente que MAIS grava cookie — o refresh de sessão acontece aqui,
  // a cada requisição. Ver src/lib/supabase/cookie-options.ts.
  const supabase = createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseAnonKey, {
    cookieOptions,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic =
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || isSelfAuthenticatedPath(pathname);

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirectedFrom", pathname);
    return NextResponse.redirect(url);
  }

  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return response;
}
