import { redirect } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { getAppContext } from "@/lib/data";

const SHORTCUTS = [
  { keys: "Capturar", desc: "Botão no cabeçalho ou item Capturar no menu" },
  { keys: "Bloquear cofre", desc: "Botão Bloquear dentro do Cofre" },
  { keys: "Tema", desc: "Alterna claro/escuro pelo ícone no cabeçalho" },
];

export default async function AjudaPage() {
  const ctx = await getAppContext();
  if (!ctx) redirect("/login");

  return (
    <>
      <PageHeader
        eyebrow="Suporte"
        title="Ajuda e atalhos."
        subtitle="O básico para usar o Segundo Cérebro."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <Card className="max-w-lg divide-y divide-line">
        {SHORTCUTS.map((s) => (
          /* Empilha no celular. Lado a lado, o rótulo ficava com ~95px e a
             descrição ("Botão no cabeçalho ou item Capturar no menu") tinha de
             se espremer em três linhas nos 200px restantes — a tabela de duas
             colunas só funciona quando há duas colunas de espaço. */
          <div
            key={s.keys}
            className="flex flex-col gap-0.5 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
          >
            <span className="text-sm font-medium text-ink">{s.keys}</span>
            <span className="text-corpo text-ink-subtle sm:text-right">{s.desc}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
