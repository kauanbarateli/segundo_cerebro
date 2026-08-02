import { PageHeader } from "@/components/layout/PageHeader";
import { TrashView } from "@/components/features/drive/TrashView";
import { getDriveTrash } from "@/lib/data";
import { requireModule } from "@/lib/guards";

export default async function LixeiraPage() {
  const ctx = await requireModule("drive");
  const files = await getDriveTrash();

  return (
    <>
      <PageHeader
        eyebrow="Drive"
        title="Lixeira."
        subtitle="Restaure ou apague definitivamente."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <TrashView files={files} />
    </>
  );
}
