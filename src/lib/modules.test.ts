import { describe, expect, it } from "vitest";
import { MODULES, moduleForPath, resolveEnabled } from "./modules";

describe("resolveEnabled", () => {
  it("sem linhas no banco, tudo é habilitado (retrocompatível)", () => {
    const enabled = resolveEnabled([]);
    expect(enabled.size).toBe(MODULES.length);
  });

  it("desativa apenas o que está marcado como false", () => {
    const enabled = resolveEnabled([{ module_key: "financeiro", enabled: false }]);
    expect(enabled.has("financeiro")).toBe(false);
    expect(enabled.has("tarefas")).toBe(true);
  });

  it("NUNCA desativa um módulo essencial, mesmo se o banco disser o contrário", () => {
    const enabled = resolveEnabled([{ module_key: "inicio", enabled: false }]);
    expect(enabled.has("inicio")).toBe(true);
  });
});

describe("moduleForPath", () => {
  it("casa a rota mais específica primeiro", () => {
    expect(moduleForPath("/financeiro")?.key).toBe("financeiro");
    expect(moduleForPath("/drive/lixeira")?.key).toBe("drive");
  });

  it("a raiz não captura outras rotas", () => {
    expect(moduleForPath("/")?.key).toBe("inicio");
    expect(moduleForPath("/tarefas")?.key).toBe("tarefas");
  });
});
