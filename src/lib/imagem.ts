/**
 * REGRAS DE IMAGEM ANEXADA — puras, sem I/O, testáveis.
 *
 * =============================================================================
 * ⚠️ POR QUE VALIDAR POR CONTEÚDO, E NUNCA POR EXTENSÃO OU POR `File.type`
 * =============================================================================
 * As duas informações que parecem dizer o tipo de um arquivo vêm de quem enviou:
 *
 *   - a EXTENSÃO é parte do nome, e o nome é texto livre;
 *   - `File.type` (e o `Content-Type` do upload) é declarado pelo cliente. O
 *     navegador o preenche a partir da extensão, e um cliente adulterado
 *     escreve o que quiser.
 *
 * Ou seja: "foto.png" com `image/png` declarado pode ser qualquer coisa. O que
 * não mente é o começo dos BYTES — todo formato de imagem real abre com uma
 * assinatura fixa. É isso que `sniffarImagem` lê.
 *
 * =============================================================================
 * ⚠️ SVG É BLOQUEADO, E NÃO É EXAGERO
 * =============================================================================
 * SVG não é uma imagem: é um DOCUMENTO XML que pode conter `<script>`. Servido
 * do mesmo domínio da aplicação, um SVG hostil executa JavaScript na origem em
 * que o Cofre está aberto — é XSS armazenado com cara de anexo. Não existe
 * "sanitizar SVG" confiável (as formas de embutir script são muitas e mudam),
 * e nenhum caso de uso desta funcionalidade — print, foto, recibo — é vetorial.
 *
 * Ele nem aparece na allowlist abaixo; este parágrafo existe para que a ausência
 * não seja lida como esquecimento e "corrigida" um dia.
 */

/** Os quatro formatos aceitos. Allowlist — o que não está aqui não entra. */
export const TIPOS_ACEITOS = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type TipoDeImagem = (typeof TIPOS_ACEITOS)[number];

/**
 * Teto por arquivo.
 *
 * 8 MB é folgado para print e foto de celular já reencodada (ver
 * `reencodar` no cliente), e bem abaixo dos 50 MB do bucket — o limite do
 * bucket protege o armazenamento, este protege a EXPERIÊNCIA: um anexo de 40 MB
 * numa captura trava a tela de quem for abri-la depois, no celular, no 4G.
 *
 * ⚠️ Validado NOS DOIS LADOS, e o do servidor é o que vale: o cliente checa para
 * dar mensagem imediata, e a action confere o tamanho REAL no Storage — o mesmo
 * cuidado que `registerFile` já tomava ao não confiar no `sizeBytes` enviado.
 */
export const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

/** Quantas imagens uma captura aceita. Ver `CaptureView` para o porquê. */
export const MAXIMO_DE_ANEXOS = 6;

/**
 * Assinaturas de arquivo ("magic numbers").
 *
 * `null` numa posição significa "qualquer byte" — o WebP precisa disso porque
 * os bytes 4–7 do contêiner RIFF são o TAMANHO do arquivo, que varia.
 */
const ASSINATURAS: { tipo: TipoDeImagem; bytes: (number | null)[] }[] = [
  // PNG: \x89PNG\r\n\x1a\n — a assinatura mais elaborada que existe, montada
  // para detectar corrupção de transferência.
  { tipo: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  // JPEG: sempre começa com SOI (Start Of Image) FF D8, seguido de um marcador.
  { tipo: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  // GIF: "GIF87a" ou "GIF89a" — os três primeiros bastam para o formato.
  { tipo: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  // WebP: contêiner RIFF — "RIFF" + 4 bytes de tamanho + "WEBP".
  {
    tipo: "image/webp",
    bytes: [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
  },
];

/** Quantos bytes bastam para decidir. O WebP é o mais longo, com 12. */
export const BYTES_PARA_SNIFAR = 12;

/**
 * Descobre o tipo REAL pelos primeiros bytes. `null` = não é imagem aceita.
 *
 * Um SVG cai aqui naturalmente: ele começa com "<?xml" ou "<svg", que não casa
 * com assinatura nenhuma. Não há caso especial para ele, e é o certo — a
 * allowlist recusa por não reconhecer, não por reconhecer-e-rejeitar.
 */
export function sniffarImagem(bytes: Uint8Array): TipoDeImagem | null {
  for (const { tipo, bytes: assinatura } of ASSINATURAS) {
    if (bytes.length < assinatura.length) continue;
    const casa = assinatura.every((b, i) => b === null || bytes[i] === b);
    if (casa) return tipo;
  }
  return null;
}

/** O tipo declarado está na allowlist? Barreira barata, feita ANTES do upload. */
export function tipoAceito(tipo: string | null | undefined): tipo is TipoDeImagem {
  return TIPOS_ACEITOS.includes(tipo as TipoDeImagem);
}

/** Extensão canônica a partir do tipo REAL — nunca a que o usuário mandou. */
export function extensaoDe(tipo: TipoDeImagem): string {
  return tipo === "image/jpeg" ? "jpg" : tipo.slice("image/".length);
}

/**
 * O nome de exibição do anexo.
 *
 * ⚠️ NÃO é o caminho no bucket. O caminho é `<user_id>/<uuid>` (imutável, sem
 * nada do usuário dentro — ver a 0007); isto é só o rótulo que aparece na tela
 * e no Drive. A separação existe justamente para que um nome hostil
 * ("../../etc/passwd", ou 500 caracteres de emoji) não tenha para onde escapar:
 * ele nunca toca o sistema de arquivos.
 *
 * `data` entra no nome porque, colando um print, não HÁ nome — o clipboard
 * entrega "image.png" para tudo, e três anexos com o mesmo rótulo são
 * indistinguíveis na lista do Drive.
 */
export function nomeDoAnexo(tipo: TipoDeImagem, quando: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const carimbo =
    `${quando.getFullYear()}-${p(quando.getMonth() + 1)}-${p(quando.getDate())}` +
    ` ${p(quando.getHours())}${p(quando.getMinutes())}${p(quando.getSeconds())}`;
  return `Captura ${carimbo}.${extensaoDe(tipo)}`;
}

/** Mensagem única para arquivo recusado. Ver `sniffarImagem` para o critério. */
export const IMAGEM_INVALIDA =
  "Só entram imagens PNG, JPEG, WebP ou GIF. Arquivos SVG não são aceitos.";

export const IMAGEM_GRANDE_DEMAIS = `Cada imagem precisa ter até ${Math.round(
  TAMANHO_MAXIMO_BYTES / 1024 / 1024,
)} MB.`;
