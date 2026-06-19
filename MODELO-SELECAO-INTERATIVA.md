# Modelo obrigatorio de selecao interativa da Thais

Este arquivo define como a Thais deve montar a Etapa 2 do ENTRETEU.

Quando Rafael pedir `selecao interativa`, `Etapa 2` ou pedir para colocar as
materias escolhidas em pagina de aprovacao, a Thais deve gerar uma pagina HTML
no repositorio `criatixagencia-collab/thais-selecao`.

## Regra principal

A Thais nao deve montar HTML artesanalmente na conversa ou no improviso.

Ela deve preparar um JSON com textos completos e imagens candidatas e rodar o
gerador oficial:

```bash
npm run selection:interactive -- --input data/selecao-pronta.json
```

Se o gerador falhar por texto curto ou imagem insuficiente, a pagina NAO deve
ser publicada. A Thais precisa voltar, escrever melhor e buscar mais imagens.

Atalho proibido: gerar `index.html` manual com `const p = [...]`, `imgs: []`,
`src: ""`, ou cards de imagem escritos na mao. Esse padrao produz paginas com
imagem pequena, imagem quebrada e falsas opcoes. Se isso acontecer, apagar a
tentativa local, voltar para o JSON e rodar o gerador oficial.

## Local correto

Criar uma pasta unica por data e horario:

```text
selecao-AAAAMMDD-HHMM/
```

Exemplo:

```text
selecao-20260619-1430/index.html
```

Nunca sobrescrever selecao antiga.

## O que a pagina precisa ter

Cada card de materia deve ter:

- numero da materia em destaque;
- botao `Copiar numero` no topo;
- categoria;
- titulo;
- linha de apoio;
- texto completo, com 3 a 6 paragrafos e normalmente 800+ caracteres;
- fontes textuais verificadas com URLs;
- grid/carrossel com varias opcoes de imagem visiveis/renderizaveis, quando
  houver;
- credito e status de uso de cada imagem;
- botao `Aprovar materia`;
- estado visual `pendente` ou `aprovada`;
- estado salvo em `localStorage`.

Nao usar botao de rejeitar por padrao. Se Rafael nao aprovar, a materia fica
rejeitada automaticamente.

## Imagens

Cada materia deve ter varias imagens candidatas sempre que possivel.

O minimo operacional padrao e 3 imagens renderizaveis por materia. Se tiver
menos que isso, o gerador oficial deve falhar e a Thais deve buscar mais imagens
antes de publicar.

Cada imagem precisa ter:

- URL/caminho local renderizavel, em campo `url`, `src` ou equivalente;
- credito;
- fonte/pagina da imagem;
- status: `segura para uso`, `usar com cautela` ou `nao usar sem autorizacao`.

Imagem candidata so conta se aparecer visualmente na pagina. Nao basta escrever
o credito ou a origem da foto.

Tambem nao conta como imagem:

- `src` vazio;
- `imgs: []`;
- "Instagram via Apify" sem arquivo/URL direta renderizavel;
- "Getty", "Divulgacao", "Reproducao", "pendente" ou "verificar" sem miniatura;
- arquivo `.jpg` que na verdade e texto de erro, 404 ou pagina HTML salva.

Errado:

```json
{ "label": "Anne Hathaway no Oscar", "credito": "Getty Images" }
```

Certo:

```json
{
  "label": "Anne Hathaway no Oscar",
  "url": "imagens/anne-hathaway-oscar.jpg",
  "credito": "Getty Images",
  "status": "usar com cautela"
}
```

O HTML deve renderizar a imagem:

```html
<img src="imagens/anne-hathaway-oscar.jpg" alt="Anne Hathaway no Oscar">
```

Se a URL externa falhar, estiver bloqueada ou nao carregar por hotlink, baixar
ou copiar a imagem para a pasta da propria selecao:

```text
selecao-AAAAMMDD-HHMM/imagens/
```

As imagens candidatas nao devem ser retiradas exatamente das mesmas paginas
usadas como fontes textuais da materia.

Se nao houver imagens suficientes, a acao padrao nao e publicar com pendencia.
A Thais deve buscar outras fontes, baixar/copiar as imagens para
`selecao-AAAAMMDD-HHMM/imagens/` e validar de novo. So pode publicar pendencia
depois de tentar de verdade e avisar Rafael antes.

## Validacao obrigatoria antes de publicar

Antes de commit/push, a Thais deve conferir a pagina gerada:

- total de materias;
- total de imagens renderizaveis;
- zero opcoes com `src` vazio;
- zero materias com `imgs: []`;
- zero caminhos locais ausentes;
- zero arquivos de imagem que sejam texto/HTML/erro;
- miniaturas em grid ou cards grandes o suficiente para comparar imagens;
- nenhuma imagem dependente de hotlink externo quando puder ser local.

Se a validacao nao der zero vazias e zero ausentes, a pagina ainda nao esta
pronta para Rafael.

## Comportamento esperado em JavaScript

A pagina precisa permitir:

- clicar em uma imagem para selecionar;
- visualizar a miniatura real de cada imagem;
- clicar em `Aprovar materia`;
- salvar a escolha no `localStorage`;
- recarregar a pagina sem perder escolhas;
- copiar o numero da materia;
- copiar um resumo final das materias aprovadas.

Exemplo de resumo copiavel:

```text
APROVADAS - SELECAO 2026-06-19 14:30

01 - Titulo da materia
Imagem: opcao 2
Credito: Divulgacao/Globo

04 - Titulo da materia
Imagem: opcao 1
Credito: Instagram oficial
```

## Resposta correta para Rafael

No chat, a Thais deve responder curto:

```text
Selecao interativa criada e publicada:
LINK_DA_PAGINA
```

Nao colar a selecao inteira no chat.

## Proibido

- Gerar so Markdown.
- Mandar a selecao interativa inteira na conversa.
- Publicar no repositorio do Caique.
- Usar workspace do Caique.
- Sobrescrever selecoes antigas.
- Fazer pagina sem botao de aprovar.
- Fazer pagina sem botao de copiar numero.
- Fazer pagina sem opcoes de imagem quando havia imagens disponiveis.
- Fazer pagina com "opcoes de imagem" que mostram apenas texto/credito, sem
  miniatura real.
- Fazer pagina com `imgs: []`, `src: ""`, "Instagram via Apify", "Getty",
  "Divulgacao" ou "pendente" como se isso fosse imagem candidata.
- Publicar selecao interativa feita manualmente em vez de usar o gerador
  oficial.
- Usar texto curto de cardapio como texto da Etapa 2.
