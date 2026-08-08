"use client";

import { useEffect } from "react";

/**
 * A ÚLTIMA REDE — o erro que derruba o layout raiz.
 *
 * ============================================================================
 * POR QUE ELE NÃO É REDUNDANTE COM `(app)/error.tsx`
 * ============================================================================
 * O `error.tsx` de um grupo de rotas é renderizado DENTRO do layout: ele conta
 * com `<html>`, `<body>`, o tema já aplicado e a barra lateral montada. Quando
 * quem quebra é o próprio layout raiz, não existe nada disso para renderizar
 * dentro — e o Next cai neste arquivo, que precisa trazer o documento inteiro.
 *
 * É por isso que há `<html>` e `<body>` aqui e não lá. Não é duplicação: é o
 * único caso em que este componente SUBSTITUI o documento.
 *
 * ============================================================================
 * ⚠️ POR QUE ELE PRECISA EXISTIR PARA A OBSERVABILIDADE
 * ============================================================================
 * Erro de renderização do React na raiz é o mais grave que existe — a tela toda
 * fica em branco — e é exatamente o que NÃO chega ao Sentry sem este arquivo. O
 * `onRequestError` de `instrumentation.ts` cobre o servidor; os handlers globais
 * cobrem exceção solta no navegador; um erro de render fica no meio, capturado
 * pelo próprio React e entregue a este componente, que é o único que sabe dele.
 *
 * Era metade do problema que a Etapa 12 veio resolver: a tela quebrava no
 * navegador de alguém e só se ficava sabendo se essa pessoa contasse.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
      `import()` dinâmico pelo mesmo motivo de `instrumentation-client.ts`: um
      import estático do SDK aqui o traria de volta para o pacote principal e
      desfaria os 45 kB economizados lá — em TODA rota, por causa de um arquivo
      que quase nunca renderiza.

      Sem DSN nada é carregado, e o `console.error` continua sendo o que existe.
    */
    console.error(error);

    void import("@/lib/observabilidade").then(({ DSN }) => {
      if (!DSN) return;
      return import("@sentry/nextjs").then((Sentry) => {
        Sentry.captureException(error);
      });
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      {/*
        ⚠️ ESTILO EM LINHA, e não classe do Tailwind.

        Se o que quebrou foi o layout raiz, não há garantia nenhuma de que a
        folha de estilos chegou a ser aplicada — e uma tela de erro sem estilo
        nenhum, texto preto em fundo branco colado no canto, parece mais quebrada
        que o próprio defeito. Estas poucas regras não dependem de build.

        Também não há tema aqui: o script que decide claro/escuro vive no layout
        que acabou de falhar. As cores são neutras de propósito, legíveis nos
        dois casos.
      */}
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#faf9f7",
          color: "#1c1a17",
        }}
      >
        <main style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: "0 0 0.75rem" }}>
            Algo quebrou aqui
          </h1>
          <p style={{ margin: "0 0 1.5rem", lineHeight: 1.6, color: "#5c554c" }}>
            A tela não conseguiu carregar. Tentar de novo costuma resolver — se não resolver,
            recarregue a página.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 1.25rem",
              borderRadius: "0.5rem",
              border: "1px solid #1c1a17",
              background: "#1c1a17",
              color: "#faf9f7",
              fontSize: "0.9375rem",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Tentar novamente
          </button>
          {/*
            O `digest` é o identificador que o Next gera para o erro e o mesmo
            que aparece no log do servidor. Ele NÃO é conteúdo — é um hash — e é
            o que permite ligar "deu erro aqui" ao registro correspondente sem
            expor a mensagem original ao usuário.
          */}
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#8a8177" }}>
              Código: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
