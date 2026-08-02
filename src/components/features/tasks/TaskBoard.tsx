"use client";

import { useMemo, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Badge } from "@/components/ui/Badge";
import { LinkCountBadge } from "@/components/features/links/LinkCountBadge";
import { useToast } from "@/components/ui/Toast";
import { moveTask } from "@/app/(app)/tarefas/actions";
import type { Category, Task, TaskStatus, TaskPriority } from "@/lib/database.types";
import type { RelatedItem } from "@/lib/links";
import { cn, formatDayLabel } from "@/lib/utils";

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: "todo", label: "A fazer" },
  { status: "in_progress", label: "Em andamento" },
  { status: "done", label: "Concluído" },
];

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  urgent: "Urgente",
};

export function TaskBoard({
  tasks,
  categories,
  related,
}: {
  tasks: Task[];
  categories: Category[];
  /** Mesmo Map da lista: o quadro é outra visão das mesmas tarefas. */
  related: Map<string, RelatedItem[]>;
}) {
  const { toast } = useToast();
  const [, start] = useTransition();
  const [activeId, setActiveId] = useState<string | null>(null);
  // Cópia local para atualização otimista — mover o card na hora e reverter se
  // o servidor recusar é bem melhor que esperar o round-trip.
  const [items, setItems] = useState<Task[]>(tasks);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);

  // O KeyboardSensor é o que mantém o quadro utilizável sem mouse.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const byColumn = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const col of COLUMNS) map.set(col.status, []);
    for (const t of items) {
      if (t.status === "archived") continue;
      map.get(t.status)?.push(t);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.board_position ?? 0) - (b.board_position ?? 0));
    }
    return map;
  }, [items]);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const activeTask = items.find((t) => t.id === active.id);
    if (!activeTask) return;

    // O alvo pode ser outro card ou a coluna vazia.
    const overId = String(over.id);
    const overTask = items.find((t) => t.id === overId);
    const targetStatus: TaskStatus = overTask
      ? overTask.status
      : (COLUMNS.find((c) => c.status === overId)?.status ?? activeTask.status);

    const column = (byColumn.get(targetStatus) ?? []).filter((t) => t.id !== activeTask.id);
    const overIndex = overTask ? column.findIndex((t) => t.id === overTask.id) : column.length;
    const insertAt = overIndex < 0 ? column.length : overIndex;

    const before = insertAt > 0 ? column[insertAt - 1] : null;
    const after = column[insertAt] ?? null;

    if (
      activeTask.status === targetStatus &&
      before?.id === activeTask.id &&
      after?.id === activeTask.id
    ) {
      return;
    }

    const previous = items;
    const prevPos = before?.board_position ?? null;
    const nextPos = after?.board_position ?? null;
    const optimisticPos =
      prevPos != null && nextPos != null
        ? (prevPos + nextPos) / 2
        : prevPos != null
          ? prevPos + 1
          : nextPos != null
            ? nextPos - 1
            : 1;

    setItems((list) =>
      list.map((t) =>
        t.id === activeTask.id
          ? { ...t, status: targetStatus, board_position: optimisticPos }
          : t,
      ),
    );

    start(async () => {
      const r = await moveTask(activeTask.id, targetStatus, before?.id ?? null, after?.id ?? null);
      if (!r.ok) {
        setItems(previous);
        toast(r.error ?? "Não foi possível mover", "error");
      }
    });
  }

  const activeTask = items.find((t) => t.id === activeId) ?? null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((col) => {
          const columnTasks = byColumn.get(col.status) ?? [];
          return (
            <Column
              key={col.status}
              id={col.status}
              label={col.label}
              count={columnTasks.length}
            >
              <SortableContext
                items={columnTasks.map((t) => t.id)}
                strategy={verticalListSortingStrategy}
              >
                {columnTasks.map((t) => (
                  <SortableCard
                    key={t.id}
                    task={t}
                    categoryName={t.category_id ? catById.get(t.category_id) : undefined}
                    linkCount={related.get(t.id)?.length ?? 0}
                  />
                ))}
              </SortableContext>
              {columnTasks.length === 0 && (
                <p className="rounded-md border border-dashed border-line py-6 text-center text-legenda text-ink-subtle">
                  Solte um card aqui
                </p>
              )}
            </Column>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <CardShell
            task={activeTask}
            categoryName={
              activeTask.category_id ? catById.get(activeTask.category_id) : undefined
            }
            linkCount={related.get(activeTask.id)?.length ?? 0}
            dragging
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useSortable({ id, data: { isColumn: true } });
  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-[200px] flex-col gap-2 rounded-lg border border-line bg-surface-muted p-3 transition-colors",
        isOver && "border-line-strong bg-surface",
      )}
    >
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-corpo font-semibold text-ink">{label}</h3>
        <Badge>{count}</Badge>
      </div>
      {children}
    </section>
  );
}

function SortableCard({
  task,
  categoryName,
  linkCount,
}: {
  task: Task;
  categoryName?: string;
  linkCount: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <CardShell task={task} categoryName={categoryName} linkCount={linkCount} />
    </div>
  );
}

function CardShell({
  task,
  categoryName,
  linkCount,
  dragging,
}: {
  task: Task;
  categoryName?: string;
  linkCount: number;
  dragging?: boolean;
}) {
  const when = task.due_at ?? task.scheduled_start_at;
  return (
    <article
      className={cn(
        "cursor-grab rounded-md border border-line bg-surface p-3 shadow-subtle active:cursor-grabbing",
        dragging && "shadow-raised",
      )}
    >
      <p
        className={cn(
          "text-corpo font-medium",
          task.status === "done" ? "text-ink-subtle line-through" : "text-ink",
        )}
      >
        {task.title}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {categoryName && <Badge tone="outline">{categoryName}</Badge>}
        <Badge tone={task.priority === "high" || task.priority === "urgent" ? "solid" : "default"}>
          {PRIORITY_LABEL[task.priority]}
        </Badge>
        {when && <span className="text-meta text-ink-subtle">{formatDayLabel(when)}</span>}
        <LinkCountBadge count={linkCount} />
      </div>
    </article>
  );
}
