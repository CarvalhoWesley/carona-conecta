import { detour, distKm, normalize, progress } from './geo.js';

// Polos com muita oferta: ganham prioridade mesmo com desvio um pouco maior.
const MAJOR = new Set(['Ribeirão Preto', 'Campinas', 'São Paulo', 'Sorocaba', 'São Carlos', 'Bauru', 'Jundiaí',
  'Piracicaba', 'Limeira', 'São José do Rio Preto', 'Uberlândia', 'Belo Horizonte', 'Rio de Janeiro', 'Curitiba']);
const MAJOR_BONUS = 0.15;

// Cidades com bastante oferta de caronas. Ampliar conforme o uso.
export const HUBS = [
  ['Ribeirão Preto', -21.177, -47.81], ['Franca', -20.538, -47.4], ['São Carlos', -22.017, -47.89],
  ['Araraquara', -21.794, -48.175], ['Campinas', -22.906, -47.061], ['Limeira', -22.564, -47.401],
  ['Piracicaba', -22.725, -47.649], ['Rio Claro', -22.411, -47.561], ['Americana', -22.739, -47.331],
  ['Araras', -22.357, -47.384], ['Pirassununga', -21.996, -47.425], ['Leme', -22.186, -47.39],
  ['Mogi Guaçu', -22.372, -46.942], ['Jundiaí', -23.186, -46.884], ['São Paulo', -23.55, -46.633],
  ['Sorocaba', -23.501, -47.458], ['Itu', -23.264, -47.299], ['Indaiatuba', -23.088, -47.218],
  ['Tatuí', -23.355, -47.857], ['Itapetininga', -23.588, -48.048], ['Botucatu', -22.885, -48.445],
  ['Bauru', -22.315, -49.061], ['Jaú', -22.296, -48.558], ['São José do Rio Preto', -20.811, -49.376],
  ['Barretos', -20.557, -48.568], ['Bebedouro', -20.949, -48.479], ['Sertãozinho', -21.138, -47.99],
  ['Orlândia', -20.72, -47.886], ['São João da Boa Vista', -21.969, -46.798], ['Marília', -22.214, -49.946],
  ['Presidente Prudente', -22.121, -51.388], ['Santos', -23.961, -46.334], ['São José dos Campos', -23.179, -45.887],
  ['Taubaté', -23.026, -45.555], ['Uberaba', -19.748, -47.932], ['Uberlândia', -18.918, -48.277],
  ['Poços de Caldas', -21.787, -46.562], ['Pouso Alegre', -22.23, -45.936], ['Belo Horizonte', -19.917, -43.934],
  ['Rio de Janeiro', -22.907, -43.173], ['Curitiba', -25.429, -49.271], ['Londrina', -23.31, -51.163],
].map(([name, lat, lng]) => ({ name, lat, lng, major: MAJOR.has(name) }));

// Hubs no corredor O→D, excluindo a própria origem/destino, ordenados por menor desvio.
export function corridorHubs(o, d, { maxDetour, maxHubs }) {
  return HUBS.filter((h) => distKm(h, o) > 15 && distKm(h, d) > 15)
    .map((h) => ({ ...h, detour: detour(o, h, d) }))
    .filter((h) => h.detour <= 1 + maxDetour)
    .sort((a, b) => score(a) - score(b))
    .slice(0, maxHubs)
    .map((h) => ({ ...h, progress: progress(o, h, d) }))
    .sort((a, b) => a.progress - b.progress);
}

const score = (h) => h.detour - (h.major ? MAJOR_BONUS : 0);

export const hubKey = (place) => normalize(place.name);
