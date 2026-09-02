import {
  analyzeWayanadCsv,
  importWayanadCsv,
} from './wayanad-historical-import.mjs';

const SHARED_CONFIG = Object.freeze({
  tripName: 'Mystic Trails of the Sahyadris — A Monsoon Retreat',
  tripSlug: 'sahyadri-monsoon-retreat',
  tierId: 'standard',
  totalAmount: 13999,
  requireConsent: false,
});

export const SAHYADRI_HISTORICAL_CONFIGS = Object.freeze({
  '2025-07-25': Object.freeze({
    ...SHARED_CONFIG,
    tripDate: '25 Jul 2025 – 28 Jul 2025',
    batchId: 'sahyadri-2025-07-25',
  }),
  '2025-08-01': Object.freeze({
    ...SHARED_CONFIG,
    tripDate: '1 Aug 2025 – 4 Aug 2025',
    batchId: 'sahyadri-2025-08-01',
  }),
});

export function sahyadriConfig(departure) {
  const config = SAHYADRI_HISTORICAL_CONFIGS[departure];
  if (!config) {
    throw new Error(`Unknown Sahyadri departure: ${departure}`);
  }
  return config;
}

export function analyzeSahyadriCsv(csv, db, departure) {
  return analyzeWayanadCsv(csv, db, sahyadriConfig(departure));
}

export function importSahyadriCsv(csv, db, departure) {
  return importWayanadCsv(csv, db, sahyadriConfig(departure));
}
