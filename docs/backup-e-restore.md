# Backup e restauração

O plano gratuito do Supabase **não tem point-in-time recovery**. Existe um
backup diário do provedor, com retenção curta, que você não controla e nunca
testou restaurar. Este documento cobre a cópia que é sua.

> **Um backup nunca testado não é um backup.** A parte que importa deste
> documento é a seção "Ensaio", no fim.

---

## Pré-requisitos

**1. Ferramentas de linha de comando do PostgreSQL**

```powershell
winget install PostgreSQL.PostgreSQL.16
```

Reabra o terminal depois. A versão do `pg_dump` precisa ser **igual ou mais
nova** que a do servidor — um `pg_dump` mais antigo recusa a conexão com
`server version mismatch` e não gera arquivo nenhum.

**2. A URL de conexão**

Supabase → *Project Settings* → *Database* → *Connection string* → **URI**.

Use a porta **5432** (conexão direta), não a 6543 do pooler: o pgbouncer em
modo transaction não suporta o que o `pg_dump` precisa.

```powershell
# Só para esta sessão do terminal
$env:SUPABASE_DB_URL = 'postgresql://postgres:SENHA@db.xxxx.supabase.co:5432/postgres'

# Ou permanente, só para o seu usuário
[Environment]::SetEnvironmentVariable('SUPABASE_DB_URL','postgresql://...','User')
```

A URL vai no **ambiente**, nunca como argumento do script: argumento de linha de
comando entra no histórico do PowerShell e aparece na lista de processos para
qualquer usuário da máquina — e essa string contém a senha do banco com
privilégio total.

---

## Rodar

```powershell
.\scripts\backup.ps1
```

Grava em `%LOCALAPPDATA%\segundo-cerebro-backups`, mantendo os 8 mais recentes.

```powershell
.\scripts\backup.ps1 -Destino E:\backups\segundo-cerebro -Reter 12
```

O script **recusa** destino dentro do OneDrive. O projeto inteiro mora lá e o
OneDrive sincroniza: um dump ali sobe para a nuvem da Microsoft sozinho (e ele
contém o Cofre e os tokens do Google) e some junto com o original em caso de
ransomware ou exclusão acidental — porque é isso que sincronização faz. Backup
no mesmo volume que o original é cópia, não backup.

### Semanalmente, sem lembrar

```powershell
$acao = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\caminho\completo\scripts\backup.ps1"'
$gatilho = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 20:00
Register-ScheduledTask -TaskName "Backup Segundo Cerebro" -Action $acao -Trigger $gatilho
```

A tarefa agendada roda no **seu** usuário, e é dele que vem a variável
`SUPABASE_DB_URL` — por isso ela precisa ter sido definida com o escopo
`'User'`, não só na sessão.

---

## ⚠️ O que o dump NÃO contém

Ler isto **antes** de precisar restaurar, não depois.

| Não está no dump | Consequência | O que fazer |
|---|---|---|
| **Os arquivos do Drive** | Estão no Storage (S3), não no Postgres. O dump traz os metadados; os bytes não. Um restore devolve a lista de arquivos com **todos os downloads quebrados** | Baixar o que importa pela interface, ou usar a CLI do Supabase para o bucket |
| **Os usuários (`auth.users`)** | O dump é só do schema `public`. Restaurar num projeto novo exige recriar o login — e o `user_id` novo **não** é o antigo | Ver "Restaurar em projeto novo" |
| **Os segredos do ambiente** | `TOKEN_ENCRYPTION_KEY(S)` não está no banco | Sem essa chave, os refresh tokens do Google no dump são lixo cifrado. Guarde-a junto do backup, **em outro lugar** |

O último ponto é o que morde: um restore bem-sucedido com a chave de cifragem
perdida devolve as contas do Google conectadas e não funcionando. A recuperação
é reconectar cada conta.

---

## Restaurar

### Caso 1 — desfazer um estrago numa tabela (o caso comum)

O formato `custom` permite restaurar **uma tabela**, sem tocar no resto.

```powershell
# O que existe dentro do dump
pg_restore --list segundo-cerebro_2026-08-02_2000.dump

# Só a tabela tasks, para um schema de conferência
psql $env:SUPABASE_DB_URL -c "create schema if not exists restauracao;"
pg_restore --dbname=$env:SUPABASE_DB_URL --data-only --table=tasks `
  --schema=public --no-owner segundo-cerebro_2026-08-02_2000.dump
```

**Confira antes de sobrescrever.** Restaurar direto por cima de dados vivos é
como o estrago vira dois estragos: o preferível é trazer para um schema à parte
(`restauracao`), comparar com `select`, e só então mover as linhas que faltam.

### Caso 2 — projeto novo, do zero

1. Crie o projeto no Supabase e aplique as migrations `0001` → `0015`.
2. **Crie o usuário** (Authentication → Users → Add user) com o mesmo e-mail.
3. Anote o `user_id` NOVO — ele é diferente do antigo.
4. Restaure só os dados:

```powershell
pg_restore --dbname=$env:SUPABASE_DB_URL --data-only --no-owner `
  --disable-triggers segundo-cerebro_2026-08-02_2000.dump
```

5. **Reaponte o dono.** Toda tabela tem `user_id` referenciando `auth.users`, e
   o id mudou:

```sql
-- Confira primeiro qual é o antigo:
select distinct user_id from public.tasks;

do $$
declare
  antigo uuid := '<user_id do dump>';
  novo   uuid := '<user_id novo>';
  t text;
begin
  foreach t in array array[
    'profiles','user_preferences','categories','tags','tasks','captures',
    'calendar_accounts','calendar_sources','calendar_events',
    'vault_master_keys','vault_items','vault_audit_events','user_modules',
    'finance_accounts','finance_categories','finance_tags',
    'finance_transactions','finance_budgets','finance_audit_events',
    'notification_deliveries','push_subscriptions',
    'drive_folders','drive_files','task_capture_links','task_event_links',
    'capture_event_links','knowledge_notebooks','knowledge_pages','social_links'
  ] loop
    execute format('update public.%I set user_id = $1 where user_id = $2;', t)
      using novo, antigo;
  end loop;
end $$;
```

> `profiles` tem `id` (não `user_id`) como chave para `auth.users` — confira essa
> tabela à parte.

`--disable-triggers` no passo 4 é necessário e é a linha que mais confunde: sem
ela, as triggers de `prevent_user_id_change` e de validação disparam durante a
carga e recusam linhas perfeitamente válidas, porque estão avaliando dados que
já foram validados uma vez. Ela exige privilégio de superusuário — no Supabase,
rode como `postgres`.

6. Reconecte as contas do Google (os refresh tokens não sobrevivem à troca de
   projeto, e provavelmente nem à troca de chave).
7. Reenvie os arquivos do Drive.

---

## Ensaio — a única parte que prova alguma coisa

Faça isto **uma vez**, agora, e de novo a cada seis meses. Enquanto não fizer,
você tem arquivos `.dump`, não backup.

1. Crie um projeto Supabase **novo e descartável** (o free tier permite dois).
2. Aplique `0001` → `0015`.
3. Siga o "Caso 2" inteiro com o dump mais recente.
4. Aponte uma cópia local da aplicação para esse projeto e **entre**.
5. Confira, com os olhos:
   - as tarefas estão lá;
   - o Financeiro fecha com os mesmos saldos;
   - o **Cofre destrava com a senha mestra** e os itens decifram;
   - o Conhecimento abre as páginas.
6. Apague o projeto descartável.

O passo 5 é o que mais falha, e o Cofre é o que mais importa: ele depende de o
`vault_master_keys` ter vindo íntegro. Se os itens não decifrarem no ensaio, é
melhor descobrir agora — com o banco original intacto — do que no dia em que ele
não estiver mais lá.
