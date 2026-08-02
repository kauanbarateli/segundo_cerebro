import { PageHeader } from "@/components/layout/PageHeader";
import { VaultClient } from "@/components/features/vault/VaultClient";
import { requireModule } from "@/lib/guards";
import { getVaultState } from "@/app/(app)/cofre/actions";

export default async function CofrePage() {
  const ctx = await requireModule("cofre");
  const initial = await getVaultState();

  return (
    <>
      <PageHeader
        eyebrow="Cofre pessoal"
        title="O essencial, protegido."
        subtitle="Uma referência segura para contas, acessos e documentos importantes."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <VaultClient initial={initial} />
    </>
  );
}
