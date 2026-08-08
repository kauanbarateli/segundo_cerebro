# Segundo Cérebro

Central pessoal para externalizar o que importa: **Início, Capturar, Tarefas,
Calendário e Cofre**. Primeira versão pequena, consistente e segura.

- **Stack:** Next.js (App Router) · React 19 · TypeScript estrito · Tailwind CSS
  · Supabase (Postgres + Auth) · Google Calendar API (somente leitura) · Zod.
- **Datas:** armazenadas em UTC; timezone padrão `America/Sao_Paulo`.
- **Segurança:** RLS em todas as tabelas pessoais; refresh tokens do Google
  cifrados no servidor (AES-256-GCM); **cofre com criptografia no cliente**
  (Argon2id + AES-256-GCM) — o servidor nunca vê a senha mestra nem conteúdo em
  claro.

---

## 1. O que foi construído

| Área | Estado |
|---|---|
| Banco de dados (13 tabelas, RLS, triggers, funções) | ✅ migration + seed + docs |
| Autenticação (login por e-mail/senha, middleware, proteção de rotas) | ✅ |
| **Início** (modo do dia, próximo movimento, tarefas de hoje, memória rápida, próximos eventos, resumo) | ✅ |
| **Capturar** (ideia/tarefa/nota/lembrete, autosave de rascunho, caixa de entrada, conversão em tarefa, arquivar) | ✅ |
| **Tarefas** (CRUD, concluir/reabrir/arquivar, filtros, prioridade, categoria, dia inteiro; tabela no desktop, cards no mobile) | ✅ |
| **Calendário** (2 slots Google, OAuth independente, dia/semana/mês/lista, filtros por conta, somente leitura) | ✅ |
| **Cofre** (senha mestra, desbloqueio, auto-bloqueio 5 min, CRUD cifrado, copiar/revelar, kit de recuperação) | ✅ |
| Tema claro/escuro monocromático | ✅ |
| Testes (criptografia + validação) | ✅ 14 testes |

## 2. Arquivos principais

```
supabase/migrations/0001_second_brain_initial.sql   # schema + RLS + funções
supabase/seed.sql                                    # backfill sem dados pessoais
docs/database-setup.md                               # aplicar/validar/rollback
docs/google-calendar-setup.md                        # Google Cloud + OAuth
docs/papeis-e-admin.md                               # papéis, bloqueio, /admin
docs/datas-e-fuso.md                                 # ⚠️ leia antes de mexer em data
e2e/README.md                                        # os 5 fluxos e como rodá-los
.env.example                                          # variáveis (placeholders)

src/lib/tempo.ts                                     # ⚠️ a autoridade sobre fuso
src/lib/supabase/{client,server,admin,middleware}.ts # 3 clientes Supabase
src/lib/crypto/tokens.ts                             # AES-256-GCM (servidor)
src/lib/crypto/vault.ts                              # Argon2id + AES-GCM (cliente)
src/lib/google/{oauth,calendar}.ts                   # OAuth + sync (servidor)
src/app/(auth)/login                                 # tela de login
src/app/(app)/{page,capturar,tarefas,calendario,cofre}  # as 5 telas
src/app/api/google/calendar/*                         # connect/callback/sync/disconnect/accounts
src/components/...                                     # design system + features
```

## 3. Como executar o SQL

Detalhes em [`docs/database-setup.md`](docs/database-setup.md).

- **Dashboard:** SQL Editor → cole `supabase/migrations/0001_second_brain_initial.sql` → Run. Opcional: `supabase/seed.sql`.
- **CLI:** `supabase db push` (remoto) ou `supabase db reset` (local, aplica migration + seed).

## 4. Como configurar o Supabase

1. Crie o projeto e aplique o SQL (passo 3).
2. **Desative o cadastro público** (uso pessoal): Authentication → Providers →
   Email → desmarque *Allow new users to sign up*.
3. Crie o seu usuário: Authentication → Users → **Add user**. O trigger
   `handle_new_user` cria perfil, preferências e categorias iniciais.
4. Preencha no `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

## 5. Como configurar o Google Calendar

Passo a passo em [`docs/google-calendar-setup.md`](docs/google-calendar-setup.md):
projeto no Google Cloud → ativar Calendar API → tela de consentimento → cliente
OAuth Web → redirect URIs → usuários de teste → copiar Client ID/Secret →
`TOKEN_ENCRYPTION_KEY`.

## 6. Como iniciar a aplicação

```bash
npm install
cp .env.example .env.local   # e preencha os valores
npm run dev                  # http://localhost:3000
```

Scripts: `npm run build`, `npm run start`, `npm run typecheck`,
`npm run lint`, `npm run test`.

Qualidade: `npm run coverage` (relatório local, sem meta global — serve para
achar o arquivo com zero), `npm run camadas` (contrato de arquitetura; as quatro
regras estão em `.dependency-cruiser.cjs`), `npm run morto` (código morto, em
modo relatório), `npm run e2e` (os cinco fluxos — leia `e2e/README.md` antes:
eles criam e apagam dado e **nunca** devem apontar para produção).

⚠️ Rode a suíte também com `TZ=UTC` de vez em quando. É o fuso da Vercel, e foi
onde um defeito de data se escondeu por meses — em máquina local o fuso do
servidor coincide com o da tela e o ida-e-volta fecha. Ver `docs/datas-e-fuso.md`.

## 7. O que ainda depende de credenciais

A aplicação **abre e funciona sem** as credenciais do Google — o Calendário
mostra um estado de *configuração pendente* sem quebrar o resto.

- **Login / dados:** exige Supabase configurado (URL, anon key, service role).
- **Calendário:** exige `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `GOOGLE_REDIRECT_URI` e `TOKEN_ENCRYPTION_KEY`.
- **Cofre:** não exige credenciais externas; depende da senha mestra que **você**
  define no primeiro uso.

## 8. Limitações de segurança

- **Cofre:** se você **perder a senha mestra e o kit de recuperação**, os dados
  ficam **irrecuperáveis** por design (o servidor não tem como descriptografar).
- Dados descriptografados do cofre vivem **apenas na memória da aba** e são
  limpos ao bloquear; o JavaScript não garante zeragem imediata de memória.
- `TOKEN_ENCRYPTION_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são **segredos de
  servidor** — nunca os exponha no cliente nem os versione.
- Google Calendar é **somente leitura**; não há criação/edição de eventos.
- Não há verificação do app no Google: em produção com Workspace pode ser
  necessário verificar o app ou usar usuários de teste.

## 9. Próximos passos recomendados

1. Sincronização agendada do Calendário (Vercel Cron + `CRON_SECRET`).
2. Push notifications do Google (watch channels — colunas já reservadas).
3. Busca global (a caixa de busca do cabeçalho é um placeholder).
4. Etiquetas nas tarefas (tabelas `tags`/`task_tags` já existem).
5. Rotação de chave / versionamento de criptografia (`crypto_version` já previsto).
6. Gerar tipos do banco com `supabase gen types typescript` para substituir
   `src/lib/database.types.ts`.

> As tabelas foram preparadas para crescer, mas nada fora do escopo desta versão
> foi implementado — apenas o essencial, pequeno e utilizável.
