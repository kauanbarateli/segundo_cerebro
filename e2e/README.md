# Testes de ponta a ponta

Cinco fluxos, e a lista é curta de propósito. E2E custa manutenção: cada teste é
um seletor que envelhece e uma espera que pode ficar instável. A suíte em que
ninguém confia é a que tem teste demais.

| # | Fluxo | Por que ele existe |
|---|---|---|
| 1 | Entrar → Início carrega | Se quebra, tudo quebrou |
| 2 | **Tarefa com data e hora** | ⭐ O defeito da Etapa 1. Nenhum teste de unidade pegaria |
| 3 | **Mobile 390px sem rolagem** | ⭐ O defeito da Etapa 2. Só um navegador mede layout |
| 4 | Despesa no cartão → fatura certa | A regra de negócio mais delicada do produto |
| 5 | Usuário comum **não** acessa `/admin` | A única camada de segurança testável de fora |

Os dois marcados com ⭐ são exatamente os bugs corrigidos neste plano, e a suíte
de 705 testes unitários **não os pegaria** — é esse o argumento para o Playwright
existir aqui, não a completude.

Ficaram de fora, de propósito: "capturar → aparece na lista" e "marcar hábito".
São caminhos simples, já cobertos por unidade nas actions, e somariam manutenção
sem somar confiança.

## ⚠️ Nunca aponte para produção

Estes testes **criam e apagam dado**. Rodar contra o banco real destruiria dado
de verdade.

É preciso um **projeto Supabase dedicado a teste**, com as migrations aplicadas.
Não há valor padrão que aponte para produção em lugar nenhum da configuração, e
`E2E_BASE_URL` sem valor faz o Playwright subir uma instância local.

## Como rodar

```bash
# 1. Instale o navegador (uma vez por máquina)
npx playwright install chromium

# 2. Aponte para o ambiente de teste
export NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO-DE-TESTE.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export E2E_EMAIL=teste@exemplo.com
export E2E_SENHA=...

# Opcional: sem estes, os casos de master são PULADOS
export E2E_MASTER_EMAIL=master@exemplo.com
export E2E_MASTER_SENHA=...

npm run e2e
```

**Sem `E2E_EMAIL`/`E2E_SENHA` os testes são pulados, não falham.** A distinção é
deliberada: um teste que fica vermelho por falta de variável de ambiente ensina,
em duas semanas, que vermelho é normal — e no dia em que ele ficar vermelho por
um defeito de verdade, ninguém vai olhar.

## Semear o ambiente

O mínimo para os cinco fluxos passarem sem pular nada:

1. Um usuário comum (`E2E_EMAIL`), criado pelo painel do Supabase.
2. Um usuário master (`E2E_MASTER_EMAIL`), com linha em `user_roles`:
   ```sql
   insert into public.user_roles (user_id, role)
   select id, 'master' from auth.users where email = 'master@exemplo.com'
   on conflict (user_id) do update set role = 'master';
   ```
3. Para o fluxo 4, um cartão de crédito com dia de fechamento e de vencimento, e
   ao menos uma despesa nele. Sem isso, os casos daquele arquivo se pulam
   sozinhos com a razão escrita.

## Por que não roda no CI hoje

O workflow não tem projeto Supabase de teste configurado, e apontar o CI para
qualquer outra coisa seria apontá-lo para produção. Quando o projeto existir,
basta acrescentar um job com as variáveis acima — a configuração do Playwright já
prevê CI (retry 2×, um worker, artefato de falha, `forbidOnly`).
