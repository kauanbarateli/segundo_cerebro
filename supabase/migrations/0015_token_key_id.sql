-- =============================================================================
-- 0015 — Identificação da chave que cifrou cada refresh token (SB-SEC-016)
--
-- Escopo: UMA coluna. Todo o resto do trabalho é da aplicação.
--
-- =============================================================================
-- O PROBLEMA
-- =============================================================================
-- Os refresh tokens do Google são cifrados com AES-256-GCM sob uma chave única
-- vinda de `TOKEN_ENCRYPTION_KEY`. A tabela já grava `crypto_version`, mas esse
-- número NUNCA foi consultado na hora de decifrar — a leitura simplesmente
-- assume a chave atual do ambiente.
--
-- A consequência prática é que a chave é IRROTACIONÁVEL. Trocá-la torna todo
-- token gravado ilegível de uma vez, e a única recuperação é reconectar cada
-- conta do Google à mão. Ou seja: no dia em que a chave vazar — o dia em que
-- rotacionar é obrigatório — o custo de rotacionar é uma interrupção do
-- serviço. Isso empurra a decisão para depois, que é exatamente o que não pode
-- acontecer com chave vazada.
--
-- =============================================================================
-- A COLUNA
-- =============================================================================
-- `key_id` diz QUAL chave cifrou aquela linha. Com ela, duas chaves podem
-- coexistir: a nova cifra o que entra, a antiga continua decifrando o que já
-- estava lá, e a migração das linhas acontece naturalmente conforme cada conta
-- renova o token. Nenhuma janela de indisponibilidade.
--
-- NULO É O ESTADO LEGADO, e por isso a coluna é anulável em vez de ter default.
-- Um default (`'v1'`, digamos) marcaria as linhas existentes como cifradas por
-- uma chave nomeada que nunca existiu; o código leria esse rótulo, procuraria a
-- chave `v1` no ambiente e não a encontraria. `null` é honesto: significa
-- "cifrado antes de existir identificação de chave", e a aplicação sabe tratar
-- esse caso — ver CRYPTO_VERSION_LEGADO em src/lib/crypto/tokens.ts.
--
-- POR QUE NÃO REESCREVER AS LINHAS EXISTENTES AQUI: recifrar exige as chaves,
-- que moram no ambiente da aplicação e não no banco. Uma migration não tem
-- acesso a elas — e não deveria ter.
-- =============================================================================

alter table public.google_oauth_credentials
  add column if not exists key_id text;

comment on column public.google_oauth_credentials.key_id is
  'Identificador da chave de TOKEN_ENCRYPTION_KEYS que cifrou esta linha. NULL = cifrado antes da 0015, sob a chave unica de TOKEN_ENCRYPTION_KEY (crypto_version 1, sem AAD). Permite rotacao sem reconectar as contas.';

comment on column public.google_oauth_credentials.crypto_version is
  'Formato da cifragem. 1 = AES-256-GCM sem AAD, chave unica (legado). 2 = AES-256-GCM com AAD "<calendar_account_id>:<versao>", chave escolhida por key_id. A leitura ORIENTA-SE por esta coluna.';
