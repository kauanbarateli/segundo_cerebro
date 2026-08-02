# Auditoria de Segurança — SEGUNDO-CEREBRO

**Data da auditoria:** 02/08/2026  
**Escopo:** aplicação Next.js, Server Actions e rotas API, autenticação e autorização, Supabase/Postgres/RLS/Storage, integrações Google, Cofre, dependências, segredos, configuração de deploy e controles operacionais.  
**Modo de execução:** revisão estática e testes somente leitura. Não foram realizadas explorações destrutivas, escritas no banco, alterações de configuração, rotação de segredos ou mudanças no código da aplicação.  
**Resultado geral:** risco **alto**, principalmente por falhas no Cofre, integridade das trilhas de auditoria, relações cross-tenant, upload direto no Drive e dependências vulneráveis.

> Este documento retrata o estado observado em 02/08/2026. “Não identificado” não significa inexistente: os limites da auditoria estão documentados ao final.

## 1. Resumo executivo

Foram consolidados **33 achados**:

| Severidade | Quantidade | Interpretação |
|---|---:|---|
| Crítica | 0 | Nenhum comprometimento crítico imediato foi confirmado. |
| Alta | 8 | Pode causar perda de dados, quebra de isolamento, exposição de credencial, fraude de auditoria ou comprometimento relevante. |
| Média | 16 | Exige pré-condição, amplia outro ataque ou representa controle de segurança incompleto. |
| Baixa | 9 | Hardening, inconsistência de privilégios ou vetor de baixa explorabilidade atual. |

Prioridades imediatas:

1. Remover a chave do Cofre de `window.__sbEnter` e corrigir o auto-lock.
2. Corrigir ou retirar a promessa de “kit de recuperação” até existir recuperação funcional.
3. Tornar auditorias de Cofre e Financeiro append-only e atômicas.
4. Garantir ownership composto nas FKs, começando por Google Calendar e Drive.
5. Controlar upload/cota do Drive no backend.
6. Deixar de enviar o refresh token Google na URL.
7. Tratar as dependências vulneráveis de produção com atualização/override testado.
8. Colocar a CSP em enforcement depois de remover `unsafe-inline`.

Não foram encontrados, nesta revisão, SQL injection, command injection, SSRF, open redirect ou segredo de produção hardcoded fora do arquivo local de ambiente. Os testes automatizados existentes passaram, mas não exercitam um banco real com dois usuários e, por isso, não detectam os principais problemas de RLS/ownership descritos aqui.

## 2. Critério de severidade

- **Crítica:** exploração plausível sem autenticação com comprometimento sistêmico imediato.
- **Alta:** perda/indisponibilidade grave, credencial reutilizável, quebra de tenant, fraude de auditoria ou vulnerabilidade de produção relevante.
- **Média:** exploração condicionada, defesa essencial incompleta, vazamento limitado ou abuso de recursos.
- **Baixa:** hardening, inconsistência futura ou vetor com baixa probabilidade/impacto atual.
- **Ponto em aberto:** configuração externa ou condição que não pôde ser confirmada com o acesso disponível; não é contada como vulnerabilidade confirmada.

## 3. Achados de severidade alta

### SB-SEC-001 — O auto-lock do Cofre pode ser contornado

**Severidade:** Alta  
**Status:** Confirmado por revisão do fluxo  
**Evidência:** `src/components/features/vault/VaultClient.tsx:62-80`, `:121-130`, `:204` e `:241`.

Durante a criação do Cofre, uma closure que contém a chave de dados é publicada em `window.__sbEnter`. A propriedade não é apagada. Mesmo depois de o auto-lock limpar o ref normal, a função global mantém a chave viva e pode desbloquear o Cofre novamente sem a senha até a página ser recarregada ou abandonada.

**Impacto:** qualquer script que execute na origem — extensão maliciosa, XSS ou acesso ao console em uma sessão aberta — pode recuperar o estado desbloqueado. O comportamento contradiz a expectativa de que a chave exista apenas em memória local controlada e seja destruída no lock.

**Correção recomendada:** nunca publicar chave/closure em `window`; manter o material pendente em `useRef` local; zerá-lo ao confirmar, bloquear, desmontar, sair e ao ocultar a página; criar teste que aguarde o auto-lock e prove que nenhum caminho reabre o Cofre sem derivar a chave novamente.

### SB-SEC-002 — O “kit de recuperação” do Cofre não recupera os dados

**Severidade:** Alta  
**Status:** Confirmado  
**Evidência:** `src/lib/crypto/vault.ts:184-219` e `src/components/features/vault/VaultClient.tsx:187-244`.

`exportRecoveryKit()` produz duas partes indispensáveis: o código e um objeto com data key embrulhada, salt, IV e parâmetros. A interface descarta o objeto e mostra/copia somente o código. Não há persistência, download nem importação do material restante.

**Impacto:** o usuário recebe uma falsa garantia de recuperação. Se esquecer a senha mestra, o código isolado não contém informação suficiente e os dados permanecem irrecuperáveis.

**Correção recomendada:** implementar e testar ponta a ponta um artefato versionado de recuperação. Ele pode ser um arquivo exportável contendo todo o material necessário ou um wrapper armazenado no servidor e cifrado por uma chave derivada do código. Até isso existir, não apresentar o código como mecanismo de recuperação funcional.

### SB-SEC-003 — As trilhas de auditoria podem ser forjadas, editadas e apagadas

**Severidade:** Alta  
**Status:** Confirmado  
**Evidência:**

- Cofre: `supabase/migrations/0001_second_brain_initial.sql:662-685` e `:704-715`.
- Financeiro: `supabase/migrations/0005_finance.sql:203-236`.
- Contradição com a intenção de retenção: `supabase/migrations/0013_audit_retention.sql:4-6` e `:58-78`.
- Registro não atômico e erros ignorados: `src/app/(app)/financeiro/actions.ts:272-284` e `src/app/(app)/cofre/actions.ts:161-177`.

As tabelas `vault_audit_events` e `finance_audit_events` concedem `INSERT`, `UPDATE` e `DELETE` a `authenticated`, protegendo apenas por `user_id`. Além disso, `logAudit` é uma Server Action exportada que aceita ação e metadados arbitrários. O evento ocorre separado da mutação principal e falhas são ignoradas.

**Impacto:** uma sessão comprometida pode apagar seus rastros, alterar a narrativa do incidente, inundar a tabela com eventos falsos ou concluir uma operação sem qualquer evento. As tabelas não constituem evidência confiável.

**Correção recomendada:** revogar `UPDATE`/`DELETE` e, preferencialmente, `INSERT` direto; gerar eventos por trigger transacional ou RPC estreita que derive o usuário de `auth.uid()` e aceite somente ações enumeradas; tornar falhas observáveis; para requisitos fortes, duplicar eventos em destino append-only externo.

### SB-SEC-004 — FKs não garantem que pai e filho pertençam ao mesmo usuário

**Severidade:** Alta  
**Status:** Confirmado no schema e nos fluxos  
**Evidência principal:**

- Tarefas/tags/capturas/calendário: `supabase/migrations/0001_second_brain_initial.sql:236-341`, `:458-521` e `:616-623`.
- Financeiro: `supabase/migrations/0005_finance.sql:50-146`.
- Notificações: `supabase/migrations/0006_notifications.sql:51-63`.
- Drive: `supabase/migrations/0007_drive.sql:56-105` e `src/app/(app)/drive/actions.ts:57-70`, `:114-122`, `:224-254`, `:307-315`.
- A própria migration 0009 documenta o problema e corrige apenas três tabelas: `supabase/migrations/0009_entity_links.sql:193-207`.

As policies comparam `auth.uid()` apenas com o `user_id` da linha filha. Uma FK comum prova que o UUID pai existe, mas não que pertence ao mesmo tenant. Quem conhecer um UUID alheio pode criar uma linha própria apontando para ele e usar sucesso/erro da FK como oráculo de existência.

O caso de maior impacto está no calendário: `calendar_sources.calendar_account_id` não valida mesmo dono, e o sincronizador com `service_role` busca fontes apenas por `calendar_account_id` (`src/lib/google/calendar.ts:177-180`) e escreve eventos ignorando RLS (`:208-234`). Uma fonte forjada pode alcançar o fluxo administrativo ligado à credencial da vítima, causando integridade cruzada e indisponibilidade.

**Correção recomendada:** usar chaves/FKs compostas `(id, user_id)` → `(parent_id, user_id)` ou triggers de ownership explícito. No calendário, retirar escrita direta de tabelas de cache, filtrar sempre por conta e usuário e repetir a validação antes de qualquer operação administrativa.

### SB-SEC-005 — Upload direto no Drive contorna cota e validações da aplicação

**Severidade:** Alta  
**Status:** Confirmado  
**Evidência:** `supabase/migrations/0007_drive.sql:22-39`, `src/components/features/drive/DriveView.tsx:105-159`, `:210-223` e `src/app/(app)/drive/actions.ts:200-260`.

O navegador envia diretamente para o Storage. A policy valida somente bucket e prefixo do usuário; o bucket aceita até 50 MiB por objeto e não possui allowlist de MIME. O limite de UI e a “cota” de 1 GiB não são enforcement. `registerFile` confia em caminho, MIME e tamanho fornecidos pelo cliente.

**Impacto:** um usuário autenticado pode criar objetos órfãos, mentir `sizeBytes: 0`, enviar tipos bloqueados pela interface e consumir a quota global do projeto. Não há cota transacional, rate limit de upload, varredura antimalware ou reconciliação automática. Avatares permitem abuso semelhante, limitado a 2 MiB por objeto.

**Correção recomendada:** autorizar/finalizar uploads no backend, consultar o metadado real do Storage, reservar cota de forma transacional, impor limite por usuário/tempo, validar assinatura/MIME real, varrer conteúdo quando aplicável e remover objetos órfãos por job monitorado.

### SB-SEC-006 — Refresh token Google é enviado em query string

**Severidade:** Alta  
**Status:** Confirmado  
**Evidência:** `src/lib/google/oauth.ts:134-137`.

Ao revogar acesso, o token é colocado em `?token=...`. Query strings são frequentemente registradas por proxies, APM, access logs e infraestrutura intermediária. O próprio projeto reconhece esse risco para segredos em URL em `src/lib/cron-auth.ts:76-78`.

**Impacto:** vazamento de refresh token, credencial de longa duração capaz de acessar a conta Google dentro dos escopos concedidos, até ser efetivamente revogada/expirar.

**Correção recomendada:** usar endpoint fixo e enviar `token` exclusivamente no corpo `application/x-www-form-urlencoded`; redigir URLs e corpos sensíveis em logs; confirmar no provedor que respostas e erros também não refletem o token.

### SB-SEC-007 — Dependências de produção possuem advisories altos

**Severidade:** Alta  
**Status:** Confirmado por `npm audit` e lockfile  
**Resultado:** 4 ocorrências altas no total; 3 permanecem em `npm audit --omit=dev`.

1. O Next.js 15.5.22 embute `postcss@8.4.31` (`package-lock.json:6381`, `:6389`, `:6432-6435`), afetado por:
   - [GHSA-qx2v-qp2m-jg93 — XSS](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)
   - [GHSA-6g55-p6wh-862q — leitura arbitrária de arquivo](https://github.com/advisories/GHSA-6g55-p6wh-862q)
   - [GHSA-r28c-9q8g-f849 — traversal/leitura de source map](https://github.com/advisories/GHSA-r28c-9q8g-f849)
2. `sharp@0.34.5` (`package-lock.json:7554-7558`) é afetado por [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj), corrigido a partir de 0.35.0.

A aplicação não usa diretamente a API PostCSS nem `next/image`, o que reduz a explorabilidade observada, mas não elimina o risco do pipeline/deploy. O Next mais recente consultado na data da auditoria ainda declarava as faixas vulneráveis; `npm audit fix --force` sugeria um downgrade incompatível e não deve ser aplicado cegamente.

**Correção recomendada:** testar overrides direcionados para PostCSS corrigido e Sharp ≥ 0.35.0, com build/regressão completa; alternativamente omitir Sharp se a dependência opcional realmente não for necessária. Monitorar release oficial do Next e remover overrides quando houver suporte nativo.

### SB-SEC-008 — A CSP atual não bloqueia ataques

**Severidade:** Alta como amplificador de impacto; não foi encontrada injeção XSS confirmada  
**Status:** Confirmado  
**Evidência:** `src/lib/csp.ts:10-19`, `:154-168`, `:245`, `src/middleware.ts:12-25` e `next.config.mjs:6-19`.

O cabeçalho é `Content-Security-Policy-Report-Only`, permite `script-src 'unsafe-inline'` e não possui `report-uri`/`report-to`. Portanto, uma injeção executaria normalmente e nem produziria telemetria centralizada. O impacto é maior porque a sessão Supabase é legível pelo JavaScript do navegador e o Cofre descriptografa dados no cliente.

**Correção recomendada:** criar nonce criptográfico por request, aplicá-lo aos scripts necessários, remover `unsafe-inline`, coletar violações, testar os fluxos e então promover para `Content-Security-Policy` efetiva. Manter a versão report-only em paralelo apenas durante a transição.

## 4. Achados de severidade média

### SB-SEC-009 — Grants genéricos permitem operações destrutivas e contorno das regras da aplicação

**Evidência:** `supabase/migrations/0001_second_brain_initial.sql:658-715` e blocos equivalentes nas migrations posteriores.

`authenticated` recebe CRUD amplo em tabelas com semânticas diferentes: cache de calendário, fontes/sync tokens, `vault_master_keys`, itens tratados como soft delete, perfis, preferências e auditorias. O cliente Supabase no navegador também permite chamar PostgREST diretamente, contornando Server Actions, validações, rate limits e a ideia de módulos desativados.

**Correção:** definir grants/policies por operação e tabela; cache de calendário somente pelo backend; master key somente por fluxo estreito de criação/rewrap; retirar hard delete onde o produto exige soft delete; mover invariantes críticas para banco/RPC transacional.

### SB-SEC-010 — Autorização de módulos existe só na navegação/página

**Evidência:** `src/lib/guards.ts:9-17`; exemplos sem `requireModule`: `src/app/(app)/drive/actions.ts:33-40`, `src/app/(app)/financeiro/actions.ts:26-33` e `src/app/(app)/cofre/actions.ts:23-30`.

Um usuário autenticado cujo módulo esteja desativado ainda pode chamar Actions e APIs do módulo. Se a flag é apenas preferência visual, documentar isso; se é controle de acesso, o enforcement está incompleto.

**Correção:** criar guard de módulo para Actions/rotas e, quando for requisito de autorização, refletir a regra também no banco/RPC.

### SB-SEC-011 — A rota de sync processa entrada antes de autenticar e não possui lock/cooldown

**Evidência:** `src/app/api/google/calendar/sync/route.ts:47-58`, `:87-120` e `src/lib/rate-limit.ts:18-37`.

A rota é isenta do gate do middleware. Um anônimo pode forçar `request.json()` antes de receber 401; no ramo cron o corpo é analisado mesmo sendo ignorado. Uma sessão válida pode repetir sincronizações caras, consumir quota Google e gerar escritas concorrentes sem lock por conta.

**Correção:** autenticar cron/sessão antes de ler corpo; ignorar corpo no cron; exigir Content-Type e tamanho máximo; validar `accountId` como UUID; adicionar rate limit compartilhado, cooldown, idempotência e lock por conta.

### SB-SEC-012 — Cookies de sessão não possuem hardening explícito

**Evidência:** `src/lib/supabase/server.ts:15-33`, `src/lib/supabase/middleware.ts:59-70`, `src/lib/supabase/client.ts:10-12` e defaults instalados em `node_modules/@supabase/ssr/src/utils/constants.ts:3-9`.

Nenhum cliente define `cookieOptions`. A versão instalada usa `SameSite=Lax`, `HttpOnly=false` e não define `Secure`. O JavaScript precisa ler a sessão na arquitetura atual, mas isso eleva muito o impacto de XSS; a ausência de `Secure` deixa a primeira visita HTTP dependente de redirect/HSTS já aprendido.

**Correção:** definir `Secure` em produção. Para obter `HttpOnly`, migrar acesso sensível para BFF/server-side e não entregar refresh token ao browser. Confirmar timeout, rotação e revogação de sessão no Supabase.

### SB-SEC-013 — Segredos de alto impacto estão em diretório sincronizado pelo OneDrive

**Evidência:** o projeto está sob OneDrive e `.env.local` contém `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_SECRET` e `TOKEN_ENCRYPTION_KEY`. Nenhum valor foi incluído nesta auditoria.

O `service_role` ignora RLS; a chave de token permite decifrar refresh tokens se os ciphertexts forem obtidos. Estarem juntos num arquivo sincronizado aumenta o impacto de compartilhamento acidental, comprometimento da conta ou histórico na nuvem. A ACL local não inclui `Everyone`, mas concede leitura herdada ao grupo de sandbox do ambiente Codex.

**Correção:** retirar segredos de pastas sincronizadas, injetá-los via secret manager/CLI, revisar compartilhamentos e histórico do OneDrive, aplicar menor privilégio e rotacionar as credenciais se houver qualquer dúvida de exposição.

### SB-SEC-014 — Validação de entrada é incompleta e pode gerar 500/DoS lógico

**Evidência:**

- Data inválida em transform que lança fora do `try`: `src/lib/validation.ts:22-25` e `src/app/(app)/tarefas/actions.ts:24-29`, `:66-71`.
- Textos sem limites: `src/lib/validation.ts:16-20` e schemas que o reutilizam.
- IDs/booleans apenas tipados em várias Actions, por exemplo `src/app/(app)/calendario/actions.ts:16-25` e `src/app/(app)/drive/actions.ts:330-421`.
- Inteiros financeiros sem `.safe()`/teto de negócio.
- A busca de Conhecimento possui schema com limite, mas a página usa `sp.q` diretamente: `src/app/(app)/conhecimento/page.tsx:82-97`.

`dueAt="x"` pode produzir `RangeError` em vez de falha Zod normal. Campos ilimitados ampliam custo de banco/UI/logs, e números acima de `Number.MAX_SAFE_INTEGER` podem perder precisão.

**Correção:** schemas runtime para toda Action; UUIDs; datas validadas antes de transformar; limites de texto/JSON/arrays; inteiros seguros e tetos de negócio; erros 4xx controlados.

### SB-SEC-015 — Parâmetros e material criptográfico do Cofre não têm limites suficientes

**Evidência:** `supabase/migrations/0001_second_brain_initial.sql:566-598`, `src/app/(app)/cofre/actions.ts:68-135`, `src/lib/crypto/vault.ts:70-87`, `:133-153` e senha mínima em `src/components/features/vault/VaultClient.tsx:181-183`.

Salt, IV, wrapped key, payload, versão e parâmetros Argon2 são aceitos sem limites estruturais fortes. Valores vindos do banco alimentam diretamente Argon2id. Uma configuração malformada pode causar consumo excessivo no navegador ou lockout. O mínimo de 8 caracteres também é fraco para material que pode ser atacado offline por quem obtiver os ciphertexts.

**Correção:** validar algoritmo/versão e comprimentos exatos, limitar memória/iterações/paralelismo e payload, rejeitar versões desconhecidas e adotar passphrase mais longa/medidor de força.

### SB-SEC-016 — Ciclo de vida e separação das chaves Google estão incompletos

**Evidência:** `src/lib/crypto/tokens.ts:14-55`, `src/lib/google/oauth.ts:30-46` e `src/lib/env.ts:26-64`.

Há uma chave global; `crypto_version` é gravado mas não orienta a descriptografia; não existe key ID, estratégia dual-key ou rotação. O mesmo segredo é reutilizado como HMAC do OAuth state e o AES-GCM não usa AAD que vincule token, conta e versão. O módulo de env comum também exporta acessos públicos e secretos, embora seja importado por código client.

**Correção:** separar `public-env` de `server-env` com `server-only`; validar env no startup; separar/derivar chaves por contexto (por exemplo HKDF); registrar key ID; suportar rotação; usar conta/versão como AAD; preferir KMS quando disponível.

### SB-SEC-017 — Erros internos e dados operacionais são retornados além do necessário

**Evidência:** corpo bruto Google em `src/lib/google/calendar.ts:68-72`; persistência/retorno em `src/app/api/google/calendar/sync/route.ts:112-120`; `select("*")` em `src/app/api/google/calendar/accounts/route.ts:14-19` e `src/lib/data.ts:162-170`; numerosos retornos `error.message` em Actions, por exemplo `src/app/(app)/tarefas/actions.ts:58-175` e `src/app/(app)/drive/actions.ts:80-393`.

Podem chegar ao cliente mensagens de constraint/schema, `last_error`, `google_subject`, sync tokens, watch IDs e detalhes upstream. A rota de contas não apresentou consumidor no código.

**Correção:** DTOs e colunas explícitas; códigos de erro estáveis e mensagens públicas genéricas; logging detalhado somente no servidor com redação; remover endpoint não usado.

### SB-SEC-018 — Rascunho de captura vaza entre contas no mesmo navegador

**Evidência:** `src/components/features/capture/CaptureView.tsx:35`, `:80-119` e logout em `src/app/(auth)/actions.ts:30-33`.

Título/conteúdo ficam em claro na chave global `sb-capture-draft` do `localStorage`; o logout não limpa nem separa por usuário. Um segundo usuário na mesma origem pode receber o rascunho anterior. XSS também consegue lê-lo.

**Correção:** preferir `sessionStorage`, namespace por user ID, limpeza no logout/expiração e política explícita de retenção.

### SB-SEC-019 — Links de videoconferência podem induzir phishing

**Evidência:** `src/lib/notifications/schedule.ts:73-78`, `src/components/features/calendar/CalendarEventCard.tsx:7-13`, `:93-104` e links descriptografados em `src/components/features/vault/VaultClient.tsx:453-458`.

Uma URI de `conference_data` é renderizada e rotulada “Google Meet” sem validar host/provedor. URLs descriptografadas do Cofre também são usadas diretamente em `href`. React 19 bloqueia `javascript:` e existe `noopener` no calendário, portanto não foi confirmado XSS direto; um convite ou URL malicioso ainda pode induzir phishing.

**Correção:** aceitar somente HTTPS, exibir hostname/provedor e usar o rótulo Google Meet apenas para `meet.google.com`. Aplicar a mesma validação aos links do Cofre.

### SB-SEC-020 — Reaplicar migrations não garante buckets privados

**Evidência:** `supabase/migrations/0002_avatar_storage.sql:12-17`, `supabase/migrations/0007_drive.sql:22-27` e `supabase/verificacao.sql:58-65`.

O insert inicial usa `public=false`, porém o `ON CONFLICT DO UPDATE` não reafirma a coluna. Se houver drift para público, reaplicar a migration não fecha a exposição, e o script de verificação não testa `public`.

**Estado atual:** testes somente leitura confirmaram que os buckets remotos `avatars` e `drive` estavam `public=false`, com 2 MiB e 50 MiB. Não há exposição atual confirmada.

**Correção:** incluir `public = excluded.public` e testar explicitamente a privacidade no verificador/CI.

### SB-SEC-021 — RPC de extração de texto é executável anonimamente

**Evidência:** `supabase/migrations/0011_knowledge.sql:348-384` e teste remoto anônimo bem-sucedido.

`knowledge_extract_text(jsonb)` percorre JSON arbitrário e não revoga o `EXECUTE` padrão de `PUBLIC`. O limite de aproximadamente 1 MiB existe na Action, não na função. A chamada direta contorna esse limite e pode consumir CPU/memória do banco.

**Correção:** revogar de `PUBLIC`/`anon`, conceder apenas ao papel necessário e limitar tamanho/profundidade também na fronteira do banco/API.

### SB-SEC-022 — Retenção e limpeza não são garantidas operacionalmente

**Evidência:** `supabase/migrations/0013_audit_retention.sql:206-254` e limpeza apenas documentada de eventos cancelados em `supabase/migrations/0009_entity_links.sql:570-604`.

O job de auditoria só é criado se `pg_cron` já existir; a ausência vira `NOTICE`. A alternativa por rota não foi implementada. Dados de evento, participantes, localização e conferência podem permanecer indefinidamente.

**Correção:** scheduler obrigatório e monitorado, alerta de falha, política por classe de dado, verificação automatizada do job e testes de exclusão/restauração.

### SB-SEC-023 — Runtime EOL e pipeline de segurança não estão fixados

**Evidência:** `package.json` não contém `engines` nem `packageManager`; não existem `.nvmrc`, `.node-version` ou workflow de CI; o ambiente auditado usa Node 25.9.0/npm 11.14.1.

A linha Node 25 chegou ao fim de vida em 31/03/2026, conforme a [tabela oficial de releases do Node.js](https://nodejs.org/en/about/previous-releases). Sem pin, desenvolvimento e deploy podem divergir; não há gate automático de SCA, testes de segurança ou atualização de dependências.

**Correção:** fixar Node 24 LTS (ou outra linha LTS suportada e compatível), npm/package manager, usar `npm ci`, Dependabot/Renovate e bloquear vulnerabilidades altas/críticas de produção com exceções documentadas.

### SB-SEC-024 — Rate limiting é parcial, por processo e facilmente contornável

**Evidência:** `src/lib/rate-limit.ts:18-37`; somente algumas criações usam `bloqueioPorLimite`.

Cold starts e múltiplas instâncias reiniciam/dividem o contador. Login, sync, Drive, Cofre, transferências, parcelamentos, autosave e várias exclusões não estão cobertos; PostgREST direto contorna limites das Actions.

**Correção:** contador compartilhado, limites por usuário/IP/ação/volume, proteção de login no provedor e enforcement de quotas críticas no backend/banco.

## 5. Achados de severidade baixa

### SB-SEC-025 — Algumas tabelas ainda concedem SELECT a `anon`

Testes remotos anônimos receberam HTTP 200, mas **zero linhas**, para `profiles`, `tasks`, `calendar_events`, `vault_items`, `vault_audit_events`, `user_modules` e `notification_deliveries`. A RLS bloqueou a leitura atual, mas os privilégios dependem exclusivamente dela, ao contrário de migrations mais novas que também revogam `anon`.

**Correção:** revogar privilégios desnecessários de `anon` em todas as tabelas pessoais e revisar default privileges.

### SB-SEC-026 — `convert_capture_to_task` revela existência de UUID

**Evidência:** `supabase/migrations/0009_entity_links.sql:400-427`, `:478-481`.

A função `SECURITY DEFINER` distingue “não existe” de “não autorizado” porque busca antes de filtrar owner. UUIDv4 reduz a viabilidade, mas não substitui autorização.

**Correção:** consultar `id` e `user_id=auth.uid()` juntos e retornar erro uniforme.

### SB-SEC-027 — Paths públicos são comparados por prefixo

**Evidência:** `src/lib/supabase/middleware.ts:5`, `:79-80`.

`startsWith('/login')` e `startsWith('/auth')` também liberam futuros paths como `/login-admin` e `/authentication`. Não há colisão sensível atual identificada.

**Correção:** igualdade ou fronteira de segmento: `pathname === p || pathname.startsWith(p + '/')`.

### SB-SEC-028 — `.gitignore` não cobre todos os arquivos de ambiente do Next

**Evidência:** `.gitignore:15-17` ignora `.env`, `.env.local` e `.env*.local`, mas não `.env.production`, `.env.development` ou `.env.test`.

Nenhum desses arquivos existe hoje. Uma futura credencial pode ser commitada por engano.

**Correção:** ignorar `.env*` e liberar explicitamente `!.env.example`; complementar com secret scanning em CI e pre-commit.

### SB-SEC-029 — `brace-expansion` vulnerável no ferramental de desenvolvimento

**Evidência:** `package-lock.json:3795-3800`, `brace-expansion@1.1.16`, marcado como dev; [GHSA-mh99-v99m-4gvg](https://github.com/advisories/GHSA-mh99-v99m-4gvg).

O risco prático está restrito a lint/CI com padrões não confiáveis. A versão corrigida é 1.1.17 ou posterior.

**Correção:** regenerar o lockfile para 1.1.18 compatível e confirmar a remoção no `npm audit`.

### SB-SEC-030 — Cabeçalhos adicionais de isolamento podem ser adotados

**Evidência:** `next.config.mjs:21-38` já configura boas bases, mas não há COOP/CORP; `Permissions-Policy` cobre poucas APIs e HSTS não usa `preload`.

**Correção:** testar `Cross-Origin-Opener-Policy` e `Cross-Origin-Resource-Policy`, negar APIs não usadas e só solicitar HSTS preload depois de garantir HTTPS permanente em todos os subdomínios.

### SB-SEC-031 — Ownership do Conhecimento depende da visibilidade RLS em rotinas administrativas

**Evidência:** `supabase/migrations/0011_knowledge.sql:623-691`.

Para usuário comum a RLS fecha o caso, mas a trigger diferida não compara explicitamente `notebook.user_id` e `page.user_id`. Em `service_role`, restore ou rotina administrativa, relações cruzadas podem passar.

**Correção:** comparar donos explicitamente ou usar FK composta.

### SB-SEC-032 — `CRON_SECRET` e URL direta do banco estão vazios no ambiente local

**Evidência:** `vercel.json:3-7`, `.env.local` e `src/lib/cron-auth.ts:111-116`.

O cron declarado falha fechado quando o segredo está vazio, portanto não há bypass; se a produção também estiver assim, a sincronização agendada retorna 401. A ausência da URL do banco também impediu inspeção completa de catálogo/grants com `psql`.

**Correção:** confirmar `CRON_SECRET` aleatório de alta entropia na Vercel e testar execução real. Não adicionar URL de banco ao projeto apenas para satisfazer esta auditoria.

### SB-SEC-033 — OAuth state não é one-time e não usa PKCE

**Evidência:** `src/app/api/google/calendar/connect/route.ts:28-30` e `src/lib/google/oauth.ts:23-55`.

O state é HMAC, ligado ao usuário e expira em dez minutos — controles positivos. Porém o nonce não é persistido/consumido, timestamps futuros não são rejeitados explicitamente e não há PKCE. O authorization code normalmente é de uso único, o que reduz o risco de replay.

**Correção:** persistir/consumir nonce, rejeitar timestamps futuros/tipos inválidos e adotar PKCE quando compatível com o fluxo Google utilizado.

## 6. Pontos em aberto no ambiente de produção

Estes itens precisam de verificação externa antes de declarar o ambiente seguro:

1. **Signup público:** a UI afirma que está desativado, mas não há `supabase/config.toml` versionado. Testar diretamente `signUp` e registrar `enable_signup=false`.
2. **MFA/AAL2:** não há fluxo/enforcement; avaliar obrigatoriedade para Cofre, Financeiro e operações de alto impacto.
3. **Política de senha e credential stuffing:** confirmar comprimento, senha vazada, CAPTCHA, rate limits e alertas do Supabase Auth.
4. **Sessões/JWT:** confirmar duração, rotação de refresh token, revogação, AAL e redirects permitidos.
5. **Google OAuth:** revisar escopos mínimos, tela de consentimento, redirects, política de logs e rotação do client secret.
6. **Vercel:** confirmar `CRON_SECRET`, versão do Node, headers efetivos, proteção do preview e separação de segredos por ambiente.
7. **`pg_cron`:** confirmar extensão, job instalado, último sucesso e alertas.
8. **Backup/PITR:** existe checklist em `docs/database-setup.md:234-244` e `:300-310`, mas não evidência de restore testado.
9. **Migrations implantadas:** sem acesso ao catálogo completo, não foi possível provar policies/grants/funções de todo o banco remoto ou validar drift além dos testes pontuais.
10. **OneDrive:** revisar compartilhamentos, lixeira, versões/histórico e dispositivos sincronizados; rotacionar se houver exposição possível.
11. **Logs/telemetria:** confirmar redação de tokens, retenção, alertas de login/sync/erros e acesso administrativo aos logs.
12. **CSRF:** Server Actions contam com proteção de origem do Next e `SameSite=Lax`, mas rotas POST de disconnect/sync não validam explicitamente `Origin`/`Sec-Fetch-Site`. Reavaliar se cookies/proxy mudarem.
13. **Dados financeiros:** são deliberadamente armazenados em claro no banco (`supabase/migrations/0005_finance.sql:4-15`); RLS não protege contra service role, admins, dumps e backups.
14. **Privacidade/LGPD:** definir retenção, exportação e exclusão verificável para calendário, financeiro, auditoria, uploads, backups e logs.
15. **Histórico Git:** não existe diretório `.git` neste snapshot; não foi possível procurar segredos antigos, commits suspeitos ou alterações não autorizadas.

## 7. Controles positivos confirmados

- Todas as tabelas pessoais criadas nas migrations recebem RLS e policies baseadas em `auth.uid()`.
- Nos testes remotos, `avatars` e `drive` estavam privados; consultas anônimas amostradas não retornaram dados pessoais.
- `google_oauth_credentials` tem grants de cliente revogados e acesso administrativo server-side.
- Clientes `service_role` e criptografia de token importam `server-only`.
- Tokens Google usam AES-256-GCM, IV aleatório de 12 bytes e autenticação de ciphertext.
- O cron falha fechado e compara o segredo em tempo constante.
- OAuth state é assinado, ligado ao usuário e tem expiração curta.
- O servidor usa `auth.getUser()`, não apenas confiança em payload local.
- Endpoints Google são constantes e IDs são codificados; nenhuma SSRF foi confirmada.
- Consultas Supabase são parametrizadas; SQL dinâmico usa listas internas/identificadores seguros; nenhuma SQL injection foi confirmada.
- Não foram encontrados command execution, open redirect ou uso de `eval`.
- O único `dangerouslySetInnerHTML` encontrado recebe um script constante de tema.
- Links sociais têm allowlist HTTPS, canonicalização e `noopener noreferrer`.
- Avatar tem limite de 2 MiB e allowlist MIME no app/bucket.
- Downloads do Drive usam URL assinada curta e `Content-Disposition: attachment`.
- Login devolve mensagem genérica, reduzindo enumeração de e-mail.
- Headers atuais incluem HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer Policy e Permissions Policy; `poweredByHeader` está desativado.
- `.env.example` usa placeholders; nenhum segredo foi reproduzido neste relatório.
- A chave local de criptografia passou na verificação redigida de Base64/32 bytes.
- `package-lock.json` v3 está presente; 580 entradas resolvidas possuem integrity e vêm de `https://registry.npmjs.org`.
- `npm audit signatures` verificou 474 pacotes assinados e 122 attestations.

## 8. Verificações executadas

| Área | Verificação | Resultado |
|---|---|---|
| Inventário | Arquivos, rotas, Server Actions, migrations, configs e docs | Revisados; 68 Actions/handlers considerados na revisão de aplicação. |
| Segredos | Busca por padrões, nomes de env, prefixos públicos, formato e ACL; valores suprimidos | Nenhum segredo hardcoded fora de `.env.local`; risco operacional descrito em SB-SEC-013. |
| Dependências | `npm audit --json` | 4 altas; 3 de produção. |
| Supply chain | `npm audit signatures`, origem/integrity do lockfile, `npm ls`, versões | Assinaturas/integrity válidas; árvore consistente. |
| Testes | Vitest sem cache | 18 arquivos e 317 testes passaram. |
| Tipos | TypeScript `--noEmit --incremental false` | Passou. |
| Lint | Script de lint do projeto/ESLint compatível | Passou; houve aviso de depreciação do `next lint`. |
| Supabase remoto | Buckets e chamadas anônimas somente leitura | Buckets privados; zero linhas nas tabelas amostradas; RPC anônima confirmada. |
| Código | AuthN/AuthZ, validação, OAuth, crypto, upload, CSP, cookies, links, erros | Achados SB-SEC-001 a 033. |
| SQL | Schema, RLS, policies, grants, functions, triggers, retention, Storage | Achados de auditoria, ownership, grants, RPC e retenção confirmados. |

Ferramentas especializadas `gitleaks`, `trivy`, `semgrep`, `snyk` e `osv-scanner` não estavam instaladas. A busca de segredos e a análise de código foram feitas manualmente e por padrões com `rg`; isso deve ser complementado por SAST/secret scanning no CI.

## 9. Limitações e integridade da auditoria

- Não houve teste destrutivo, tentativa de tomar conta, brute force, alteração de RLS, upload abusivo ou escrita persistente.
- Não foi executado DAST autenticado em navegador nem pentest de infraestrutura/Vercel/Google/OneDrive.
- O banco remoto foi amostrado apenas com chamadas anônimas e leitura de metadados; não houve teste real com dois usuários.
- Não foi possível consultar integralmente `pg_catalog`, grants, jobs e drift do banco por falta de conexão SQL local configurada.
- Não foi possível revisar histórico Git porque este diretório não é um repositório Git.
- O build não foi refeito para evitar reescrever `.next`; o estado implantado pode divergir do snapshot local.
- As versões/advisories são temporais e devem ser rechecados na correção.
- Nenhum arquivo de fonte, configuração ou dependência foi alterado. Como efeito colateral do lint, um cache ESLint preexistente em `.next/cache` foi atualizado; trata-se de artefato gerado e recriável. O único arquivo deliberadamente criado é este relatório, conforme solicitado.

## 10. Plano de remediação sugerido

### P0 — imediatamente / até 72 horas

1. Corrigir SB-SEC-001 e adicionar teste de auto-lock.
2. Suspender a alegação de recuperação ou entregar o fluxo completo de SB-SEC-002.
3. Revogar mutações diretas nas auditorias e torná-las atômicas (SB-SEC-003).
4. Corrigir ownership de calendário e Drive; bloquear escrita cliente no cache Google (SB-SEC-004).
5. Mover token da query string para o body e revisar logs (SB-SEC-006).
6. Planejar/testar correção das dependências de produção (SB-SEC-007).
7. Revisar exposição do `.env.local` no OneDrive e rotacionar se necessário (SB-SEC-013).

### P1 — próximo ciclo / 1 a 2 sprints

1. Backend de upload, quota, reconciliação e rate limit do Drive.
2. CSP com nonce e enforcement; `Secure` nos cookies.
3. FKs compostas/triggers same-owner em todo o schema.
4. Grants específicos e invariantes críticas no banco/RPC.
5. Guard de módulo nas Actions/rotas.
6. Auth antes de parsing, lock/idempotência e rate limit distribuído no sync.
7. Schemas runtime completos, limites de payload e erros/DTOs redigidos.
8. Limites do Cofre e estratégia de rotação/AAD para tokens Google.
9. Scheduler de retenção monitorado.

### P2 — hardening contínuo

1. Fixar Node LTS/package manager e criar CI com lint, tipos, testes, SCA, SAST e secret scanning.
2. Testes de integração Supabase com anon e dois usuários cobrindo todas as operações/FKs.
3. MFA/AAL2, política de senha, proteção a credential stuffing e revisão de sessão.
4. DAST autenticado e revisão periódica de Google/Vercel/Supabase.
5. Restore drill de backup/PITR e política LGPD de retenção/exclusão.
6. Métricas/alertas para login, sync, falha de auditoria, quota e jobs de retenção.

## 11. Critérios para encerrar os principais riscos

- Após auto-lock, não existe chave/closure acessível globalmente e o Cofre exige senha novamente.
- Um kit exportado recupera um cofre de teste em ambiente limpo; somente o código, isolado, não é anunciado como suficiente se não for.
- Usuário autenticado não consegue inserir evento arbitrário nem atualizar/apagar auditoria via REST/Action.
- Dois usuários de teste não conseguem formar nenhuma FK cruzada nem inferir UUID por mensagens diferentes.
- Usuário não consegue exceder cota do Drive por upload direto, objeto órfão ou tamanho falsificado.
- Logs de app/proxy/APM não contêm refresh token nem segredo de cron.
- CSP efetiva bloqueia script sem nonce e todos os fluxos funcionam sem `unsafe-inline`.
- `npm audit --omit=dev` não reporta alta/crítica, ou cada exceção tem justificativa, compensação, owner e prazo.
- Testes anônimos recebem 401/403 para RPCs e tabelas que não precisam ser públicas.
- Jobs de retenção e backup têm última execução bem-sucedida, alerta e restore testado.

---

**Conclusão:** a base possui controles importantes — especialmente RLS, segregação do `service_role`, AES-GCM, URLs assinadas e headers — mas o estado atual ainda não deve ser tratado como endurecido para múltiplos usuários ou para dados de alto valor. Os cinco riscos mais urgentes são Cofre, auditoria mutável, ownership cross-tenant, upload sem quota real e dependências de produção vulneráveis.
