# Banco de dados — Supabase (Módulo 1)

Este documento explica como aplicar o schema do **Segundo Cérebro**, validar a
segurança (RLS) e fazer rollback/backup. O schema fica em
`supabase/migrations/0001_second_brain_initial.sql` e o backfill não-pessoal em
`supabase/seed.sql`.

---

## 0. ⚡ Migrations pendentes (v2)

Rode **na ordem**, uma de cada vez, no SQL Editor. Todas são idempotentes
(`if not exists` / `drop policy if exists`), então repetir não quebra nada.

| Ordem | Arquivo | O que faz |
|---|---|---|
| 1 | `0002_avatar_storage.sql` | Bucket `avatars` + policies (foto de perfil) |
| 2 | `0003_task_board.sql` | `board_position` nas tarefas (Kanban) |
| 3 | `0004_user_modules.sql` | Controle de abas |
| 4 | `0005_finance.sql` | Módulo financeiro (7 tabelas + view de saldos) |
| 5 | `0006_notifications.sql` | Notificações de reunião |
| 6 | `0007_drive.sql` | Drive: bucket + pastas e arquivos |

Depois de rodar todas, confira:

```sql
-- Deve listar 25 tabelas, todas com relrowsecurity = true
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- As duas views precisam ter security_invoker ligado
select c.relname, c.reloptions
from pg_class c
where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace;
```

> ⚠️ **`security_invoker=on` nas views é crítico.** Sem essa opção, uma view
> roda com os privilégios do dono e **ignora a RLS** das tabelas de base — o
> que vazaria dados entre usuários. Ambas as views
> (`finance_account_balances`, `drive_usage`) já saem configuradas.

> **Ordem de execução:** o Módulo 1 (banco) deve estar aplicado e validado
> **antes** de rodar a aplicação. A aplicação depende das tabelas, do RLS e das
> funções descritas aqui.

---

## 1. Visão geral das tabelas

| Tabela                     | Função                                               | RLS                                   |
| -------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `profiles`                 | Perfil 1:1 com `auth.users`                          | ✅ dono (`id`)                        |
| `user_preferences`         | Tema, modo do dia, view padrão                       | ✅ dono (`user_id`)                   |
| `categories`               | Categorias por usuário (únicas por nome normalizado) | ✅                                    |
| `tags`, `task_tags`        | Etiquetas e junção                                   | ✅                                    |
| `tasks`                    | Tarefas manuais                                      | ✅                                    |
| `captures`                 | Caixa de entrada                                     | ✅                                    |
| `calendar_accounts`        | Metadados das contas Google (máx. 2)                 | ✅                                    |
| `calendar_sources`         | Calendários de cada conta                            | ✅                                    |
| `calendar_events`          | Cache local de eventos (somente leitura)             | ✅                                    |
| `google_oauth_credentials` | Refresh token **cifrado**                            | 🔒 **sem policy — só `service_role`** |
| `vault_master_keys`        | Chave de dados do cofre embrulhada                   | ✅                                    |
| `vault_items`              | Itens do cofre (payload cifrado)                     | ✅                                    |
| `vault_audit_events`       | Auditoria (somente metadados)                        | ✅                                    |

Funções e triggers principais:

- `set_updated_at()` — mantém `updated_at`.
- `prevent_user_id_change()` — impede reatribuir `user_id` em UPDATE.
- `handle_new_user()` — cria perfil, preferências e as 4 categorias iniciais no signup.
- `sync_task_lifecycle_timestamps()` — sincroniza `completed_at` / `archived_at`.
- `convert_capture_to_task(uuid)` — converte captura em tarefa dentro de uma
  transação, de forma **idempotente** (não duplica).

---

## 2. Aplicar via Supabase Dashboard (SQL Editor)

1. Crie o projeto em <https://supabase.com/dashboard>.
2. Menu **SQL Editor → New query**.
3. Cole todo o conteúdo de `supabase/migrations/0001_second_brain_initial.sql`.
4. **Run**. Deve terminar sem erros (o script é envolvido em `begin/commit`).
5. (Opcional) Rode `supabase/seed.sql` da mesma forma.
6. Confira em **Database → Tables** que as 13 tabelas apareceram e que o cadeado
   de **RLS enabled** está presente em todas.

---

## 3. Aplicar via Supabase CLI

Pré-requisitos: [Supabase CLI](https://supabase.com/docs/guides/cli) instalado e
Docker (para o stack local).

### Local (desenvolvimento)

```bash
supabase init          # apenas na primeira vez, se ainda não houver /supabase
supabase start         # sobe Postgres + Auth + Studio locais
supabase db reset      # aplica migrations em ordem e roda seed.sql
```

`supabase db reset` recria o banco local, aplica
`migrations/0001_second_brain_initial.sql` e executa `seed.sql`.

### Projeto remoto (produção)

```bash
supabase link --project-ref <SEU_PROJECT_REF>
supabase db push       # envia as migrations pendentes para o projeto remoto
```

> A migration usa apenas objetos disponíveis no Supabase (schemas `auth`,
> `extensions`, roles `anon` / `authenticated` / `service_role`). Ela **não**
> roda em um Postgres “puro” sem esses pré-requisitos.

---

## 4. Desativar o cadastro público (uso pessoal)

Na primeira versão apenas o proprietário deve acessar. Duas camadas:

1. **Desligar signups no Dashboard:** **Authentication → Providers → Email** →
   desative **“Allow new users to sign up”** (ou, em projetos novos,
   **Authentication → Sign In / Providers → User Signups → Disable**).
   Com isso o endpoint de signup passa a recusar novos cadastros.
2. **Criar o seu usuário manualmente:** **Authentication → Users → Add user**
   (defina e-mail e senha). O trigger `handle_new_user` cria perfil,
   preferências e categorias automaticamente.

Assim o login continua funcionando só para contas que você criar manualmente.

---

## 5. Validação de segurança (RLS)

### 5.1 Confirmar que o RLS está ativo em todas as tabelas pessoais

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relkind = 'r'
order by relname;
```

Todas as tabelas devem ter `relrowsecurity = true`.

### 5.2 Confirmar as policies (SELECT/INSERT/UPDATE/DELETE)

```sql
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, cmd;
```

`google_oauth_credentials` **não** deve aparecer com nenhuma policy.

### 5.3 Um usuário não acessa dados de outro

No SQL Editor, simule dois usuários (troque os UUIDs por dois `auth.users`
reais criados no passo 4):

```sql
-- Como usuário A
select set_config('request.jwt.claims', json_build_object('sub','<UUID_A>','role','authenticated')::text, true);
set local role authenticated;
insert into public.tasks (user_id, title) values ('<UUID_A>', 'Tarefa do A');
select count(*) from public.tasks;      -- deve contar só as do A
reset role;

-- Como usuário B
select set_config('request.jwt.claims', json_build_object('sub','<UUID_B>','role','authenticated')::text, true);
set local role authenticated;
select count(*) from public.tasks;      -- deve ser 0 (não vê as do A)
-- Tentar roubar a tarefa do A deve falhar (0 linhas afetadas por RLS):
update public.tasks set title = 'hack' where user_id = '<UUID_A>';
reset role;
```

### 5.4 Credenciais Google inacessíveis ao cliente

```sql
select set_config('request.jwt.claims', json_build_object('sub','<UUID_A>','role','authenticated')::text, true);
set local role authenticated;
select * from public.google_oauth_credentials;   -- deve retornar 0 linhas / sem permissão
reset role;
```

## 6. Testar o limite de duas contas Google

```sql
-- Slots 1 e 2 funcionam:
insert into public.calendar_accounts (user_id, slot, google_subject) values ('<UUID_A>', 1, 'sub-1');
insert into public.calendar_accounts (user_id, slot, google_subject) values ('<UUID_A>', 2, 'sub-2');

-- Slot 3 é rejeitado pela CHECK (slot in (1,2)):
insert into public.calendar_accounts (user_id, slot, google_subject) values ('<UUID_A>', 3, 'sub-3');   -- ERRO

-- Repetir slot 1 é rejeitado pela UNIQUE (user_id, slot):
insert into public.calendar_accounts (user_id, slot, google_subject) values ('<UUID_A>', 1, 'sub-x');   -- ERRO

-- Conectar a MESMA conta Google duas vezes é rejeitado (user_id, google_subject):
insert into public.calendar_accounts (user_id, slot, google_subject) values ('<UUID_A>', 2, 'sub-1');   -- ERRO
```

---

## 7. Testar a conversão de captura em tarefa

```sql
select set_config('request.jwt.claims', json_build_object('sub','<UUID_A>','role','authenticated')::text, true);
set local role authenticated;

insert into public.captures (user_id, type, title, content, status)
values ('<UUID_A>', 'task', 'Renovar domínio', 'Verificar antes do vencimento', 'inbox')
returning id;                              -- guarde o id

select public.convert_capture_to_task('<ID_DA_CAPTURA>');   -- retorna o task id
-- Chamar de novo retorna o MESMO task id (idempotente, não duplica):
select public.convert_capture_to_task('<ID_DA_CAPTURA>');

select converted_task_id, status, organized_at from public.captures where id = '<ID_DA_CAPTURA>';
reset role;
```

Espera-se: a captura fica com `status = 'organized'`, `converted_task_id`
preenchido, e existe exatamente **uma** tarefa correspondente.

---

## 8. Rollback e backup

### Backup

- **Dashboard:** projetos Supabase têm backups automáticos (**Database →
  Backups**). Para um dump manual:
  ```bash
  supabase db dump --file backup_$(date +%Y%m%d).sql            # schema + dados (local/linkado)
  # ou com pg_dump direto (use a connection string do projeto):
  pg_dump "$SUPABASE_DATABASE_URL" --no-owner --file backup.sql
  ```

### Rollback desta migration

Como é a migration inicial, o rollback remove os objetos criados. Rode em uma
janela do SQL Editor **(destrutivo — apaga todos os dados dessas tabelas)**:

```sql
begin;

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists
  public.vault_audit_events,
  public.vault_items,
  public.vault_master_keys,
  public.google_oauth_credentials,
  public.calendar_events,
  public.calendar_sources,
  public.calendar_accounts,
  public.captures,
  public.task_tags,
  public.tasks,
  public.tags,
  public.categories,
  public.user_preferences,
  public.profiles
cascade;

drop function if exists public.convert_capture_to_task(uuid);
drop function if exists public.handle_new_user();
drop function if exists public.sync_task_lifecycle_timestamps();
drop function if exists public.prevent_user_id_change();
drop function if exists public.set_updated_at();

drop type if exists
  public.vault_item_type,
  public.calendar_account_status,
  public.capture_status,
  public.capture_type,
  public.task_source,
  public.task_priority,
  public.task_status,
  public.calendar_view,
  public.day_mode,
  public.theme_preference;

commit;
```

Com o Supabase CLI, prefira criar uma **nova** migration de rollback
(`supabase migration new rollback_initial`) com o SQL acima, em vez de editar a
migration original, para manter o histórico consistente.

---

## 9. Checklist de validação do Módulo 1

- [ ] Migration roda sem erros (Dashboard e/ou `supabase db push`).
- [ ] As 13 tabelas existem.
- [ ] RLS ativo em todas as tabelas pessoais (§5.1).
- [ ] Policies SELECT/INSERT/UPDATE/DELETE presentes (§5.2).
- [ ] Usuário A não vê dados do B (§5.3).
- [ ] `google_oauth_credentials` inacessível ao `authenticated` (§5.4).
- [ ] Limite de 2 contas Google (§6).
- [ ] Conversão de captura idempotente (§7).
- [ ] Backup/rollback documentados e testados em ambiente de teste (§8).
