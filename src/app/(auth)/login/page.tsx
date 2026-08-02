"use client";

import { useActionState } from "react";
import { signIn } from "@/app/(auth)/actions";
import type { AuthState } from "@/lib/action-types";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { isSupabaseConfigured } from "@/lib/env";

const initialState: AuthState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, initialState);
  const configured = isSupabaseConfigured();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-md border border-line-strong text-ink">
            <Icon.Vault width={20} height={20} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink">Segundo Cérebro</h1>
            <p className="mt-1 text-corpo text-ink-muted">
              Tudo que importa, em um só lugar.
            </p>
          </div>
        </div>

        {!configured && (
          <div className="mb-4 rounded-md border border-line bg-surface-muted p-3 text-corpo text-ink-muted">
            Supabase ainda não configurado. Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em <code>.env.local</code>.
          </div>
        )}

        <form action={formAction} className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-subtle">
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
              className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
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
              className="h-10 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink focus-visible:outline-2"
            />
          </div>

          {state.error && (
            <p role="alert" className="text-corpo text-red-600 dark:text-red-400">
              {state.error}
            </p>
          )}

          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
            {pending ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <p className="mt-4 text-center text-legenda text-ink-subtle">
          O cadastro público está desativado. Contas são criadas pelo proprietário no Supabase.
        </p>
      </div>
    </main>
  );
}
