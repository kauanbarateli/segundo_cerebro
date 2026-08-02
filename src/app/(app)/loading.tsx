import { LoadingSkeleton } from "@/components/ui/states";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="h-16 w-64 animate-pulse rounded-md bg-surface-muted" />
      <LoadingSkeleton rows={5} />
    </div>
  );
}
