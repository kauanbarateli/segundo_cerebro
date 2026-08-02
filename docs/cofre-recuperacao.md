# Cofre — kit de recuperação

O Cofre é cifrado no navegador. O servidor guarda **apenas** a chave de dados
embrulhada e os itens em texto cifrado; a senha mestra nunca sai da sua máquina.
Isso significa que ninguém — nem você por outro caminho, nem o Supabase, nem
quem escreveu este código — consegue reabrir o cofre sem uma das chaves.

O kit de recuperação é a segunda chave.

---

## O que é o kit

**Duas metades, guardadas em lugares diferentes.**

| Metade | O que é | Onde guardar |
|---|---|---|
| `cofre-kit-de-recuperacao-AAAA-MM-DD.json` | A chave de dados embrulhada sob o código, com sal, IV e parâmetros do Argon2id | Disco, pendrive, nuvem |
| Código de recuperação | 28 caracteres em grupos de 4 (`aB3d-Kk9Z-…`) | Gerenciador de senhas ou papel |

O código **não está dentro do arquivo**, de propósito. Se estivesse, um backup
automático da pasta Downloads (OneDrive, Google Drive, Time Machine) seria uma
cópia utilizável do cofre inteiro para quem tivesse acesso àquela nuvem.

**Perder qualquer uma das duas metades inutiliza o kit.** Elas não se
substituem.

### Fatos que valem saber

- **Trocar a senha mestra não revoga kit nenhum.** O kit embrulha a *chave de
  dados*, não a senha. Um kit de 2026 continua abrindo o cofre em 2030, com
  qualquer senha mestra que estiver valendo.
- **Gerar um kit novo não invalida os antigos.** Cada kit é um embrulho
  independente da mesma chave. Se você quer que um kit deixe de valer, apague os
  arquivos dele — não existe revogação.
- **O arquivo é versionado** (`formatVersion`). Uma versão futura do formato é
  recusada com "atualize o aplicativo" em vez de ser interpretada às cegas.

---

## Gerar o kit

1. Cofre destravado → painel lateral → **Gerar kit de recuperação**.
   (Ao criar um cofre novo, a oferta aparece logo depois da senha mestra.)
2. Copie o código de recuperação. Ele não aparece de novo.
3. **Baixar kit (.json)**.
4. **Confirme que o kit funciona**: selecione o arquivo que acabou de baixar e
   digite o código.

O passo 4 não é burocracia. Ele lê o arquivo **de volta do disco**, desembrulha
a chave e compara byte a byte com a chave viva na aba. Enquanto ele não passar,
a tela continua dizendo que a senha mestra é o único caminho — porque, sem a
prova, é.

---

## Recuperar

Tela de bloqueio → **Esqueci a senha mestra — tenho o kit de recuperação**.

1. Selecione o arquivo `.json` e digite o código → **Abrir kit**.
   Este passo não escreve nada. Se o kit estiver errado, o cofre fica como está.
2. Defina uma senha mestra nova → **Definir senha e abrir cofre**.

Os itens não são reescritos: continuam cifrados com a mesma chave de dados. O
que muda no servidor é só o embrulho dessa chave.

Hífens e espaços no código são opcionais. **Maiúsculas e minúsculas importam** —
o alfabeto é base64, onde `a` e `A` são caracteres diferentes.

---

## Verificação em navegador limpo

A autoverificação embutida prova o ciclo do artefato no navegador onde ele
nasceu. Para provar também que a recuperação funciona numa máquina que nunca viu
este cofre — o cenário real de desastre —, rode isto uma vez:

1. Crie um cofre de teste numa conta separada (ou use o cofre real: a
   recuperação não destrói itens, apenas troca a senha mestra).
2. Guarde ao menos um item nele.
3. Gere o kit e conclua a autoverificação.
4. Abra uma **janela anônima** ou outro navegador — sem extensões, sem sessão,
   sem `localStorage` desta origem.
5. Entre na conta, vá ao Cofre e clique em **Esqueci a senha mestra**.
6. Use só o arquivo e o código. Não consulte a senha mestra antiga.
7. Confirme que o item do passo 2 aparece legível.

Se qualquer passo falhar, o kit não serve — e a promessa tem que sair da tela
até a causa ser encontrada.

> **Cobertura automatizada:** `src/lib/crypto/recovery-kit.test.ts` executa o
> ciclo criptográfico completo (criar → cifrar item → exportar → serializar →
> ler → desembrulhar → reembrulhar sob senha nova → decifrar) com uma fronteira
> explícita: depois dela, o teste só enxerga o texto do arquivo e o código.
> Ele **não** cobre o `<input type="file">`, o download por Blob nem a gravação
> no banco — é para isso que existe o roteiro acima.
