# Papéis, bloqueio e área administrativa

Migration `0021_papeis_e_admin.sql`. Rota `/admin`.

## O diagnóstico que motivou isto

No **dado** o projeto já era multiusuário desde a `0001`: RLS por usuário em
toda tabela, provisionamento automático no cadastro, papel anônimo fechado
(`0014`), bucket privado, credenciais externas cifradas por usuário. Usuário A
nunca alcançou dado de B.

No **produto**, não havia nada: uma varredura por `role|is_admin|admin|banned`
devolvia apenas `service_role` e `createAdminClient` — infraestrutura do
Supabase, não papel de usuário.

## ⚠️ A 0021 não altera nenhuma policy existente

É a decisão mais importante dela.

A tentação óbvia seria afrouxar as policies de `tasks`, `captures` e `finance_*`
para o master conseguir ler tudo. Essa seria a mudança mais arriscada possível:
um erro numa dessas condições abre o dado de todo mundo para todo mundo, em
silêncio, sem nada na tela indicando.

Em vez disso, o admin opera por Server Action com `service_role`, que **ignora
RLS por natureza** e portanto não precisa pedir licença a policy nenhuma. As
policies do produto continuam `auth.uid() = user_id`, sem exceção para ninguém.

**Consequência:** o master vê **metadado**, não conteúdo. E o Cofre permanece
ilegível para ele mesmo com `service_role` — é cifrado de ponta a ponta com
chave derivada da senha mestra do dono, e o banco guarda apenas ciphertext.

## As quatro camadas, e qual delas protege

| # | Onde | O que faz |
|---|---|---|
| 1 | Barra lateral (`(app)/layout.tsx`) | Esconde o link. **Conveniência, não segurança** |
| 2 | `admin/layout.tsx` | Consulta o papel e redireciona. Cobre quem digita a URL |
| **3** | **Toda Server Action** | **`await requireMaster()` na primeira linha** |
| 4 | RLS + `eh_master()` | Última linha |

**A camada 3 é a que importa.** Uma Server Action *é um endpoint HTTP*: o Next
publica um id por função exportada, e um POST para esse id não passa por layout,
não renderiza página e não vê guarda de rota nenhuma. A camada 2 protege a
**tela**; só a 3 protege a **operação**.

`guards.test.ts` tem duas varreduras sobre o texto de `admin/actions.ts`: toda
função exportada chama `requireMaster()`, e ela vem **antes** de
`createAdminClient()`. É o que faz uma action nova nascer protegida ou quebrar o
CI — o risco real não é errar a guarda hoje, é acrescentar a décima action daqui
a seis meses copiando outra e esquecendo a primeira linha.

## Bloqueio: duas camadas, nenhuma dispensável

| Camada | O que impede | O que NÃO impede |
|---|---|---|
| `ban_duration` no Auth | Login **novo** | Sessão já emitida continua até o JWT expirar |
| `profiles.status` | Sessão **viva** (lido em `getAppContext`, toda navegação) | Login novo |

Sem a primeira, o usuário reentra. Sem a segunda, ele não sai — e para um
bloqueio que existe porque alguém precisa parar *agora*, "até uma hora depois"
não serve.

A ordem é banir primeiro, marcar depois: se a segunda falhar, o pior caso é
alguém que não entra mais mas termina a sessão atual — melhor que o inverso.

## Semear o master

A `0021` procura o e-mail `contas.blacksheep@gmail.com` em `auth.users` e
concede `master`. Se o e-mail **não existir**, ela não faz nada e **não falha** —
é preciso poder rodar num banco vazio (CI, clone novo) sem derrubar a suíte.

⚠️ **Confira depois de aplicar:**

```sql
select u.email, r.role
  from public.user_roles r
  join auth.users u on u.id = r.user_id;
```

Sem nenhuma linha `master`, a área administrativa fica inacessível para todo
mundo — o modo de falhar correto, mas que precisa ser notado.

Para conceder à mão:

```sql
insert into public.user_roles (user_id, role)
select id, 'master' from auth.users where email = 'SEU-EMAIL'
on conflict (user_id) do update set role = 'master';
```

## Detalhes de modelagem que merecem registro

**Ausência de linha em `user_roles` = papel `user`.** O caminho normal não
escreve nada, e não existe estado "papel nulo" a interpretar. Por isso
`definirPapel(…, "user")` **apaga** a linha em vez de gravar `'user'`: duas
representações do mesmo estado fariam "quem tem papel especial?" deixar de ser
"quem está na tabela".

**`user_roles` tem policy de SELECT e nenhuma de escrita.** A ausência é a
proteção: com RLS ligada e sem policy, `authenticated` simplesmente não escreve
ali — nem o master. Uma policy "master pode inserir" pareceria equivalente e
deixaria a concessão de papel acontecer por qualquer `fetch` montado à mão com
um JWT de master, sem passar por auditoria.

**`admin_audit_events.alvo_id` não tem FK.** O registro mais importante da tabela
é "fulano foi excluído", e com cascade essa linha sumiria exatamente quando vira
o único vestígio. `alvo_email` é copiado no momento da ação pela mesma razão.

**Impedidos:** autobloqueio, auto-rebaixamento e remover o último master. Sem
eles, um clique errado tranca o próprio dono para fora e a única saída é o SQL
editor do Supabase.
