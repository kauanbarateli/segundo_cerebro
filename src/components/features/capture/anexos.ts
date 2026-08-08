"use client";

import {
  TAMANHO_MAXIMO_BYTES,
  TIPOS_ACEITOS,
  type TipoDeImagem,
  extensaoDe,
  tipoAceito,
} from "@/lib/imagem";

/**
 * PREPARO E ENVIO DAS IMAGENS DA CAPTURA — lado do navegador.
 *
 * ⚠️ NADA AQUI É BARREIRA DE SEGURANÇA. Toda checagem deste arquivo existe para
 * dar resposta IMEDIATA a quem está usando ("esse arquivo não serve") e para
 * evitar uma transferência que seria recusada depois. A barreira de verdade está
 * em `anexarImagemACaptura`, no servidor, que baixa os bytes e olha a assinatura
 * real do arquivo — porque server action é endpoint HTTP e não tem como confiar
 * em nada que tenha passado por aqui.
 */

/** Uma imagem escolhida e ainda não enviada. */
export interface AnexoPendente {
  /** Só para o React. Nada a ver com o id do arquivo no banco. */
  id: string;
  /** Já reencodado — ver `prepararImagem`. */
  blob: Blob;
  tipo: TipoDeImagem;
  /** `URL.createObjectURL`, para a miniatura. Precisa ser revogado. */
  previa: string;
  bytes: number;
}

/** O `accept` do seletor de arquivo. Mesma allowlist do resto. */
export const ACCEPT_DE_IMAGEM = TIPOS_ACEITOS.join(",");

/**
 * Reencoda a imagem — e é isso que APAGA OS METADADOS.
 *
 * ===========================================================================
 * ⚠️ O PROBLEMA DO EXIF, QUE NÃO É ÓBVIO
 * ===========================================================================
 * Uma foto tirada de celular carrega um bloco EXIF com marca do aparelho,
 * número de série da lente, data e hora exata — e, quando a localização está
 * ligada, as COORDENADAS GPS de onde ela foi tirada. Anexar a foto de um recibo
 * a uma captura anexaria junto o endereço de onde a pessoa estava.
 *
 * Desenhar num `<canvas>` e reexportar resolve pela raiz: o canvas guarda só os
 * PIXELS. O que sai é uma imagem nova, sem metadado nenhum — não há lista de
 * campos a remover, e portanto não há campo esquecido.
 *
 * De quebra, dois efeitos que valem sozinhos:
 *   - GIF ANIMADO vira quadro único. É perda real, e aceita: a alternativa
 *     seria deixar passar sem reencodar, e aí um "GIF" poderia ser qualquer
 *     coisa com os bytes certos no começo.
 *   - o tamanho costuma cair bastante, porque a maioria dos prints e fotos vem
 *     com muito mais dados do que a tela precisa.
 *
 * ⚠️ O canvas também é o que torna SVG impossível de passar por aqui: um SVG
 * carregado e redesenhado sai como PNG rasterizado, sem script nenhum. Mas o
 * `<img>` recusa carregar um SVG hostil de qualquer forma, e o servidor barra
 * pela assinatura — este é o terceiro anteparo, não o primeiro.
 */
async function prepararImagem(arquivo: File): Promise<{ blob: Blob; tipo: TipoDeImagem } | null> {
  if (!tipoAceito(arquivo.type)) return null;

  /*
    PNG continua PNG e o resto vira JPEG. A distinção não é estética: PNG é sem
    perda e é o formato de print de tela, onde texto fino vira borrão ao passar
    por JPEG. Foto, ao contrário, fica muitas vezes menor em JPEG sem diferença
    visível.
  */
  const destino: TipoDeImagem = arquivo.type === "image/png" ? "image/png" : "image/jpeg";

  const url = URL.createObjectURL(arquivo);
  try {
    const img = await carregarImagem(url);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      // 0.9 é o ponto em que o JPEG deixa de mostrar artefato visível na
      // maioria das fotos; acima disso o arquivo cresce sem ganho perceptível.
      canvas.toBlob(resolve, destino, 0.9),
    );

    return blob ? { blob, tipo: destino } : null;
  } catch {
    // Arquivo corrompido, ou que o navegador não decodifica. Recusar é a
    // resposta certa — não há versão útil dele para enviar.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("imagem ilegível"));
    img.src = url;
  });
}

/** O que aconteceu com um arquivo que a pessoa tentou anexar. */
export type ResultadoDoPreparo =
  | { ok: true; anexo: AnexoPendente }
  | { ok: false; motivo: "tipo" | "tamanho" | "ilegivel" };

/**
 * Prepara UM arquivo para virar anexo.
 *
 * O teto de tamanho é conferido DEPOIS do reencode, e não antes: o reencode
 * costuma reduzir bastante, e recusar uma foto de 10 MB que viraria 1,2 MB seria
 * recusar por um número que nem é o final.
 */
export async function prepararAnexo(arquivo: File): Promise<ResultadoDoPreparo> {
  if (!tipoAceito(arquivo.type)) return { ok: false, motivo: "tipo" };

  const preparado = await prepararImagem(arquivo);
  if (!preparado) return { ok: false, motivo: "ilegivel" };

  if (preparado.blob.size > TAMANHO_MAXIMO_BYTES) return { ok: false, motivo: "tamanho" };

  return {
    ok: true,
    anexo: {
      id: crypto.randomUUID(),
      blob: preparado.blob,
      tipo: preparado.tipo,
      previa: URL.createObjectURL(preparado.blob),
      bytes: preparado.blob.size,
    },
  };
}

/**
 * Envia os bytes ao Storage e devolve o caminho.
 *
 * ⚠️ O caminho é `<user_id>/<uuid>` — NUNCA o nome do arquivo. É o formato que a
 * policy da 0007 exige (ela compara o primeiro segmento com `auth.uid()`), e é
 * também o que impede que um nome hostil vire caminho. O nome de exibição é
 * decidido pelo SERVIDOR, a partir do tipo real (ver `nomeDoAnexo`).
 *
 * Direto do navegador para o Storage, sem passar pelo Next: rota serverless tem
 * teto de corpo, e reenviar a imagem pelo servidor pagaria a transferência duas
 * vezes. É o mesmo caminho que o Drive já usa.
 */
export async function enviarAnexo(anexo: AnexoPendente): Promise<string | null> {
  /*
    ⚠️ `import()` DINÂMICO, e o número justifica: com o import estático, a tela
    de Captura saltou de 120 kB para 191 kB de First Load JS. O cliente do
    Supabase para navegador pesa ~70 kB e vinha inteiro no pacote inicial — para
    TODA visita, inclusive as milhares em que alguém só escreve uma linha de
    texto e sai.

    Anexar imagem é a exceção, não a regra, e o custo agora é pago por quem usa:
    o chunk é buscado no primeiro envio. A espera é irrelevante ao lado da
    própria transferência do arquivo, que acontece logo em seguida.
  */
  const { createClient } = await import("@/lib/supabase/client");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const caminho = `${user.id}/${crypto.randomUUID()}.${extensaoDe(anexo.tipo)}`;

  const { error } = await supabase.storage
    .from("drive")
    .upload(caminho, anexo.blob, { contentType: anexo.tipo });

  return error ? null : caminho;
}

/**
 * Extrai os arquivos de imagem de um evento de colar ou arrastar.
 *
 * `DataTransfer.files` e não `items`: colar um print põe o arquivo nos dois, mas
 * arrastar de uma pasta só preenche `files`. Ler os dois lugares traria o mesmo
 * arquivo duplicado no caso de colar.
 *
 * O filtro por tipo aqui evita o caso mais comum e mais confuso: colar TEXTO
 * copiado de um site traz também um `text/html` no clipboard, e sem o filtro
 * cada colagem de texto tentaria virar um anexo.
 */
export function imagensDe(dados: DataTransfer | null): File[] {
  if (!dados) return [];
  return Array.from(dados.files).filter((f) => f.type.startsWith("image/"));
}
