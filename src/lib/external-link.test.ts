import { describe, expect, it } from "vitest";
import { analisarLinkExterno } from "./external-link";

const MEET = "https://meet.google.com/abc-defg-hij";

describe("analisarLinkExterno — o que é recusado", () => {
  it("recusa esquemas que não são https", () => {
    // `javascript:` é o mais grave: executaria script na origem do aplicativo,
    // no mesmo site onde o Cofre mantém a chave de dados em memória.
    expect(analisarLinkExterno("javascript:alert(document.cookie)")).toBeNull();
    expect(analisarLinkExterno("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(analisarLinkExterno("http://meet.google.com/abc")).toBeNull();
    expect(analisarLinkExterno("vbscript:msgbox(1)")).toBeNull();
    expect(analisarLinkExterno("file:///etc/passwd")).toBeNull();
  });

  it("recusa o que não é string ou não é URL", () => {
    expect(analisarLinkExterno(undefined)).toBeNull();
    expect(analisarLinkExterno(null)).toBeNull();
    expect(analisarLinkExterno(42)).toBeNull();
    expect(analisarLinkExterno({ href: MEET })).toBeNull();
    expect(analisarLinkExterno("")).toBeNull();
    expect(analisarLinkExterno("   ")).toBeNull();
    expect(analisarLinkExterno("não é url")).toBeNull();
  });

  it("NÃO completa esquema ausente — diferente de urlSegura, aqui a entrada é de máquina", () => {
    expect(analisarLinkExterno("meet.google.com/abc-defg-hij")).toBeNull();
  });

  it("recusa host sem ponto e URL gigante", () => {
    expect(analisarLinkExterno("https://localhost/x")).toBeNull();
    expect(analisarLinkExterno(`https://exemplo.com/${"a".repeat(3000)}`)).toBeNull();
  });
});

describe("analisarLinkExterno — o rótulo Google Meet", () => {
  it("carimba o Meet quando o host é exatamente meet.google.com", () => {
    const r = analisarLinkExterno(MEET);
    expect(r).not.toBeNull();
    expect(r!.ehGoogleMeet).toBe(true);
    expect(r!.rotulo).toBe("Google Meet");
    expect(r!.hostname).toBe("meet.google.com");
  });

  it("aceita variação de caixa no host e no esquema", () => {
    const r = analisarLinkExterno("HTTPS://MEET.GOOGLE.COM/abc-defg-hij");
    expect(r?.ehGoogleMeet).toBe(true);
  });

  it("NÃO carimba subdomínio falsificado — o caso do `includes`", () => {
    // O domínio de verdade aqui é `phishing.example`.
    const r = analisarLinkExterno("https://meet.google.com.phishing.example/entrar");
    expect(r).not.toBeNull();
    expect(r!.ehGoogleMeet).toBe(false);
    expect(r!.hostname).toBe("meet.google.com.phishing.example");
    expect(r!.rotulo).toBe("meet.google.com.phishing.example");
  });

  it("NÃO carimba host que só termina em google.com — o caso do `endsWith`", () => {
    expect(analisarLinkExterno("https://evilgoogle.com/x")?.ehGoogleMeet).toBe(false);
    expect(analisarLinkExterno("https://meet.google.com.br/x")?.ehGoogleMeet).toBe(false);
  });

  it("RECUSA credencial embutida — o disfarce que engana leitura humana", () => {
    // Para um olho apressado isto parece meet.google.com. O host real é
    // phishing.example; o trecho antes do @ é usuário e senha.
    expect(analisarLinkExterno("https://meet.google.com@phishing.example/x")).toBeNull();
    expect(analisarLinkExterno("https://meet.google.com:senha@phishing.example/x")).toBeNull();
  });

  it("outro serviço legítimo vira link com o próprio domínio como rótulo", () => {
    const r = analisarLinkExterno("https://exemplo.zoom.us/j/123456");
    expect(r!.ehGoogleMeet).toBe(false);
    expect(r!.rotulo).toBe("exemplo.zoom.us");
    expect(r!.href).toBe("https://exemplo.zoom.us/j/123456");
  });

  it("devolve a forma canônica no href", () => {
    const r = analisarLinkExterno("https://MEET.google.com/abc?x=1#top");
    expect(r!.href).toBe("https://meet.google.com/abc?x=1#top");
  });
});
