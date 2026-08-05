import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
/*
  ⚠️ O IMPORT VEM DE `tema-init`, QUE NÃO TEM "use client" — e isso é o que faz
  o script funcionar. Importá-lo de `ThemeToggle.tsx` (onde ele morava) devolvia
  a este Componente de Servidor uma referência de cliente, e o <script> abaixo
  saía com o código-fonte de uma função lançadora em vez do script do tema. Ver
  o cabeçalho de `tema-init.ts`.
*/
import { themeInitScript } from "@/components/theme/tema-init";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Segundo Cérebro",
  description: "Tudo que importa, em um só lugar.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f1" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
