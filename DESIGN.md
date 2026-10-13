# Carona Conecta — Design (v1)

Extensão Chrome/Edge (Manifest V3) que monta rotas com conexões entre caronas do BlaBlaCar
(ex.: Batatais → Ribeirão Preto → Campinas → Boituva).

## Decisões
| Tema | Decisão |
|---|---|
| Fonte de dados | Sessão do usuário: abas reais em segundo plano em `blablacar.com.br/search` |
| Leitura | JSON embutido `window.__INFRASTRUCTURE__cache` (chave `/trip/search/v9…`), não o DOM |
| Proteção anti-bot (DataDome) | Não contornar. Buscas sequenciais e lentas; se aparecer CAPTCHA, parar e mostrar a aba ao usuário |
| Hubs | Lista curada de cidades-polo filtrada por corredor + descoberta pelos pontos de chegada (reverse geocoding) |
| Regras de conexão | Configuráveis (padrões abaixo) |
| UI | Side panel |
| Escopo v1 | Busca + combinação + ranking + configurações. Sem datas flexíveis/alertas/ônibus |

## Configurações padrão
- máx. trechos: 3 · conexão mín.: 20 min · espera máx.: 240 min
- distância máx. desembarque→embarque: 3 km
- desvio máx. do hub: 40% · máx. hubs: 8 · orçamento: 20 buscas · pausa: 4 s

## Fluxo
1. Geocodifica origem/destino (Nominatim, com cache).
2. Seleciona hubs no corredor: `(d(O,H)+d(H,D)) / d(O,D) ≤ 1 + desvio`.
3. Fila de buscas por prioridade:
   a. O→D direto · b. O→Hᵢ · (descoberta de hubs) · c. Hᵢ→D dos hubs alcançáveis ·
   d. Hⱼ→D dos demais · e. Hᵢ→Hⱼ (progresso crescente) — até estourar o orçamento.
4. A cada busca, recombina segmentos e envia rotas parciais ao painel.

## Combinação
Segmentos (caronas) de buscas X→Y são encadeados quando `A.to == B.from`,
`B.saída − A.chegada ∈ [mín, máx]` e a distância entre o desembarque de A e o embarque de B ≤ km máx.
Ordenação: chegada mais cedo · menor preço · menos conexões.

## Módulos
`lib/geo.js` · `lib/hubs.js` · `lib/settings.js` · `lib/source-blablacar.js` (único acoplado ao site) ·
`lib/planner.js` (puro, testável) · `background.js` (orquestra) · `sidepanel.*` (UI)

## Riscos
- Mudança do formato do cache → quebra isolada em `source-blablacar.js`.
- DataDome pode exigir CAPTCHA → busca pausa, usuário resolve, retoma.
- Termos de Uso do BlaBlaCar: uso pessoal, baixo volume.
