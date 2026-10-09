/**
 * Modular Adapters for Optional Phases (Phase 5 Recommendations, Phase 6 Risk, Phase 8 Farmer Features).
 * These adapters allow future integration without coupling or fabricating scores.
 */
import { findFarmerByUid } from '../farmer.service.js';

export class Phase5RecommendationAdapter {
  constructor() {
    this.name = 'Phase 5 - Smart Mandi Recommendations';
  }

  isAvailable() {
    return false; // Not present in current worktree
  }

  async getRecommendation({ commodity, mandi } = {}) {
    return {
      available: false,
      feature: 'Smart Mandi Recommendations',
      phase: 5,
      reason: 'Smart mandi recommendation engine is being developed in Phase 5 and is not currently loaded in this worktree.',
      disclaimer: 'FASALYTICS never fabricates recommended mandis, transport costs or profit margins without verified models.',
    };
  }
}

export class Phase6RiskAdapter {
  constructor() {
    this.name = 'Phase 6 - Agricultural Risk Intelligence';
  }

  isAvailable() {
    return false; // Implemented in separate worktree (fasalytics-phase6)
  }

  async getRiskIndicators({ commodity, mandi } = {}) {
    return {
      available: false,
      feature: 'Agricultural Risk Intelligence',
      phase: 6,
      reason: 'Agricultural risk intelligence is implemented in Phase 6 in a separate worktree and is not currently active in this build.',
      generalRiskFactors: [
        'Arrival surge gluts leading to sharp price depreciation',
        'Weather volatility impacting perishables',
        'Inter-mandi price spreads not covering transit expenses',
      ],
      disclaimer: 'Specific quantitative risk scores are withheld until Phase 6 integration is deployed to prevent misleading advice.',
    };
  }
}

export class Phase8FarmerAdapter {
  constructor() {
    this.name = 'Phase 8 - Smart Farmer Personalization';
  }

  async getFarmerContext(uid) {
    if (!uid) return null;
    try {
      const farmer = await findFarmerByUid(uid);
      if (!farmer) return null;
      return {
        fullName: farmer.full_name,
        state: farmer.state,
        district: farmer.district,
        primaryCrop: farmer.primary_crop,
        preferredLanguage: farmer.preferred_language,
      };
    } catch {
      return null;
    }
  }
}

export const phase5Adapter = new Phase5RecommendationAdapter();
export const phase6Adapter = new Phase6RiskAdapter();
export const phase8Adapter = new Phase8FarmerAdapter();
