# Carona Conecta

Extensão Chrome/Edge que combina caronas do BlaBlaCar em rotas com conexões.

## Instalar (modo desenvolvedor)
1. Abra `chrome://extensions` (ou `edge://extensions`) e ative **Modo do desenvolvedor**.
2. **Carregar sem compactação** → selecione esta pasta.
3. Clique no ícone da extensão para abrir o painel lateral.

## Uso
Informe origem, destino e data. A extensão abre buscas do BlaBlaCar em abas de segundo plano
(uma por vez, com pausa), lê os resultados e monta rotas. Se o site pedir CAPTCHA, a busca para;
resolva na aba e busque de novo (trechos já buscados ficam em cache por 10 min).

Veja `DESIGN.md` para as decisões e a arquitetura.
