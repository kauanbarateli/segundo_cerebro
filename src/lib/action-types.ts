/** Shared result/payload types for server actions. Kept out of "use server"
 * files, which may only export async functions. */

export type ActionResult = { ok: boolean; error?: string; id?: string };

export type CaptureResult = { ok: boolean; error?: string; id?: string };

export type AuthState = { error: string | null };

/**
 * Retorno de `updatePageContent` (módulo Conhecimento).
 *
 * É `ActionResult` mais dois campos, e os dois são exigidos pelo autosave:
 *
 *   `updatedAt` — o carimbo NOVO da linha. Sem devolvê-lo, o cliente
 *   continuaria segurando o carimbo antigo e o PRÓXIMO salvamento bateria no
 *   `.eq("updated_at", ...)` do próprio salvamento anterior: conflito falso a
 *   cada duas digitações. Devolver aqui evita também um refetch por
 *   salvamento só para redescobrir o valor.
 *
 *   `conflict` — separa "não deu para salvar" de "alguém salvou antes de você".
 *   A interface trata os dois de formas opostas: erro genérico pede nova
 *   tentativa; conflito NÃO pode ser retentado automaticamente, senão a
 *   retentativa apagaria a versão do outro lugar. Nesse caso `updatedAt` traz o
 *   carimbo que está no banco agora, para a tela poder oferecer "recarregar".
 */
export type KnowledgePageSaveResult = {
  ok: boolean;
  error?: string;
  id?: string;
  updatedAt?: string;
  conflict?: boolean;
};

export interface VaultStatePayload {
  hasMasterKey: boolean;
  master: {
    wrappedDataKeyB64: string;
    wrapIvB64: string;
    kdfSaltB64: string;
    kdfAlgorithm: "argon2id";
    kdfParameters: Record<string, unknown>;
    cryptoVersion: number;
  } | null;
  items: {
    id: string;
    itemType: string;
    ciphertextB64: string;
    ivB64: string;
    favorite: boolean;
    updatedAt: string;
  }[];
}
