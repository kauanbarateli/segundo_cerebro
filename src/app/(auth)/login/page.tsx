"use client";

import { useActionState } from "react";
import { signIn } from "@/app/(auth)/actions";
import type { AuthState } from "@/lib/action-types";
import { Button } from "@/components/ui/Button";
import { Logotipo } from "@/components/ui/Logotipo";
import { isSupabaseConfigured } from "@/lib/env";
import { CLASSE_DO_CAMPO } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";

const initialState: AuthState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const configured = isSupabaseConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        {/*
          A MARCA, e não mais um cadeado.

          Aqui havia um `Icon.Vault` — o ícone do módulo Cofre — dentro de um
          quadrado com borda, servindo de logotipo. Ele dizia a coisa errada em
          duas frentes: prometia um gerenciador de senhas na primeira tela de um
          produto que é um segundo cérebro, e repetia, com outro desenho, um
          ícone que a barra lateral usa para significar outra coisa.

          Esta é a primeira tela que qualquer pessoa vê, e a única em que o
          lockup completo cabe sem disputar espaço. O `<h1>` continua existindo
          como texto — o `sr-only` abaixo — porque a página precisa de um título
          de nível 1 para o leitor de tela e para o esboço do documento; o que
          saiu foi a DUPLICAÇÃO visual do nome, que agora está desenhado no
          lockup.

          `size={52}` dá ao lockup ~190px de largura, acima do mínimo de 136px do
          kit da marca. A área de proteção (¼ do símbolo = 13px) é coberta com
          folga pelo `mb-8` abaixo e pelo centramento da coluna.
        */}
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <h1 className="sr-only">Segundo Cérebro</h1>
          <Logotipo variante="horizontal" size={52} />
          <p className="text-corpo-forte text-ink-muted">Tudo que importa, em um só lugar.</p>
        </div>

        {!configured && (
          <div className="mb-4 rounded-md border border-line bg-surface-muted p-3 text-corpo text-ink-muted">
            Supabase ainda não configurado. Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em <code>.env.local</code>.
          </div>
        )}

        <form action={formAction} className="space-y-4 rounded-lg border border-line bg-surface p-6 shadow-subtle">
          <div>
            <label htmlFor="email" className="mb-1.5 block text-corpo font-medium text-ink">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={cn(CLASSE_DO_CAMPO, "w-full")}
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1.5 block text-corpo font-medium text-ink">
              Senha
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={cn(CLASSE_DO_CAMPO, "w-full")}
            />
          </div>

          {state.error && (
            <p role="alert" className="text-corpo text-danger-ink">
              {state.error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-5 text-center text-legenda text-ink-muted">
          O cadastro público está desativado. Contas são criadas pelo proprietário no Supabase.
        </p>
      </div>
    </main>
  );
}
