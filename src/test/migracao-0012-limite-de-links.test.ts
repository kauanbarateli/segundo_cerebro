import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIMITE_DE_LINKS } from "@/lib/social";

/**
 * A REGRA DA TRIGGER DE LIMITE DA 0012, TRAVADA CONTRA REGRESSÃO.
 *
 * O defeito que este arquivo existe para impedir de voltar: `reorderSocialLinks`
 * grava a nova ordem com UM `insert ... on conflict (id) do update`, e no Postgres
 * as triggers BEFORE INSERT por linha rodam ANTES da detecção do conflito — ou
 * seja, `trg_social_links_limit` é executada para TODA linha proposta, inclusive
 * as que vão terminar no ramo DO UPDATE. Uma trigger que apenas conte as linhas do
 * usuário e levante exceção em `total >= 8` aborta a instrução inteira para quem
 * está nas 8 vagas: arrastar um item devolve "Você já tem 8 links. Remova um antes
 * de adicionar outro." e a lista pula de volta para a ordem antiga. Com 7 links ou
 * menos funciona — por isso o defeito passa despercebido em teste manual, e por
 * isso precisa de teste automatizado.
 *
 * POR QUE O TESTE LÊ O ARQUIVO .sql EM VEZ DE EXERCITAR O BANCO. A suíte roda em
 * `environment: "node"`, sem Postgres e sem credenciais — não há onde executar a
 * trigger. Um teste que simulasse a semântica do `on conflict` num falso não
 * provaria nada: o falso teria que embutir a própria correção que deveria estar
 * verificando, e continuaria verde com o defeito de volta. O que dá para checar
 * sem banco, e é exatamente o que importa aqui, é a FORMA da função: existe a
 * saída antecipada para id que já existe, e ela vem ANTES da contagem que levanta
 * a exceção. Remover essa saída (que é como o defeito volta) deixa este arquivo
 * vermelho.
 *
 * As asserções rodam sobre o SQL com os comentários REMOVIDOS, de propósito: os
 * comentários da 0012 citam `on conflict do update` e o próprio predicado da
 * guarda em texto corrido, e casar contra eles faria o teste aprovar uma função
 * que só FALA da correção sem a implementar.
 */

const sqlBruto = readFileSync(
  fileURLToPath(new URL("../../supabase/migrations/0012_social_links.sql", import.meta.url)),
  "utf8",
);

/**
 * Tira os comentários de linha (`--` até o fim da linha) e achata o espaço em
 * branco, para que a asserção não dependa de indentação nem de quebra de linha.
 * Não há literal de string com `--` dentro nesta migration, então o corte simples
 * é suficiente aqui.
 */
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

/** Corpo da função de limite, entre o `as $$` e o `$$;` que o fecha. */
function corpoDaFuncao(): string {
  const inicio = sql.indexOf("create or replace function public.enforce_social_links_limit()");
  expect(inicio, "a função de limite sumiu da 0012").toBeGreaterThanOrEqual(0);
  const abre = sql.indexOf("as $$", inicio);
  const fecha = sql.indexOf("$$;", abre + 5);
  expect(abre, "corpo da função não encontrado").toBeGreaterThan(-1);
  expect(fecha, "fim do corpo da função não encontrado").toBeGreaterThan(abre);
  return sql.slice(abre + 5, fecha);
}

describe("0012 — trigger de limite de links sociais", () => {
  it("continua sendo BEFORE INSERT por linha", () => {
    // Se alguém somar `or update`, toda edição de rótulo passa a pagar o
    // `count(*)` — e, com a saída antecipada abaixo, a trigger vira código morto
    // no caminho de update. A forma esperada é uma só.
    expect(sql).toContain(
      "create trigger trg_social_links_limit before insert on public.social_links for each row execute function public.enforce_social_links_limit()",
    );
    expect(sql).not.toContain("before insert or update on public.social_links");
  });

  it("sai ANTES de contar quando o id proposto já existe", () => {
    // ESTA É A ASSERÇÃO QUE PEGA O DEFEITO. Linha cujo id já está na tabela não
    // aumenta o total (ou vira UPDATE, ou colide na chave primária), então contar
    // nela só serve para abortar a reordenação de quem está no teto.
    const corpo = corpoDaFuncao();

    const guarda =
      /if\s+exists\s*\(\s*select\s+1\s+from\s+public\.social_links\s+where\s+id\s*=\s*new\.id\s*\)\s*then\s+return\s+new;\s*end\s+if;/;
    expect(guarda.test(corpo), "a saída antecipada para id existente não está no corpo").toBe(true);

    const posicaoDaGuarda = corpo.search(guarda);
    const posicaoDaExcecao = corpo.indexOf("raise exception");
    expect(posicaoDaExcecao, "a exceção de limite sumiu").toBeGreaterThan(-1);
    // Ordem importa: uma guarda depois do `raise` não impede nada.
    expect(posicaoDaGuarda).toBeLessThan(posicaoDaExcecao);
  });

  it("a guarda vem DEPOIS do advisory lock, para ler o mesmo estado do count", () => {
    // Entre uma leitura sem lock e a contagem com lock haveria uma janela em que
    // outra transação apaga a linha: o "já existe" ficaria desatualizado.
    const corpo = corpoDaFuncao();
    const posicaoDoLock = corpo.indexOf("pg_advisory_xact_lock");
    const posicaoDaGuarda = corpo.indexOf("if exists (select 1 from public.social_links");
    expect(posicaoDoLock, "o advisory lock por usuário sumiu").toBeGreaterThan(-1);
    // Sem esta linha um -1 (guarda ausente) faria a comparação passar sozinha.
    expect(posicaoDaGuarda, "a saída antecipada para id existente sumiu").toBeGreaterThan(-1);
    expect(posicaoDoLock).toBeLessThan(posicaoDaGuarda);
  });

  it("ainda conta e recusa a linha de número 9", () => {
    // A correção não pode ter virado "some com o limite": a contagem e a recusa
    // continuam lá, e o número continua sendo o mesmo de LIMITE_DE_LINKS.
    const corpo = corpoDaFuncao();
    expect(corpo).toContain("select count(*) into v_total from public.social_links");
    expect(corpo).toContain("if v_total >= v_limite then");
    expect(corpo).toContain(`v_limite constant integer := ${LIMITE_DE_LINKS};`);
    // A server action reconhece o caso por este trecho de texto e pelo SQLSTATE.
    expect(corpo).toContain("links sociais");
    expect(corpo).toContain("errcode = 'check_violation'");
  });
});
