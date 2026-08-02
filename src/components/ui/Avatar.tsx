/* eslint-disable @next/next/no-img-element */
import { cn } from "@/lib/utils";

/**
 * Foto de perfil com fallback para a inicial do nome.
 *
 * Usa <img> em vez de next/image de propósito: a URL é assinada pelo Supabase
 * Storage e expira em ~1 h, então o otimizador do Next (que cacheia por URL)
 * não traz ganho e ainda exigiria configurar `remotePatterns` para um host
 * que muda conforme o projeto.
 */
export function Avatar({
  name,
  url,
  size = 40,
  rounded = "full",
  className,
}: {
  name: string;
  url?: string | null;
  size?: number;
  /**
   * `full` para o menu de conta; `md` quando o avatar ocupa o lugar da marca na
   * barra lateral — ali ele lê como logotipo, e canto arredondado combina com o
   * resto dos blocos da interface.
   */
  rounded?: "full" | "md";
  className?: string;
}) {
  const initial = (name?.trim()?.[0] ?? "?").toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden border border-line-strong bg-surface font-semibold text-ink",
        rounded === "full" ? "rounded-full" : "rounded-md",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.34)) }}
    >
      {url ? (
        <img
          src={url}
          alt={`Foto de ${name}`}
          width={size}
          height={size}
          className="h-full w-full object-cover"
        />
      ) : (
        <span aria-hidden>{initial}</span>
      )}
      {!url && <span className="sr-only">{name}</span>}
    </span>
  );
}
