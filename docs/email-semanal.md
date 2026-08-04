# E-mail semanal de métricas

Segunda-feira, 11h, com o resumo da **semana anterior** (segunda a domingo).

---

## Os dois crons

```jsonc
// vercel.json
{ "path": "/api/google/calendar/sync", "schedule": "0 5 * * *" },  // diário, 5h
{ "path": "/api/metrics/email",        "schedule": "0 11 * * 1" }  // segunda, 11h
```

**O sync deixou de ser horário (`0 * * * *`).** O plano Hobby da Vercel aceita
até 100 cron jobs por projeto, mas cada um **no máximo uma vez por dia** — a
expressão horária era o que travava o deploy. Diário às 5h custa nada e mantém o
cache morno para quem abre a agenda de manhã.

E como o semanal roda *menos* que uma vez por dia, ele passa na validação sem
truque nenhum: não foi preciso um "cron diário que checa se hoje é segunda", e a
rota não tem lógica de calendário.

---

## Os dois pré-requisitos que decidem entre funcionar e falhar calado

| # | O quê | Onde | Se faltar |
|---|---|---|---|
| 1 | `CRON_SECRET` | painel da Vercel | 401 no agendador. **Vazio = rota fechada**, por desenho |
| 2 | `RESEND_API_KEY` | painel da Vercel | 503, e **nada é reservado** |

> ⚠️ `CRON_SECRET` está **vazio** hoje. Vazio significa rota fechada, não rota
> aberta — ver `src/lib/cron-auth.ts`, que trata isso como o modo de falha mais
> perigoso possível e falha para o lado fechado de propósito.

A terceira peça já está no código: `/api/metrics/email` entrou em
`SELF_AUTHENTICATED_PATHS`. Sem essa linha o agendador levaria 307 para `/login`
e o log da Vercel registraria **307/200** — a aparência exata de um job que
funciona, com o e-mail nunca saindo. É o mesmo defeito que a rota de sync já
sofreu uma vez, e há teste para os dois.

---

## Provedor: Resend

- **Sem domínio verificado**, envia de `onboarding@resend.dev`, com a restrição
  de que o destinatário seja o e-mail da conta Resend — que é literalmente o
  caso aqui. O destino vem de `auth.users.email`, não de variável.
- Free tier: 3.000/mês. O uso é de **4**.
- **Nenhuma dependência nova.** O envio é um `POST` com `fetch`.

Com domínio verificado depois, `RESEND_FROM` troca o remetente e nada mais muda.

---

## ⚠️ A idempotência, e a troca que ela assume

`metric_email_deliveries` tem `unique (user_id, period_start, channel)`. O
despacho **reserva a linha antes** de chamar a Resend:

- voltou linha → primeira vez, envia;
- não voltou → alguém já reservou aquela semana, não envia.

Reservar antes é o que torna a operação atômica. Reservar depois deixaria aberta
a janela entre "enviei" e "registrei", e um segundo disparo caberia dentro dela.

**A consequência, aceita de propósito:** se a Resend falhar *depois* da reserva,
a semana **não é reenviada** automaticamente. A linha fica com `error` e
`delivered_at` nulo.

Para um resumo semanal esse é o lado certo de errar — um e-mail perdido
aborrece, dois iguais ensinam a ignorar o remetente. Para ver o que falhou:

```sql
select period_start, destination, error
from public.metric_email_deliveries
where delivered_at is null
order by period_start desc;
```

Para reenviar uma semana à mão, apague a linha dela e chame a rota.

---

## O que o e-mail traz

Tarefas concluídas e criadas, atrasadas (foto do **agora**, não da semana),
capturas, páginas editadas, compromissos e o saldo do financeiro.

Toda a aritmética mora em **`src/lib/metrics.ts`** — puro, sem banco e sem
`server-only`. É o que garante que a tela e o e-mail mostrem o mesmo número:
duas implementações da mesma conta é como um dia a tela diz 18, o e-mail diz 19,
e ninguém sabe qual está certo.

Linha zerada é **omitida**, com uma exceção deliberada: "Tarefas concluídas: 0"
aparece mesmo assim, porque é justamente o número que se quer ver quando a
semana não andou.

Transferências (`kind = 'transfer'`) ficam de fora das duas somas do financeiro:
é a mesma quantia saindo de uma conta e entrando em outra, e contá-la infla
entradas e saídas na mesma medida.

---

## Roteiro de verificação manual

- [ ] 🔧 Preencher `CRON_SECRET` na Vercel (gere com
      `openssl rand -base64 32`)
- [ ] 🔧 Criar conta na Resend e preencher `RESEND_API_KEY`
- [ ] 🔧 Aplicar a migration `0019`
- [ ] Chamar a rota à mão e conferir a resposta:
      ```bash
      curl -H "x-cron-secret: $CRON_SECRET" https://<app>/api/metrics/email
      ```
- [ ] **Chamar de novo na mesma semana** → `"resultado": "ja_enviado"` e
      **nenhum segundo e-mail**. É a prova da idempotência
- [ ] Chamar **sem** o cabeçalho → `401`, sem redirecionamento para `/login`
- [ ] Abrir o e-mail com **imagens bloqueadas** — a versão de texto tem que
      fazer sentido sozinha
- [ ] Conferir que os números batem com o que as telas mostram

> O quinto item é o que importa: ele é a única prova de que a UNIQUE está
> fazendo o trabalho dela.
