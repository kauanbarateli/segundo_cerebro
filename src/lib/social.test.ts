import { describe, expect, it } from "vitest";
import {
  urlSegura,
  iconePorDominio,
  LIMITE_DE_LINKS,
  TAMANHO_MAXIMO_DA_URL,
  ICONE_GENERICO,
} from "./social";

/** Atalho: só interessa se passou, na maioria dos casos. */
function aceita(entrada: string): boolean {
  return urlSegura(entrada).ok;
}

/** Atalho: a URL normalizada de uma entrada que se espera aceita. */
function normalizada(entrada: string): string {
  const r = urlSegura(entrada);
  if (!r.ok) throw new Error(`esperava aceitar ${JSON.stringify(entrada)}: ${r.motivo}`);
  return r.url;
}

/* ------------------------------------------------------------------ urlSegura */

/**
 * O NÚCLEO DE SEGURANÇA DA FASE.
 *
 * Cada string aqui vira `href` de um `<a>` se passar. `javascript:` no href
 * executa script na origem do app — a mesma origem do Cofre, com o mesmo cookie
 * de sessão. Se algum destes testes ficar vermelho, o recurso é um XSS
 * armazenado, não um campo de perfil.
 */
describe("urlSegura: esquemas que executam código", () => {
  it("recusa javascript: cru", () => {
    expect(aceita("javascript:alert(1)")).toBe(false);
  });

  it("recusa javascript: com MAIÚSCULA — esquema não diferencia caixa", () => {
    // O parser baixa o esquema para minúscula antes de entregar o `protocol`.
    // Uma regex /^javascript:/ (sem o `i`) sobre a string crua deixaria passar,
    // e o navegador executaria do mesmo jeito.
    expect(aceita("JavaScript:alert(1)")).toBe(false);
    expect(aceita("JAVASCRIPT:alert(1)")).toBe(false);
    expect(aceita("jAvAsCrIpT:alert(1)")).toBe(false);
  });

  it("recusa javascript: com ESPAÇO na frente", () => {
    // O parser descarta espaços e controles das pontas; "  javascript:" e
    // "javascript:" chegam no `<a>` como a mesma coisa.
    expect(aceita("  javascript:alert(1)")).toBe(false);
    expect(aceita("\njavascript:alert(1)")).toBe(false);
    expect(aceita("\u0000javascript:alert(1)")).toBe(false);
  });

  it("recusa javascript: com TAB NO MEIO — o parser remove o tab e executa", () => {
    // A variante que mata a validação por regex: nenhuma expressão sobre a
    // string crua casa com "java\tscript:", mas o parser de URL remove TODO
    // tab/LF/CR de dentro da string e o protocolo vira "javascript:".
    expect(aceita("java\tscript:alert(1)")).toBe(false);
    expect(aceita("java\nscript:alert(1)")).toBe(false);
    expect(aceita("java\rscript:alert(1)")).toBe(false);
    expect(aceita("  Java\tSCRIPT:alert(1)")).toBe(false);
  });

  it("recusa data:, vbscript: e file:", () => {
    // A prova de que allowlist > blocklist: nenhuma destas é "javascript:", e
    // todas são perigosas — data:text/html executa script na própria origem.
    expect(aceita("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(aceita("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==")).toBe(false);
    expect(aceita("vbscript:msgbox(1)")).toBe(false);
    expect(aceita("file:///etc/passwd")).toBe(false);
    expect(aceita("file://C:/Windows/System32/drivers/etc/hosts")).toBe(false);
  });

  it("recusa os outros esquemas que ninguém lembra de bloquear", () => {
    // Exatamente o motivo de a lista ser de PERMITIDOS: esta lista nunca acaba.
    for (const perigosa of [
      "blob:https://exemplo.com/8a1b",
      "filesystem:https://exemplo.com/temporary/x",
      "about:blank",
      "jar:https://exemplo.com/a.jar!/b",
      "intent://exemplo.com#Intent;scheme=https;end",
      "view-source:https://exemplo.com",
      "chrome://settings",
      "ftp://exemplo.com/arquivo",
      "mailto:fulano@exemplo.com",
      "tel:+5511999999999",
    ]) {
      expect(aceita(perigosa), perigosa).toBe(false);
    }
  });
});

describe("urlSegura: só https", () => {
  it("recusa http puro", () => {
    expect(aceita("http://exemplo.com")).toBe(false);
    expect(aceita("HTTP://exemplo.com")).toBe(false);
  });

  it("recusa entrada vazia e só espaços", () => {
    expect(aceita("")).toBe(false);
    expect(aceita("   ")).toBe(false);
    expect(aceita("\t\n ")).toBe(false);
  });

  it("aceita as URLs de perfil de verdade, sem mexer no caminho", () => {
    expect(normalizada("https://instagram.com/fulano")).toBe("https://instagram.com/fulano");
    expect(normalizada("https://www.linkedin.com/in/fulano/")).toBe(
      "https://www.linkedin.com/in/fulano/",
    );
    expect(normalizada("https://exemplo.com.br/caminho?a=1")).toBe(
      "https://exemplo.com.br/caminho?a=1",
    );
  });

  it("preserva querystring e fragmento — parte da identidade do link", () => {
    expect(normalizada("https://exemplo.com/a?b=1&c=2#topo")).toBe(
      "https://exemplo.com/a?b=1&c=2#topo",
    );
  });
});

describe("urlSegura: normalização", () => {
  it("baixa o host para minúscula mas PRESERVA a caixa do caminho", () => {
    // Host é case-insensitive; caminho não é — "/Fulano" e "/fulano" podem ser
    // duas páginas diferentes, e achatar quebraria o link.
    expect(normalizada("https://Instagram.COM/Fulano")).toBe("https://instagram.com/Fulano");
  });

  it("aceita o esquema escrito em maiúscula", () => {
    expect(normalizada("HTTPS://exemplo.com/x")).toBe("https://exemplo.com/x");
  });

  it("acrescenta a barra final da raiz (forma canônica)", () => {
    expect(normalizada("https://exemplo.com")).toBe("https://exemplo.com/");
  });

  it("converte domínio acentuado para punycode", () => {
    // Guardar o punycode deixa explícito para onde o link vai: dois domínios
    // que "parecem" iguais na tela viram strings diferentes no banco.
    expect(normalizada("https://açaí.com.br/x")).toBe("https://xn--aa-4iaz.com.br/x");
  });

  it("percent-encoda espaço no caminho", () => {
    expect(normalizada("https://exemplo.com/a b")).toBe("https://exemplo.com/a%20b");
  });

  it("recusa URL acima do teto de caracteres", () => {
    const gigante = `https://exemplo.com/${"a".repeat(TAMANHO_MAXIMO_DA_URL)}`;
    expect(gigante.length).toBeGreaterThan(TAMANHO_MAXIMO_DA_URL);
    expect(aceita(gigante)).toBe(false);
    expect(aceita(`https://exemplo.com/${"a".repeat(100)}`)).toBe(true);
  });
});

describe("urlSegura: entrada sem esquema", () => {
  it("aceita e prefixa https:// quando não há esquema nenhum", () => {
    expect(normalizada("instagram.com/fulano")).toBe("https://instagram.com/fulano");
    expect(normalizada("www.linkedin.com/in/fulano/")).toBe("https://www.linkedin.com/in/fulano/");
    expect(normalizada("exemplo.com.br")).toBe("https://exemplo.com.br/");
  });

  /**
   * A REGRA QUE IMPEDE O PREFIXO DE VIRAR ARMA.
   *
   * Prefixar às cegas transformaria "javascript:alert(1)" em
   * "https://javascript:alert(1)" — que o parser lê como host `javascript` na
   * porta `alert(1)`. Ou o parser recusa, ou aceita um lixo com protocolo
   * https: e a checagem de protocolo aprova. Só se prefixa o que NÃO tem ':'
   * antes da primeira '/'.
   */
  it("NUNCA prefixa string que já tem ':' antes da primeira '/'", () => {
    expect(aceita("javascript:alert(1)")).toBe(false);
    expect(aceita("javascript:/*x*/alert(1)")).toBe(false);
    expect(aceita("javascript:alert(1)/foo")).toBe(false);
    // A prova direta: se o prefixo tivesse sido aplicado, o protocolo seria
    // https: e o resultado teria "javascript" no host.
    const r = urlSegura("javascript:alert(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toContain("https");
  });

  it("recusa host sem ponto — 'fulano' viraria https://fulano/, link morto", () => {
    expect(aceita("fulano")).toBe(false);
    expect(aceita("https://localhost/x")).toBe(false);
    expect(aceita("https://intranet/x")).toBe(false);
  });

  it("recusa caminho absoluto: '/etc/passwd' vira host 'etc', não um site", () => {
    // Sem a regra do ponto no host isto passaria: o parser engole as barras
    // extras de "https:///etc/passwd" e chama "etc" de hostname.
    expect(aceita("/etc/passwd")).toBe(false);
    expect(aceita("https:///etc/passwd")).toBe(false);
  });

  it("recusa host com porta sem esquema — lado seguro do erro", () => {
    // "exemplo.com:8080/x" tem ':' antes da '/', então não é prefixado, e
    // "exemplo.com:" não é um esquema permitido. Escrever https:// resolve.
    expect(aceita("exemplo.com:8080/x")).toBe(false);
    expect(aceita("https://exemplo.com:8080/x")).toBe(true);
  });
});

/**
 * `https://github.com@evil.example/` leva para `evil.example`. O que está antes
 * do '@' é usuário e senha, não domínio — mas é o que a pessoa lê na tela.
 * Aceitar seria hospedar phishing com o ícone do GitHub do lado.
 */
describe("urlSegura: credenciais embutidas (phishing por leitura)", () => {
  it("recusa usuário e senha na URL", () => {
    expect(aceita("https://github.com@evil.example/")).toBe(false);
    expect(aceita("https://instagram.com:senha@evil.example/fulano")).toBe(false);
    expect(aceita("https://usuario:senha@exemplo.com/")).toBe(false);
  });

  it("a prova de que o host de verdade era outro", () => {
    // Se um dia esta regra cair, o ícone escolhido delata o destino real.
    expect(iconePorDominio("https://github.com@evil.example/")).toBe(ICONE_GENERICO);
  });
});

describe("urlSegura: formato do retorno", () => {
  it("sucesso traz a URL normalizada e nenhum motivo", () => {
    const r = urlSegura("instagram.com/fulano");
    expect(r).toEqual({ ok: true, url: "https://instagram.com/fulano" });
  });

  it("falha traz motivo em português, para a interface mostrar", () => {
    const r = urlSegura("javascript:alert(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo.length).toBeGreaterThan(0);
      // O motivo não pode ecoar a entrada: ele vai para a tela, e devolver
      // "javascript:alert(1)" num texto de erro é reabrir a porta pelo lado.
      expect(r.motivo).not.toContain("alert");
    }
  });

  it("recusa lixo que nem é URL, sem lançar exceção", () => {
    for (const lixo of ["???", "http://", "https://", "://exemplo.com", "  ://  "]) {
      expect(() => urlSegura(lixo)).not.toThrow();
      expect(aceita(lixo), lixo).toBe(false);
    }
  });
});

/* ------------------------------------------------------------ iconePorDominio */

describe("iconePorDominio", () => {
  it("x.com e twitter.com dão o MESMO ícone", () => {
    const icone = iconePorDominio("https://x.com/fulano");
    expect(iconePorDominio("https://twitter.com/fulano")).toBe(icone);
    expect(iconePorDominio("https://www.twitter.com/fulano")).toBe(icone);
    expect(icone).toBe("XTwitter");
  });

  it("subdomínio conta: gist.github.com é GitHub", () => {
    expect(iconePorDominio("https://gist.github.com/fulano/abc123")).toBe("GitHub");
    expect(iconePorDominio("https://github.com/fulano")).toBe("GitHub");
    expect(iconePorDominio("https://fulano.github.io/projeto")).toBe("GitHub");
  });

  it("subdomínio de país conta: br.linkedin.com é LinkedIn", () => {
    expect(iconePorDominio("https://br.linkedin.com/in/fulano")).toBe("LinkedIn");
    expect(iconePorDominio("https://www.linkedin.com/in/fulano/")).toBe("LinkedIn");
    expect(iconePorDominio("https://linkedin.com/in/fulano")).toBe("LinkedIn");
  });

  it("www.instagram.com é Instagram", () => {
    expect(iconePorDominio("https://www.instagram.com/fulano")).toBe("Instagram");
    expect(iconePorDominio("https://instagram.com/fulano")).toBe("Instagram");
  });

  it("domínio desconhecido devolve o ícone genérico, nunca erro", () => {
    expect(iconePorDominio("https://exemplo.com.br/blog")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://site-que-nao-existe.xyz")).toBe("Link");
  });

  /**
   * A ARMADILHA DA SUBSTRING.
   *
   * `url.includes("github.com")` casaria com todas estas. Em
   * `https://github.com.evil.example/` o domínio registrável é `evil.example` —
   * qualquer pessoa registra e cria o rótulo `github.com` à esquerda. Mostrar o
   * ícone do GitHub ali é emprestar a credibilidade da marca para o golpe.
   */
  it("NÃO casa por substring: github.com.evil.example é genérico", () => {
    expect(iconePorDominio("https://github.com.evil.example/fulano")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://instagram.com.evil.example/")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://linkedin.com.br.evil.example/")).toBe(ICONE_GENERICO);
    // O nome da marca no caminho ou na query também não vale.
    expect(iconePorDominio("https://evil.example/github.com/fulano")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://evil.example/?r=https://x.com")).toBe(ICONE_GENERICO);
    // Nem no usuário embutido (o host de verdade é o que vale).
    expect(iconePorDominio("https://x.com@evil.example/")).toBe(ICONE_GENERICO);
  });

  it("o ponto separador é obrigatório: notgithub.com não é GitHub", () => {
    expect(iconePorDominio("https://notgithub.com/fulano")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://myx.com/")).toBe(ICONE_GENERICO);
    expect(iconePorDominio("https://xx.com/")).toBe(ICONE_GENERICO);
  });

  it("reconhece os encurtadores oficiais de cada plataforma", () => {
    expect(iconePorDominio("https://youtu.be/abc")).toBe("YouTube");
    expect(iconePorDominio("https://www.youtube.com/@canal")).toBe("YouTube");
    expect(iconePorDominio("https://wa.me/5511999999999")).toBe("WhatsApp");
    expect(iconePorDominio("https://api.whatsapp.com/send?phone=55")).toBe("WhatsApp");
    expect(iconePorDominio("https://lnkd.in/abc")).toBe("LinkedIn");
    expect(iconePorDominio("https://redd.it/abc")).toBe("Reddit");
  });

  it("t.me é Telegram e t.co é X — um caractere separa donos diferentes", () => {
    expect(iconePorDominio("https://t.me/fulano")).toBe("Telegram");
    expect(iconePorDominio("https://t.co/abc")).toBe("XTwitter");
  });

  it("cobre o resto do catálogo", () => {
    expect(iconePorDominio("https://www.facebook.com/fulano")).toBe("Facebook");
    expect(iconePorDominio("https://fb.me/fulano")).toBe("Facebook");
    expect(iconePorDominio("https://www.tiktok.com/@fulano")).toBe("TikTok");
    expect(iconePorDominio("https://discord.gg/abc")).toBe("Discord");
    expect(iconePorDominio("https://open.spotify.com/artist/abc")).toBe("Spotify");
    expect(iconePorDominio("https://www.twitch.tv/fulano")).toBe("Twitch");
    expect(iconePorDominio("https://www.threads.net/@fulano")).toBe("Threads");
  });

  it("é indiferente à caixa do host", () => {
    expect(iconePorDominio("https://GitHub.COM/Fulano")).toBe("GitHub");
    expect(iconePorDominio("HTTPS://WWW.INSTAGRAM.COM/fulano")).toBe("Instagram");
  });

  it("funciona com a URL ainda sem esquema, como o campo em digitação", () => {
    expect(iconePorDominio("instagram.com/fulano")).toBe("Instagram");
    expect(iconePorDominio("www.linkedin.com/in/fulano")).toBe("LinkedIn");
  });

  it("nunca lança, nem com entrada impossível", () => {
    for (const lixo of ["", "   ", "???", "javascript:alert(1)", "data:text/html,x", "://"]) {
      expect(() => iconePorDominio(lixo)).not.toThrow();
      expect(iconePorDominio(lixo), lixo).toBe(ICONE_GENERICO);
    }
  });

  /**
   * A função escolhe ÍCONE, não autoriza navegação. Um esquema perigoso não
   * ganha ícone de marca, mas também não explode a lista — quem barra a gravação
   * é `urlSegura`, e confundir os dois papéis faria uma linha ruim no banco
   * derrubar a renderização da página inteira.
   */
  it("não confere protocolo: é escolha de ícone, não autorização", () => {
    expect(iconePorDominio("http://github.com/fulano")).toBe("GitHub");
  });
});

/* --------------------------------------------------------------- LIMITE_DE_LINKS */

describe("LIMITE_DE_LINKS", () => {
  it("é 8 e é um inteiro positivo", () => {
    // Interface, server action e o trigger de contagem da 0012 leem daqui. Se
    // este número mudar sem a migration mudar junto, a tela promete um link que
    // o banco recusa.
    expect(LIMITE_DE_LINKS).toBe(8);
    expect(Number.isInteger(LIMITE_DE_LINKS)).toBe(true);
    expect(LIMITE_DE_LINKS).toBeGreaterThan(0);
  });
});
