-- =============================================================================
-- 0020 — IMAGEM NA CAPTURA
--
-- Capturar é "a caixa de entrada para tirar da cabeça", e boa parte do que se
-- quer tirar da cabeça é VISUAL: um print, a foto do quadro branco, o recibo.
-- Até aqui era preciso ir ao Drive, subir o arquivo e depois procurar a captura
-- para relacionar as duas coisas — três telas para o gesto que deveria ser um.
--
-- =============================================================================
-- ⚠️ O QUE ESTA MIGRATION **NÃO** FAZ, E POR QUÊ
-- =============================================================================
-- Ela NÃO cria bucket, NÃO cria tabela de arquivo e NÃO duplica política de
-- storage. A imagem anexada é um arquivo de Drive comum, no bucket `drive` que
-- a 0007 já criou, com as mesmas quatro policies de `storage.objects` e a mesma
-- contabilidade de cota (`drive_usage`).
--
-- As três alternativas consideradas:
--
--   bucket `capturas` próprio    isolamento real, e em troca: outra política de
--                                storage para manter em sincronia, outra conta
--                                de cota, e um arquivo que o usuário vê na
--                                captura e não encontra no Drive.
--   pasta oculta no `drive`      reusa a infraestrutura, mas "oculto" sempre
--                                vaza — na busca, na lixeira, no cálculo de
--                                espaço — e aí é pior que visível, porque
--                                aparece onde ninguém explicou por quê.
--   arquivo de Drive normal      ← escolhido. Zero infraestrutura nova, e a
--                                imagem continua alcançável pelo Drive, que é
--                                coerente com "um lugar para tudo".
--
-- O que falta, então, é só o VÍNCULO — e é só isso que esta migration cria.
--
-- =============================================================================
-- ⚠️ POR QUE UMA QUARTA TABELA DE VÍNCULO, E NÃO UMA COLUNA EM `captures`
-- =============================================================================
-- Uma coluna `captures.image_file_id` limitaria a uma imagem por captura para
-- sempre, e "colei três prints da mesma conversa" é o caso normal, não a
-- exceção. Tabela de vínculo é N:N desde o primeiro dia e não custa nada a
-- mais: a 0009 já resolveu a parte difícil.
--
-- E ela resolveu PREVENDO ISTO. `enforce_link_same_owner` foi escrita genérica
-- de propósito, e o comentário dela diz por quê: "Uma quarta tabela de vínculo
-- no futuro precisa só de um trigger, não de outra função." Esta é a quarta.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Captura ↔ Arquivo do Drive
-- -----------------------------------------------------------------------------
-- Mesma forma das três da 0009, e as mesmas razões:
--   - sem coluna `id`: a identidade do vínculo É o par, e uma chave substituta
--     só permitiria o mesmo par duas vezes;
--   - sem `updated_at`: vínculo não se edita, cria e apaga;
--   - `user_id` desnormalizado para a RLS avaliar sem join, mantido coerente
--     pelo trigger.
--
-- `on delete cascade` nas duas pontas: apagar a captura leva o vínculo junto, e
-- apagar o arquivo também. O ARQUIVO EM SI não é apagado ao desanexar — ele é
-- um arquivo de Drive, e continua lá. Desanexar é `delete` da linha daqui.
create table if not exists public.capture_file_links (
  capture_id uuid not null references public.captures (id)    on delete cascade,
  file_id    uuid not null references public.drive_files (id) on delete cascade,
  user_id    uuid not null references auth.users (id)         on delete cascade,
  created_at timestamptz not null default now(),
  primary key (capture_id, file_id)
);

comment on table public.capture_file_links is
  'Vínculo N:N entre capturas e arquivos do Drive — as imagens anexadas a uma captura. Sem updated_at: vínculo não se edita, cria e apaga. A PK composta impede par duplicado.';
comment on column public.capture_file_links.user_id is
  'Dono, desnormalizado para a RLS avaliar sem join. Mantido igual ao dono das DUAS pontas por trg_capture_file_links_same_owner.';
comment on column public.capture_file_links.file_id is
  'O arquivo no Drive. Desanexar apaga ESTA linha, nunca o arquivo — ele é um arquivo de Drive comum e continua lá.';

-- O índice da PK cobre (capture_id, file_id) e portanto atende "os arquivos
-- desta captura". A pergunta inversa — "a que capturas este arquivo está
-- anexado?", feita ao excluir um arquivo no Drive — não tem índice na PK, e
-- sem ele a checagem vira varredura da tabela inteira.
create index if not exists capture_file_links_file_idx
  on public.capture_file_links (file_id);

-- -----------------------------------------------------------------------------
-- O trigger de propriedade — a função já existe desde a 0009
-- -----------------------------------------------------------------------------
-- Sem ele, a FK provaria que as duas linhas EXISTEM e não que são do mesmo
-- dono: bastaria inserir um vínculo com o próprio user_id apontando para o
-- arquivo de outra pessoa. O `with check` da policy passaria (o user_id é o
-- dele) e a FK também. Ver o bloco grande da 0009.
drop trigger if exists trg_capture_file_links_same_owner on public.capture_file_links;
create trigger trg_capture_file_links_same_owner
  before insert or update on public.capture_file_links
  for each row execute function public.enforce_link_same_owner(
    'captures', 'capture_id', 'drive_files', 'file_id'
  );

-- -----------------------------------------------------------------------------
-- RLS + GRANTS — o mesmo bloco das outras três
-- -----------------------------------------------------------------------------
do $$
declare
  t text := 'capture_file_links';
begin
  execute format('alter table public.%I enable row level security;', t);

  execute format('drop policy if exists %1$s_select on public.%1$I;', t);
  execute format('create policy %1$s_select on public.%1$I
    for select to authenticated using ((select auth.uid()) = user_id);', t);

  execute format('drop policy if exists %1$s_insert on public.%1$I;', t);
  execute format('create policy %1$s_insert on public.%1$I
    for insert to authenticated with check ((select auth.uid()) = user_id);', t);

  execute format('drop policy if exists %1$s_update on public.%1$I;', t);
  execute format('create policy %1$s_update on public.%1$I
    for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);', t);

  execute format('drop policy if exists %1$s_delete on public.%1$I;', t);
  execute format('create policy %1$s_delete on public.%1$I
    for delete to authenticated using ((select auth.uid()) = user_id);', t);

  execute format('grant select, insert, update, delete on public.%I to authenticated;', t);
  execute format('grant all on public.%I to service_role;', t);
  -- O papel anônimo nunca enxerga a teia de relacionamentos do usuário.
  execute format('revoke all on public.%I from anon;', t);
end
$$;
