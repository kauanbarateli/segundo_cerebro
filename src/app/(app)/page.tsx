import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { Icon } from "@/components/ui/Icons";
import { EmptyState } from "@/components/ui/states";
import { TaskCheckbox } from "@/components/features/tasks/TasksView";
import { CalendarEventCard } from "@/components/features/calendar/CalendarEventCard";
import { SocialLinkIcon } from "@/components/features/social/SocialLinkIcon";
import { rotuloDaConta, tomDaConta } from "@/lib/calendar-colors";
import { HabitsTodayCard } from "@/components/features/habits/HabitsTodayCard";
import { somarDias } from "@/lib/habits";
import {
  getAppContext,
  getCalendarAccounts,
  getCaptures,
  getCategories,
  getEventsForToday,
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
  startOfDay,
  endOfDay,
  dayRangeInTimeZone,
  cn,
} from "@/lib/utils";
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
  const { dayKey: hojeCivil } = dayRangeInTimeZone(new Date(), "America/Sao_Paulo");
  const inicioDosHabitos = somarDias(hojeCivil, -29);

  const [tasks, captures, categories, accounts, events, socialLinks, habitos, marcacoes, pausas] =
    await Promise.all([
      getTasks(),
      getCaptures(),
      getCategories(),
      getCalendarAccounts(),
      getEventsForToday(),
      getSocialLinks(),
      mostrarHabitos ? getHabits() : Promise.resolve([]),
      mostrarHabitos ? getHabitEntries(inicioDosHabitos) : Promise.resolve([]),
      mostrarHabitos ? getHabitPauses(inicioDosHabitos) : Promise.resolve([]),
    ]);

  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const todayEnd = endOfDay(now).getTime();
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const pending = tasks.filter((t) => t.status !== "done");
  const todayTasks = tasks.filter((t) => {
    const when = t.due_at ?? t.scheduled_start_at;
    if (!when) return false;
    const ts = new Date(when).getTime();
    return ts <= todayEnd; // inclui atrasadas + hoje
  });
  const nextMove = pending.find((t) => {
    const when = t.due_at ?? t.scheduled_start_at;
    return when != null;
  }) ?? pending[0];

  const openCount = tasks.filter((t) => t.status === "todo" || t.status === "in_progress").length;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const meetingsCount = events.length;

  /**
   * Já terminou? Só para esmaecer — o evento continua na lista.
   *
   * Dia inteiro nunca "termina" no meio do dia: ele vale para o dia todo, então
   * esmaecê-lo às 14h seria dizer que o feriado acabou. Sem `end_at` (evento sem
   * duração declarada), o critério cai para o próprio início.
   */
  const jaTerminou = (ev: (typeof events)[number]): boolean => {
    if (ev.all_day) return false;
    const fim = ev.end_at ?? ev.start_at;
    return fim != null && new Date(fim).getTime() < now.getTime();
  };

  return (
    <>
      <PageHeader
        eyebrow={formatDateLong(now).toUpperCase()}
        title={`${greeting(now)}, ${ctx.displayName}.`}
        subtitle="Tudo que importa, em um só lugar."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-corpo text-ink-subtle">
          {plural(openCount, "tarefa aberta", "tarefas abertas")}
          {" · "}
          {/* "hoje", não "à frente": o número agora conta o dia, não o futuro. */}
          {plural(meetingsCount, "reunião hoje", "reuniões hoje")}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Left column */}
        <div className="space-y-6">
          {/* Seu próximo movimento */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow">Agora</p>
                <h2 className="text-lg font-semibold text-ink">Seu próximo movimento</h2>
              </div>
              <Badge>Hoje · {todayTasks.length}</Badge>
            </div>

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
                    <h3 className="text-xl font-semibold">{nextMove.title}</h3>
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

          {/* Tarefas de hoje */}
          <section>
            <h2 className="mb-3 text-lg font-semibold text-ink">Tarefas de hoje</h2>
            <Card className="divide-y divide-line">
              {todayTasks.length === 0 ? (
                <EmptyState icon="Tasks" title="Sem tarefas para hoje" />
              ) : (
                todayTasks.map((t) => {
                  const when = t.due_at ?? t.scheduled_start_at;
                  const overdue =
                    when != null && new Date(when).getTime() < todayStart && t.status !== "done";
                  return (
                    <div key={t.id} className="flex items-center gap-3 px-4 py-3.5">
                      <TaskCheckbox task={t} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm font-medium",
                            t.status === "done" ? "text-ink-subtle line-through" : "text-ink",
                          )}
                        >
                          {t.title}
                        </p>
                        <p className="text-legenda text-ink-subtle">
                          {when ? `${formatDayLabel(when)}${t.all_day ? "" : " · " + formatTime(when)}` : ""}
                          {overdue && <span className="ml-1 text-red-500">atrasada</span>}
                        </p>
                      </div>
                      {t.category_id && <Badge tone="outline">{catById.get(t.category_id)}</Badge>}
                    </div>
                  );
                })
              )}
            </Card>
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Memória rápida */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow">Memória rápida</p>
                <p className="text-sm font-semibold text-ink">O que está na sua cabeça?</p>
              </div>
            </div>
            <p className="mb-3 text-corpo text-ink-subtle">
              Escreva uma ideia, lembrete ou preocupação…
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "Ideia", type: "idea" },
                { label: "Tarefa", type: "task" },
                { label: "Nota", type: "note" },
                { label: "Lembrete", type: "reminder" },
              ].map((q) => (
                <Link
                  key={q.type}
                  href="/capturar"
                  className="rounded-full border border-line-strong px-3 py-1.5 text-corpo text-ink-muted hover:bg-surface-muted hover:text-ink"
                >
                  {q.label}
                </Link>
              ))}
            </div>
          </Card>

          {/*
            Agenda de HOJE, não "os próximos 5 eventos".
            Antes o bloco chamava `getUpcomingEvents(5)`, que devolve os próximos
            eventos a partir de agora sem recorte de dia — numa terça sem
            compromissos ele exibia a reunião de quinta sob o título "Próximos
            eventos", e a pessoa lia aquilo como a agenda do dia. O recorte agora
            é o dia civil de São Paulo (ver `getEventsForToday`), e um dia vazio
            aparece vazio em vez de tomar emprestado o dia seguinte.
          */}
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow">Agenda</p>
                <p className="text-sm font-semibold text-ink">Hoje</p>
              </div>
              <Link href="/calendario" className="text-corpo text-ink-muted hover:text-ink">
                Ver tudo
              </Link>
            </div>
            {events.length === 0 ? (
              <p className="py-4 text-center text-corpo text-ink-subtle">
                {accounts.length === 0
                  ? "Nenhum evento. Conecte uma conta no Calendário."
                  : "Sem eventos hoje."}
              </p>
            ) : (
              <div className="space-y-2">
                {events.map((ev) => {
                  const acc = accountById.get(ev.calendar_account_id);
                  return (
                    <CalendarEventCard
                      key={ev.id}
                      event={ev}
                      compact
                      ended={jaTerminou(ev)}
                      accountBadge={rotuloDaConta(acc)}
                      // O mesmo código de cores do Calendário. Sem isto, o
                      // Início seria a única tela em que as duas contas
                      // parecem a mesma coisa — e é a tela que se abre
                      // primeiro. Com uma conta só, `null` mantém o visual
                      // anterior; ver `tomDaConta`.
                      tom={accounts.length > 1 ? tomDaConta(acc?.slot) : null}
                    />
                  );
                })}
              </div>
            )}
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
          <Card className="p-5">
            <p className="eyebrow mb-3">Resumo do cérebro</p>
            <dl className="grid grid-cols-2 gap-3">
              <Stat label="Tarefas abertas" value={openCount} />
              <Stat label="Concluídas" value={doneCount} />
              <Stat label="Capturas s/ organizar" value={captures.length} />
              <Stat label="Reuniões hoje" value={meetingsCount} />
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
              className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-corpo text-ink-muted transition-colors hover:border-line-strong hover:bg-surface-muted hover:text-ink focus-visible:outline-2"
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
      <dd className="text-2xl font-semibold text-ink">{value}</dd>
      <dt className="text-legenda text-ink-subtle">{label}</dt>
    </div>
  );
}
