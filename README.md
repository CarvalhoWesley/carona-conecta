# Carona Conecta

Extensão Chrome/Edge que combina caronas do BlaBlaCar em rotas com conexões
(ex.: Batatais → Ribeirão Preto → Campinas → Boituva).

## Instalar
1. Baixe o `carona-conecta-vX.Y.Z.zip` da [última release](https://github.com/CarvalhoWesley/carona-conecta/releases/latest).
2. Descompacte numa pasta que não vá apagar (a extensão roda a partir dela).
3. Abra `chrome://extensions` (ou `edge://extensions`) e ative **Modo do desenvolvedor**.
4. Clique em **Carregar sem compactação** e escolha a pasta `carona-conecta` descompactada.
5. Clique no ícone da extensão para abrir o painel lateral. Dica: fixe o ícone na barra (📌).

### Atualizar
Baixe o zip da versão nova, substitua o conteúdo da pasta e clique em ↻ no card da extensão
em `chrome://extensions`. Configurações e rotas salvas são mantidas.

## Uso
Informe origem, destino e data. Opcionalmente adicione paradas para escolher as cidades de conexão;
sem paradas, a extensão escolhe sozinha. Ela abre as buscas do BlaBlaCar em abas de segundo plano
(uma por vez, com pausa), lê os resultados e monta as rotas. Se o site pedir CAPTCHA, a busca para;
resolva na aba e busque de novo (trechos já buscados ficam em cache por 10 min).

## Desenvolvimento
- Carregue a pasta do repositório direto em **Carregar sem compactação**.
- `./build.ps1` gera `dist/carona-conecta-v<versão>.zip` para a release (versão vem do `manifest.json`).

Veja `DESIGN.md` para as decisões e a arquitetura.
