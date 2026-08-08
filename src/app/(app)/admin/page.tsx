import { PageHeader } from "@/components/layout/PageHeader";
import { AdminView } from "@/components/features/admin/AdminView";
import { requireMasterPage } from "@/lib/guards";
import { listarUsuarios } from "@/app/(app)/admin/actions";

/**
 * A área administrativa.
 *
 * ⚠️ `requireMasterPage()` aqui MESMO com o layout já chamando. Não é
 * redundância inútil: o layout garante que a rota não abre para quem não deve,
 * e esta chamada é o que traz o `ctx` para montar o cabeçalho. Como
 * `getAppContext()` é memoizada por passe de render (ver `cache()` em data.ts),
 * as duas chamadas custam uma só ida ao banco.
 */
export default async function AdminPage() {
  const ctx = await requireMasterPage();
  const resultado = await listarUsuarios();

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Quem tem acesso."
        subtitle="Contas, papéis e bloqueio. Conteúdo de ninguém aparece aqui."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <AdminView
        usuarios={resultado.ok ? resultado.usuarios : []}
        erro={resultado.ok ? null : resultado.error}
        euId={ctx.userId}
      />
    </>
  );
}
