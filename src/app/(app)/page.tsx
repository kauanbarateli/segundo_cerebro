import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import { EmptyState } from "@/components/ui/states";
import { CompromissosDeHoje } from "@/components/features/home/CompromissosDeHoje";
import { ResumoFinanceiro } from "@/components/features/home/ResumoFinanceiro";
import { TarefasDeHoje } from "@/components/features/home/TarefasDeHoje";
import { SocialLinkIcon } from "@/components/features/social/SocialLinkIcon";
import { HabitsTodayCard } from "@/components/features/habits/HabitsTodayCard";
import { somaMeses } from "@/lib/credit";
import { somarDias } from "@/lib/habits";
import {
  getAppContext,
  getCalendarAccounts,
  getCaptures,
  getCategories,
  getClickUpConnection,
  getEventsForToday,
  getFinanceSnapshot,
  getHabitEntries,
  getHabitPauses,
  getHabits,
  getSocialLinks,
  getTasks,
} from "@/lib/data";
import type { SocialLink } from "@/lib/database.types";
import {
  formatDateLong,
  formatDayLabel,
  formatTime,
  greeting,
  plural,
  dayRangeInTimeZone,
} from "@/lib/utils";

/**
 * O INÍCIO — o panorama de tudo que importa hoje.
 *
 * A regra que organiza esta página inteira: NADA AQUI ESPERA POR REDE EXTERNA.
 * Ela é a primeira tela que abre, e cada serviço de terceiro que entrasse no
 * `Promise.all` abaixo viraria um jeito de o aplicativo inteiro ficar lento por
 * culpa de outra empresa. O que vem de fora (as tarefas do ClickUp) é buscado
 * pelo navegador DEPOIS de a tela existir — ver `TarefasDeHoje`.
 */
export default async function HomePage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");

  // Os links entram DENTRO deste Promise.all, e não num `await` separado
  // depois: a leitura não depende de nenhuma das outras, então esperá-la em
  // série acrescentaria uma ida e volta HTTP inteira ao caminho crítico da
  // página mais visitada do aplicativo — para trazer, no máximo, oito linhas.
  /*
    ⚠️ HÁBITOS ENTRA AQUI, E NÃO NUM `await` DEPOIS.

    Sem marcação rápida no Início, o módulo existe e não entra na rotina: esta
    é a tela que abre primeiro, e um hábito que exige navegar para outra página
    é um hábito que se esquece.

    As leituras vão condicionadas ao módulo estar ligado — ver `mostrarHabitos`.
    Ler assim mesmo com o módulo desligado seriam três consultas para desenhar
    nada.
  */
  const mostrarHabitos = ctx.enabledModules.has("habitos");
  const mostrarFinanceiro = ctx.enabledModules.has("financeiro");

  /*
    O DIA É O DIA CIVIL DE SÃO PAULO, e não a meia-noite do relógio do servidor.

    `startOfDay(new Date())` devolvia a meia-noite do fuso onde o processo roda —
    em produção, quase sempre UTC. Às 21h de São Paulo isso já é o dia seguinte:
    a tarefa de amanhã cedo apareceria como "hoje" e a de hoje à noite sumiria da
    lista. `dayRangeInTimeZone` é a mesma fronteira que `getEventsForToday` usa
    para recortar a agenda, então tarefas e compromissos passam a concordar sobre
    onde o dia começa.

    `endIso` é o começo do dia SEGUINTE (limite exclusivo) — daí as comparações
    com `<`, nunca `<=`.
  */
  const { dayKey: hojeCivil, startIso, endIso } = dayRangeInTimeZone(new Date(), "America/Sao_Paulo");
  const inicioDeHoje = new Date(startIso).getTime();
  const fimDeHoje = new Date(endIso).getTime();
  const inicioDosHabitos = somarDias(hojeCivil, -29);
  // "2026-08-14" -> "2026-08-01", o mês canônico do módulo Financeiro. Derivado
  // do dia civil pelo mesmo motivo acima: `monthKey(new Date())` viraria o mês
  // no fuso do servidor, e no dia 1º isso muda o mês inteiro do resumo.
  const mesAtual = `${hojeCivil.slice(0, 7)}-01`;

  const [
    tasks,
    captures,
    categories,
    accounts,
    events,
    socialLinks,
    habitos,
    marcacoes,
    pausas,
    clickup,
    financeiro,
    financeiroM2,
    financeiroM4,
  ] = await Promise.all([
    getTasks(),
    // ⚠️ NÃO REMOVER junto com o antigo bloco "Memória rápida": esta leitura
    // também alimenta o número "Capturas s/ organizar" do Resumo do cérebro,
    // lá embaixo. Tirá-la daqui zeraria um indicador em silêncio.
    getCaptures(),
    getCategories(),
    getCalendarAccounts(),
    getEventsForToday(),
    getSocialLinks(),
    mostrarHabitos ? getHabits() : Promise.resolve([]),
    mostrarHabitos ? getHabitEntries(inicioDosHabitos) : Promise.resolve([]),
    mostrarHabitos ? getHabitPauses(inicioDosHabitos) : Promise.resolve([]),
    // Consulta LOCAL de uma linha (ver `getClickUpConnection`), NUNCA a API do
    // ClickUp: aqui ela só responde "vale a pena o navegador tentar buscar?".
    getClickUpConnection(),
    /*
      ⚠️ TRÊS SNAPSHOTS, E A RAZÃO É CHATA MAS HONESTA.

      `getFinanceSnapshot(M)` traz o mês M e o anterior — é o recorte que o
      módulo Financeiro precisa, e ele não tem parâmetro de janela. O
      mini-histórico do resumo quer SEIS meses, então são três chamadas
      (M, M-2, M-4) que cobrem M-5..M sem sobreposição.

      O custo é real: cada chamada relê contas, categorias, etiquetas e
      orçamentos, que só são usados uma vez. Elas vão no mesmo `Promise.all`,
      em paralelo, e ficam atrás de `mostrarFinanceiro` — com o módulo
      desligado o custo é zero. Ainda assim, o certo seria uma leitura
      dedicada em `lib/data.ts` (algo como `getFinanceHistory(mes, 6)`,
      devolvendo só `occurred_on`, `kind` e `amount_cents`), e ela não foi
      escrita aqui porque `data.ts` não pertence a esta mudança.
    */
    mostrarFinanceiro ? getFinanceSnapshot(mesAtual) : Promise.resolve(null),
    mostrarFinanceiro ? getFinanceSnapshot(somaMeses(mesAtual, -2)) : Promise.resolve(null),
    mostrarFinanceiro ? getFinanceSnapshot(somaMeses(mesAtual, -4)) : Promise.resolve(null),
  ]);

  const now = new Date();
  const agora = now.getTime();

  const pending = tasks.filter((t) => t.status !== "done");
  // Tudo que vence até o fim de hoje, atrasadas incluídas. O recorte é do
  // servidor; a fusão com o ClickUp e a ordenação são de `TarefasDeHoje`.
  const tarefasDeHoje = tasks.filter((t) => {
    const when = t.due_at ?? t.scheduled_start_at;
    if (!when) return false;
    return new Date(when).getTime() < fimDeHoje;
  });
  const nextMove = pending.find((t) => {
    const when = t.due_at ?? t.scheduled_start_at;
    return when != null;
  }) ?? pending[0];

  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const openCount = tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  /*
    "COMPROMISSOS", E NÃO "REUNIÕES".

    A agenda guarda consulta médica, aniversário, viagem, bloqueio de foco e o
    feriado importado do calendário nacional. Chamar tudo isso de reunião faz o
    aplicativo afirmar uma coisa errada sobre o dia da pessoa — e, no plural, o
    número vira "você tem 4 reuniões hoje" num dia em que não há nenhuma.
  */
  const compromissosHoje = events.length;

  const transacoesAnteriores = [
    ...(financeiroM4?.transactions ?? []),
    ...(financeiroM2?.transactions ?? []),
  ];

  return (
    <>
      <PageHeader
        eyebrow={formatDateLong(now).toUpperCase()}
        title={`${greeting(now)}, ${ctx.displayName}.`}
        subtitle="Tudo que importa, em um só lugar."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-legenda text-ink-subtle">
          {plural(openCount, "tarefa aberta", "tarefas abertas")}
          {" · "}
          {/* "hoje", não "à frente": o número agora conta o dia, não o futuro. */}
          {plural(compromissosHoje, "compromisso hoje", "compromissos hoje")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Seu próximo movimento */}
          <section>
            <div className="mb-3">
              <p className="eyebrow">Agora</p>
              <h2 className="text-titulo font-semibold text-ink">Seu próximo movimento</h2>
            </div>

            {/*
              O selo "Hoje · N" saiu daqui. Ele contava só as tarefas LOCAIS, e
              logo abaixo passou a existir uma lista que mistura as locais com as
              do ClickUp: dois números de "hoje" na mesma tela, discordando um do
              outro, e nenhum dos dois dizendo qual é qual. Quem conta hoje agora
              é a própria lista.
            */}

            {nextMove ? (
              /* `shadow-raised`: este painel é o elemento mais importante da
                 tela inicial — é a única coisa que responde "o que eu faço
                 agora?" — e era o ÚNICO bloco da página sem sombra nenhuma,
                 enquanto os cartões secundários ao redor tinham `shadow-subtle`.
                 A inversão de cor já dava contraste; faltava a elevação dizer
                 que ele está num plano acima e não ao lado. Uma classe, nenhuma
                 mudança de medida, nada reposicionado. */
              <div className="rounded-lg bg-accent p-6 text-accent-ink shadow-raised">
                <p className="mb-6 text-meta uppercase tracking-widest opacity-70">Em foco</p>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <h3 className="text-corpo-forte font-semibold">{nextMove.title}</h3>
                    <p className="mt-1 text-corpo opacity-70">
                      {nextMove.category_id ? catById.get(nextMove.category_id) : "Sem categoria"}
                      {" · "}
                      {nextMove.due_at
                        ? `vence ${formatDayLabel(nextMove.due_at)} ${formatTime(nextMove.due_at)}`
                        : "sem prazo"}
                    </p>
                  </div>
                  <Link
                    href="/tarefas"
                    className="flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink"
                    aria-label="Abrir tarefa"
                  >
                    <Icon.Play width={18} height={18} />
                  </Link>
                </div>
              </div>
            ) : (
              <Card>
                <EmptyState
                  icon="Check"
                  title="Nada pendente agora"
                  description="Você está em ordem. Aproveite ou capture uma nova ideia."
                />
              </Card>
            )}
          </section>

          {/*
            As tarefas locais vão prontas; o ClickUp é buscado pelo navegador
            depois de montar. Ver o cabeçalho de `TarefasDeHoje` para o porquê de
            a chamada externa não poder morar no `Promise.all` acima.
          */}
          <TarefasDeHoje
            tarefas={tarefasDeHoje}
            categorias={categories}
            clickupAtivo={clickup?.ativo === true}
            agora={agora}
            inicioDeHoje={inicioDeHoje}
            fimDeHoje={fimDeHoje}
          />

          {/* O módulo desligado não desenha nada — mesma regra do cartão de
              hábitos: o interruptor de Configurações não pode mentir. */}
          {mostrarFinanceiro && financeiro && (
            <ResumoFinanceiro
              mes={mesAtual}
              hojeIso={hojeCivil}
              snapshot={financeiro}
              transacoesAnteriores={transacoesAnteriores}
              ocultarValores={ctx.preferences?.finance_hide_values ?? false}
            />
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/*
            Agenda de HOJE, não "os próximos 5 eventos".
            Antes o bloco chamava `getUpcomingEvents(5)`, que devolve os próximos
            eventos a partir de agora sem recorte de dia — numa terça sem
            compromissos ele exibia o compromisso de quinta sob o título
            "Próximos eventos", e a pessoa lia aquilo como a agenda do dia. O
            recorte agora é o dia civil de São Paulo (ver `getEventsForToday`), e
            um dia vazio aparece vazio em vez de tomar emprestado o dia seguinte.
          */}
          <Card className="p-6">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="eyebrow">Agenda</p>
                <p className="text-corpo-forte font-semibold text-ink">Compromissos marcados hoje</p>
              </div>
              <Link href="/calendario" className="shrink-0 text-corpo text-ink-muted hover:text-ink">
                Ver tudo
              </Link>
            </div>
            <CompromissosDeHoje eventos={events} contas={accounts} agora={agora} />
          </Card>

          {/*
            ⚠️ O `mostrarHabitos` é a terceira edição, e é a que costuma ser
            esquecida: sem ela, desligar o módulo tira o link da barra lateral e
            o cartão continua na tela inicial — o interruptor passaria a mentir.
          */}
          {mostrarHabitos && (
            <HabitsTodayCard
              habitos={habitos}
              marcacoes={marcacoes}
              pausas={pausas}
              hoje={hojeCivil}
            />
          )}

          {/* Resumo do cérebro */}
          <Card className="p-6">
            <p className="eyebrow mb-3">Resumo do cérebro</p>
            {/* `grid-cols-1 sm:grid-cols-2`: sem o prefixo, duas colunas de ~150px
                no celular espremiam "Capturas s/ organizar" em três linhas ao lado
                de um número de dois dígitos. Empilhado até `sm`, cada indicador
                ocupa a largura toda e o rótulo cabe numa linha. */}
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Stat label="Tarefas abertas" value={openCount} />
              <Stat label="Concluídas" value={doneCount} />
              <Stat label="Capturas s/ organizar" value={captures.length} />
              <Stat label="Compromissos hoje" value={compromissosHoje} />
            </dl>
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-legenda text-ink-subtle">
                <span>Organização de hoje</span>
                <span>{ctx.organized.percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${ctx.organized.percent}%` }}
                />
              </div>
            </div>
          </Card>
        </div>
      </div>

      <SocialLinksStrip links={socialLinks} />
    </>
  );
}

/**
 * Bloco discreto de links do perfil, no fim da página.
 *
 * SOME QUANDO NÃO HÁ LINKS — `return null` antes de qualquer marcação. Não é
 * economia de pixels: um título "Meus links" com uma faixa vazia embaixo é uma
 * seção que promete conteúdo e não entrega, e quem nunca vai usar o recurso
 * ficaria com ela na tela para sempre.
 *
 * SEGURANÇA DE CADA `<a>` — os dois atributos, sempre, e são coisas diferentes:
 *
 *   - `target="_blank"` abre em outra aba (o destino é externo; levar a pessoa
 *     para fora do aplicativo perderia o estado da tela).
 *   - `rel="noopener noreferrer"` é a BARREIRA 3 das três do recurso. Sem
 *     `noopener`, a página aberta recebe `window.opener` apontando para ESTA
 *     aba e pode trocar o conteúdo dela por uma tela falsa de login enquanto a
 *     pessoa lê o outro site — tabnabbing. A vítima volta para a aba que ela
 *     mesma abriu, reconhece o layout e digita a senha. `noreferrer` completa:
 *     impede que o destino descubra de qual página o clique veio.
 *
 * As barreiras 1 e 2 (urlSegura e o CHECK da 0012) impedem um esquema perigoso
 * de entrar no banco; esta aqui protege de um destino https legítimo que se
 * comporta mal. Nenhuma substitui a outra.
 *
 * NOME ACESSÍVEL: o texto visível é o rótulo, e o ícone é `aria-hidden`. Um link
 * só com ícone é anunciado como "link" e nada mais — a lista inteira viraria
 * "link, link, link" para quem usa leitor de tela. O `sr-only` acrescenta "abre
 * em nova aba", que é a informação que o `target="_blank"` esconde de quem não
 * vê a aba nova aparecer.
 */
function SocialLinksStrip({ links }: { links: SocialLink[] }) {
  if (links.length === 0) return null;

  return (
    <section aria-labelledby="links-do-perfil" className="mt-10 border-t border-line pt-5">
      <h2 id="links-do-perfil" className="eyebrow mb-3">
        Meus links
      </h2>
      <ul className="flex flex-wrap gap-2">
        {links.map((l) => (
          <li key={l.id}>
            <a
              href={l.url}
              target="_blank"
              rel="noopener noreferrer"
              className="alvo-44 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-legenda text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-muted hover:text-ink"
            >
              <SocialLinkIcon url={l.url} size={15} className="shrink-0 text-ink-subtle" />
              {l.label}
              <span className="sr-only">(abre em nova aba)</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted px-3 py-2.5">
      <dd className="text-titulo font-semibold text-ink">{value}</dd>
      <dt className="text-legenda text-ink-subtle">{label}</dt>
    </div>
  );
}
