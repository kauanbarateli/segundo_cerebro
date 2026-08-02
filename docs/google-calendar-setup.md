# Google Calendar — configuração (somente leitura)

Este guia liga o Segundo Cérebro ao **Google Calendar** para leitura de eventos
de até **duas contas** por usuário. Nesta versão a aplicação **não cria nem
edita** eventos e usa apenas escopos de leitura.

> ⚠️ Não confunda **Google Calendar** com **Google Drive**. Ative a API do
> **Calendar** e solicite escopos do **Calendar** — nada de Drive.

## Escopos usados

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/calendar.readonly`

---

## 1. Criar ou selecionar um projeto

1. Acesse <https://console.cloud.google.com/>.
2. Barra superior → seletor de projeto → **Novo projeto** (ou selecione um existente).
3. Dê um nome (ex.: `segundo-cerebro`) e crie.

## 2. Ativar a Google Calendar API

1. Menu → **APIs e serviços → Biblioteca**.
2. Busque **Google Calendar API** → **Ativar**.

## 3. Configurar a tela de consentimento OAuth

1. **APIs e serviços → Tela de consentimento OAuth**.
2. Tipo de usuário:
   - **Externo** para contas Gmail comuns.
   - **Interno** se todas as contas forem do mesmo Google Workspace.
3. Preencha nome do app, e-mail de suporte e e-mail do desenvolvedor.
4. Em **Escopos**, adicione `.../auth/calendar.readonly` (openid/email/profile são
   incluídos automaticamente).
5. Salve.

## 4. Criar o cliente OAuth (Web Application)

1. **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
2. Tipo de aplicativo: **Aplicativo da Web**.
3. **Origens JavaScript autorizadas**:
   - `http://localhost:3000` (desenvolvimento)
   - `https://SEU-DOMINIO` (produção)
4. **URIs de redirecionamento autorizados** (precisam bater **exatamente** com
   `GOOGLE_REDIRECT_URI`):
   - `http://localhost:3000/api/google/calendar/callback` (desenvolvimento)
   - `https://SEU-DOMINIO/api/google/calendar/callback` (produção)
5. Crie e copie o **Client ID** e o **Client Secret**.

## 5. Adicionar usuários de teste (enquanto o app não é verificado)

Se a tela de consentimento for **Externo** e estiver em modo *Testing*, apenas
usuários de teste conseguem autorizar:

1. **Tela de consentimento OAuth → Usuários de teste → Adicionar usuários**.
2. Inclua os **dois** endereços Google que você vai conectar (pessoal e trabalho).

## 6. Preencher o `.env.local`

Copie de `.env.example` e defina:

```
GOOGLE_CLIENT_ID=...             # do passo 4
GOOGLE_CLIENT_SECRET=...         # do passo 4
GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/calendar/callback
TOKEN_ENCRYPTION_KEY=...         # 32 bytes base64 (veja abaixo)
```

Gerar a chave de criptografia (usada para cifrar os refresh tokens no servidor):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

## 7. Conectar as duas contas na aplicação

1. Inicie a app (`npm run dev`) e faça login.
2. Vá em **Calendário → Contas conectadas**.
3. **Slot 1 → Conectar conta Google** → autorize a primeira conta.
4. **Slot 2 → Conectar conta Google** → autorize a segunda conta (cada fluxo
   OAuth é independente).
5. Defina o apelido **Pessoal** ou **Trabalho** em cada slot.
6. Use **Sincronizar agora** para a primeira carga completa; as próximas usam
   sincronização incremental (`syncToken`).

A aplicação impede:
- Uma **terceira** conexão (só existem os slots 1 e 2).
- Conectar a **mesma** conta Google duas vezes.

## 8. Bloqueios comuns em contas Workspace

- Admins do Workspace podem **restringir apps de terceiros** ou apps não
  verificados. Se a autorização falhar com *“app blocked / admin policy”*, peça
  ao administrador para permitir o app ou use uma conta pessoal.
- Alguns domínios exigem que o app esteja **verificado** para sair do modo de
  teste. Enquanto isso, mantenha as contas como **usuários de teste**.

## 9. Revogar uma conexão

- **Na aplicação:** Calendário → cartão da conta → **Desconectar** (revoga o
  token no Google e remove o cache local).
- **No Google:** <https://myaccount.google.com/permissions> → selecione o app →
  **Remover acesso**.

## 10. Como testar as duas contas

1. Conecte a conta pessoal no slot 1 e a de trabalho no slot 2.
2. Confirme que os eventos aparecem na visão unificada e que o **badge** de cada
   evento identifica a conta de origem (a diferenciação é por nome/badge, não só
   por cor).
3. Crie um evento de teste em cada conta no Google, clique em **Sincronizar
   agora** e confira que ele aparece.
4. Cancele um evento no Google e sincronize: ele some do cache local.

## 11. Sincronização agendada (futuro)

O endpoint `POST /api/google/calendar/sync` já centraliza a lógica. Para
automatizar mais tarde, agende um job (ex.: Vercel Cron) chamando esse endpoint
e proteja-o com `CRON_SECRET`. O banco já tem colunas `watch_*` reservadas para
push notifications (webhooks) futuras — não implementadas nesta versão.
