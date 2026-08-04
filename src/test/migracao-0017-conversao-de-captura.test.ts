import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `convert_capture_to_task` FOI REESCRITA PELA TERCEIRA VEZ, E O RISCO É A
 * CÓPIA MANUAL.
 *
 * O caminho da função: 0001 (criação) → 0009 (acrescentou o vínculo) → 0017
 * (acrescenta `project_id`). Cada versão é um `create or replace` que
 * transcreve o corpo inteiro da anterior.
 *
 * ⚠️ O PERIGO NÃO É O `project_id`. É perder na transcrição o bloco
 * `insert into public.task_capture_links ... on conflict do nothing` que a 0009
 * acrescentou. Isso regride a funcionalidade daquela migration EM SILÊNCIO: os
 * selos de vínculo somem só nas conversões NOVAS, nada falha, nada avisa, e a
 * causa fica a duas migrations de distância de onde o sintoma aparece.
 *
 * POR QUE O TESTE LÊ O ARQUIVO `.sql` EM VEZ DE EXERCITAR O BANCO. A suíte roda
 * em `environment: "node"`, sem Postgres e sem credenciais — não há onde
 * executar a função. Um falso que simulasse a semântica teria que embutir a
 * própria correção que deveria estar verificando, e continuaria verde com o
 * defeito de volta. O que dá para checar sem banco, e é exatamente o que
 * importa, é a FORMA da função.
 *
 * É o mesmo padrão de `migracao-0012-limite-de-links.test.ts`.
 *
 * As asserções rodam sobre o SQL com os COMENTÁRIOS REMOVIDOS, de propósito: o
 * cabeçalho da 0017 cita o insert do vínculo e a regra do `project_id` em texto
 * corrido, e casar contra eles faria o teste aprovar uma função que só FALA da
 * correção sem a implementar.
 */

const sqlBruto = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/0017_projetos.sql", import.meta.url)),
  "utf8",
);

function codigo(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => linha.replace(/--.*$/, ""))
    .join("\n")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

const sql = codigo(sqlBruto);

/** O corpo da função, entre o `as $$` que a abre e o `$$;` que a fecha. */
function corpoDaConversao(): string {
  const inicio = sql.indexOf("create or replace function public.convert_capture_to_task(p_capture_id uuid)");
  expect(inicio, "a função de conversão sumiu da 0017").toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf("as $$", inicio);
  const fecha = sql.indexOf("$$;", abre + 5);
  expect(abre, "corpo da função não encontrado").toBeGreaterThan(-1);
  expect(fecha, "fim do corpo não encontrado").toBeGreaterThan(abre);
  return sql.slice(abre + 5, fecha);
}

describe("0017 — convert_capture_to_task, terceira versão", () => {
  it("⚠️ O INSERT DO VÍNCULO DA 0009 CONTINUA NO CORPO", () => {
    /*
      A ASSERÇÃO QUE JUSTIFICA ESTE ARQUIVO. Sem ela, a próxima reescrita perde
      o bloco na transcrição e ninguém percebe: as conversões antigas mantêm o
      selo, as novas não, e nada falha.
    */
    const corpo = corpoDaConversao();
    expect(corpo).toContain("insert into public.task_capture_links (task_id, capture_id, user_id)");
    expect(corpo).toContain("on conflict do nothing");
  });

  it("o vínculo é criado DEPOIS dos dois ramos, e não só quando a tarefa é nova", () => {
    // Era o ponto da mudança da 0009: capturas convertidas antes dela não têm
    // vínculo, e o ramo idempotente é a única chance de criá-lo.
    const corpo = corpoDaConversao();
    const posicaoDoRamo = corpo.indexOf("if v_capture.converted_task_id is not null then");
    const posicaoDoEndIf = corpo.indexOf("end if;", posicaoDoRamo);
    const posicaoDoVinculo = corpo.indexOf("insert into public.task_capture_links");
    expect(posicaoDoRamo).toBeGreaterThan(-1);
    expect(posicaoDoVinculo).toBeGreaterThan(posicaoDoEndIf);
  });

  it("⚠️ O RAMO IDEMPOTENTE NÃO ATRIBUI project_id", () => {
    /*
      A tarefa já existe e pode ter sido movida de projeto desde a conversão.
      Reatribuí-la aqui desfaria uma decisão do usuário toda vez que ele
      reconvertesse a captura — e reconverter é justamente o gesto que a 0009
      transformou em "conserta o vínculo que falta".
    */
    const corpo = corpoDaConversao();
    const inicioDoRamo = corpo.indexOf("if v_capture.converted_task_id is not null then");
    const inicioDoElse = corpo.indexOf("else", inicioDoRamo);
    const ramo = corpo.slice(inicioDoRamo, inicioDoElse);
    expect(ramo).not.toContain("project_id");
    // E não pode haver um update de project_id em nenhum lugar da função.
    expect(corpo).not.toMatch(/update\s+public\.tasks\s+set[^;]*project_id/);
  });

  it("⚠️ O project_id COPIADO PASSA POR FILTRO DE PROJETO VIVO", () => {
    /*
      Esta função é `security definer` com `set search_path = ''`: roda FORA da
      RLS. A trigger `enforce_project_alive_same_owner` é `security invoker` e,
      avaliada aqui, roda como DONA das tabelas — não barra nada. A checagem
      vira no-op justamente no caminho onde ninguém olha.

      Sem o subselect, uma captura de projeto apagado produziria tarefa órfã —
      exatamente o defeito que a 0009 usou como argumento para matar o modelo
      polimórfico.
    */
    const corpo = corpoDaConversao();
    const filtro =
      /\(select p\.id from public\.projects as p where p\.id = v_capture\.project_id and p\.deleted_at is null\)/;
    expect(filtro.test(corpo), "o filtro de projeto vivo não está no corpo").toBe(true);

    // E o valor copiado é o do subselect, não `v_capture.project_id` cru.
    expect(corpo).not.toMatch(/values\s*\([^)]*v_capture\.project_id\s*,/);
  });

  it("continua security definer com search_path vazio", () => {
    // Mudar isto quebraria a função para quem chama sem privilégio de tabela —
    // e `search_path` vazio é o que impede sequestro por schema no caminho.
    const inicio = sql.indexOf("create or replace function public.convert_capture_to_task");
    const cabecalho = sql.slice(inicio, sql.indexOf("as $$", inicio));
    expect(cabecalho).toContain("security definer");
    expect(cabecalho).toContain("set search_path = ''");
  });

  it("as checagens de autenticação e de propriedade continuam antes de tudo", () => {
    const corpo = corpoDaConversao();
    expect(corpo).toContain("raise exception 'not authenticated'");
    expect(corpo).toContain("if v_capture.user_id <> v_uid then");
    const posicaoDaChecagem = corpo.indexOf("if v_capture.user_id <> v_uid then");
    const posicaoDoInsert = corpo.indexOf("insert into public.tasks");
    expect(posicaoDaChecagem).toBeLessThan(posicaoDoInsert);
  });

  it("o lock da linha da captura continua lá", () => {
    // Sem `for update`, duas chamadas concorrentes inserem duas tarefas.
    expect(corpoDaConversao()).toContain("for update");
  });
});

describe("0017 — a coluna project_id fica no CONTÊINER, nunca no item", () => {
  it("entra nas quatro tabelas certas", () => {
    for (const tabela of ["tasks", "captures", "knowledge_notebooks", "drive_folders"]) {
      expect(sql).toContain(
        `alter table public.${tabela} add column if not exists project_id uuid references public.projects (id) on delete set null`,
      );
    }
  });

  it("⚠️ NÃO entra em knowledge_pages, drive_files nem calendar_events", () => {
    /*
      `knowledge_pages` já tem `notebook_id not null` MAIS `parent_id`
      autorreferente, com trigger obrigando mãe e filha ao mesmo caderno e uma
      CTE recursiva arrastando a subárvore. Um `project_id` ali cria um TERCEIRO
      contêiner numa árvore que já tem invariante escrita — nada impediria a
      página P no projeto A com a filha C no projeto B.

      `calendar_events` é cache reescrito por sync: a coluna seria apagada na
      próxima sincronização.
    */
    for (const tabela of ["knowledge_pages", "drive_files", "calendar_events"]) {
      expect(sql).not.toContain(`alter table public.${tabela} add column if not exists project_id`);
    }
  });

  it("as quatro tabelas ganham a trigger de guarda", () => {
    // A FK garante que o projeto existe. NÃO garante que é seu nem que está
    // vivo — a checagem de FK roda como dono e ignora a RLS, e soft delete não
    // dispara `on delete set null`.
    expect(sql).toContain("array['tasks', 'captures', 'knowledge_notebooks', 'drive_folders']");
    expect(sql).toContain("create trigger %i before insert or update of project_id on public.%i");
  });

  it("a guarda é security INVOKER — senão não enxerga a RLS de quem chama", () => {
    const inicio = sql.indexOf(
      "create or replace function public.enforce_project_alive_same_owner()",
    );
    expect(inicio).toBeGreaterThanOrEqual(0);
    const cabecalho = sql.slice(inicio, sql.indexOf("as $$", inicio));
    expect(cabecalho).toContain("security invoker");
    expect(cabecalho).not.toContain("security definer");
  });

  it("a condição `is not null` está NO TRIGGER, não dentro da função", () => {
    // `tasks` é tabela quente e a maioria das escritas não tem projeto: com a
    // condição na trigger, o caminho comum não paga nem a chamada da função.
    expect(sql).toContain("for each row when (new.project_id is not null)");
  });

  it("a guarda recusa projeto APAGADO, não só inexistente", () => {
    const inicio = sql.indexOf(
      "create or replace function public.enforce_project_alive_same_owner()",
    );
    const abre = sql.indexOf("as $$", inicio);
    const corpo = sql.slice(abre, sql.indexOf("$$;", abre));
    expect(corpo).toContain("and p.deleted_at is null");
  });
});
