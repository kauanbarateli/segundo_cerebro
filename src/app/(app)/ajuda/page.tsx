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
          <div key={s.keys} className="flex items-center justify-between px-5 py-3.5">
            <span className="text-sm font-medium text-ink">{s.keys}</span>
            <span className="text-corpo text-ink-subtle">{s.desc}</span>
          </div>
        ))}
      </Card>
    </>
  );
}
