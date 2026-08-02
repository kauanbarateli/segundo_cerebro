import { PageHeader } from "@/components/layout/PageHeader";
import { DriveView } from "@/components/features/drive/DriveView";
import { getDriveListing } from "@/lib/data";
import { requireModule } from "@/lib/guards";

export default async function DrivePage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>;
}) {
  const ctx = await requireModule("drive");
  const sp = await searchParams;

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const folderId = sp.folder && uuidRe.test(sp.folder) ? sp.folder : null;

  const listing = await getDriveListing(folderId);

  return (
    <>
      <PageHeader
        eyebrow="Arquivos"
        title="Tudo guardado no lugar."
        subtitle="Envie, organize em pastas e encontre quando precisar."
        user={{ name: ctx.displayName, avatarUrl: ctx.avatarUrl }}
      />
      <DriveView
        folderId={folderId}
        folders={listing.folders}
        files={listing.files}
        breadcrumb={listing.breadcrumb}
        allFolders={listing.allFolders}
        usage={listing.usage}
      />
    </>
  );
}
