import { describe, expect, it } from "vitest";
import {
  BYTES_PARA_SNIFAR,
  TIPOS_ACEITOS,
  extensaoDe,
  nomeDoAnexo,
  sniffarImagem,
  tipoAceito,
} from "./imagem";

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpeg = [0xff, 0xd8, 0xff, 0xe0];
const gif87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const gif89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const webp = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x01, 0x00, 0x57, 0x45, 0x42, 0x50];

const b = (...n: number[]) => new Uint8Array(n);

describe("sniffarImagem", () => {
  it("reconhece os quatro formatos aceitos", () => {
    expect(sniffarImagem(b(...png))).toBe("image/png");
    expect(sniffarImagem(b(...jpeg))).toBe("image/jpeg");
    expect(sniffarImagem(b(...gif87))).toBe("image/gif");
    expect(sniffarImagem(b(...gif89))).toBe("image/gif");
    expect(sniffarImagem(b(...webp))).toBe("image/webp");
  });

  /*
    ⚠️ O TESTE CENTRAL DESTE ARQUIVO.

    SVG é um documento XML que pode conter <script>. Servido do mesmo domínio em
    que o Cofre está aberto, ele é XSS armazenado com cara de anexo. Nenhuma das
    três formas de disfarce abaixo pode passar.
  */
  it("recusa SVG em todas as formas que ele aparece", () => {
    const comXml = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\">";
    const semXml = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
    const comEspaco = "  <svg>";

    for (const texto of [comXml, semXml, comEspaco]) {
      const bytes = new TextEncoder().encode(texto);
      expect(sniffarImagem(bytes)).toBeNull();
    }
  });

  it("recusa executável e arquivo comprimido disfarçados de imagem", () => {
    // MZ — executável do Windows.
    expect(sniffarImagem(b(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
    // \x7fELF — binário Linux.
    expect(sniffarImagem(b(0x7f, 0x45, 0x4c, 0x46))).toBeNull();
    // PK\x03\x04 — zip (e portanto docx, xlsx, jar…).
    expect(sniffarImagem(b(0x50, 0x4b, 0x03, 0x04))).toBeNull();
    // %PDF
    expect(sniffarImagem(b(0x25, 0x50, 0x44, 0x46))).toBeNull();
  });

  it("recusa arquivo vazio e curto demais para decidir", () => {
    expect(sniffarImagem(b())).toBeNull();
    expect(sniffarImagem(b(0x89, 0x50))).toBeNull();
  });

  /*
    O contêiner RIFF traz o TAMANHO do arquivo nos bytes 4–7, que varia a cada
    arquivo. Se a assinatura os comparasse, só um WebP de tamanho específico
    passaria — e o formato inteiro seria recusado na prática.
  */
  it("aceita WebP com qualquer tamanho no cabeçalho RIFF", () => {
    for (const tamanho of [[0x00, 0x00, 0x00, 0x00], [0xff, 0xff, 0xff, 0xff]]) {
      const bytes = b(0x52, 0x49, 0x46, 0x46, ...tamanho, 0x57, 0x45, 0x42, 0x50);
      expect(sniffarImagem(bytes)).toBe("image/webp");
    }
  });

  it("recusa RIFF que não é WebP (um .wav, por exemplo)", () => {
    // "RIFF" + tamanho + "WAVE"
    expect(
      sniffarImagem(b(0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45)),
    ).toBeNull();
  });

  it("BYTES_PARA_SNIFAR cobre a assinatura mais longa", () => {
    // Se alguém acrescentar um formato com assinatura maior e esquecer de subir
    // a constante, o servidor leria bytes de menos e recusaria arquivo legítimo.
    expect(BYTES_PARA_SNIFAR).toBeGreaterThanOrEqual(webp.length);
  });

  it("só os primeiros bytes importam — o resto do arquivo é ignorado", () => {
    const grande = new Uint8Array(1000);
    grande.set(png, 0);
    expect(sniffarImagem(grande)).toBe("image/png");
  });
});

describe("tipoAceito", () => {
  it("aceita exatamente os quatro da allowlist", () => {
    for (const t of TIPOS_ACEITOS) expect(tipoAceito(t)).toBe(true);
  });

  it("recusa SVG, tipo vazio, nulo e qualquer outro", () => {
    for (const t of ["image/svg+xml", "text/html", "application/pdf", "", null, undefined]) {
      expect(tipoAceito(t)).toBe(false);
    }
  });
});

describe("extensaoDe", () => {
  it("normaliza jpeg para jpg e mantém o resto", () => {
    expect(extensaoDe("image/jpeg")).toBe("jpg");
    expect(extensaoDe("image/png")).toBe("png");
    expect(extensaoDe("image/webp")).toBe("webp");
    expect(extensaoDe("image/gif")).toBe("gif");
  });
});

describe("nomeDoAnexo", () => {
  it("carimba data e hora para que anexos colados não colidam", () => {
    const a = nomeDoAnexo("image/png", new Date(2026, 7, 7, 14, 30, 5));
    expect(a).toBe("Captura 2026-08-07 143005.png");
  });

  it("usa a extensão do tipo REAL, não a do que veio", () => {
    expect(nomeDoAnexo("image/jpeg", new Date(2026, 0, 1, 0, 0, 0))).toMatch(/\.jpg$/);
  });

  /*
    O nome é RÓTULO, nunca caminho — o caminho no bucket é `<user_id>/<uuid>`
    (0007). Ainda assim ele não pode carregar separador: um dia alguém o usa
    para montar um `Content-Disposition`, e aí a travessia importa.
  */
  it("não produz separador de caminho", () => {
    const nome = nomeDoAnexo("image/png", new Date(2026, 7, 7, 14, 30, 5));
    expect(nome).not.toContain("/");
    expect(nome).not.toContain("\\");
    expect(nome).not.toContain("..");
  });
});
