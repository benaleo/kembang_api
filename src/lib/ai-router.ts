export type ModelSelectionResult = {
  model_id: string | null;
  name?: string;
  est_wait_seconds: number;
};

const FALLBACK_MODEL_ID = 'gemini-2.5-flash';

/**
 * Pick an available AI model by trying each active model in priority order.
 * Uses the acquire_model_quota RPC to atomically reserve a slot.
 * Falls back to gemini-2.5-flash if the table is missing or queries fail.
 */
export async function pickModel(supabase: any): Promise<ModelSelectionResult> {
  try {
    const { data: models, error: queryError } = await supabase
      .from('ai_models')
      .select('*')
      .eq('is_active', true)
      .eq('supports_tools', true)
      .is('deleted_at', null)
      .order('priority', { ascending: true });

    if (queryError || !models || models.length === 0) {
      return { model_id: FALLBACK_MODEL_ID, est_wait_seconds: 0 };
    }

    let minWait = Infinity;

    for (const model of models) {
      const { data: rpcData, error: rpcError } = await supabase.rpc('acquire_model_quota', {
        p_model_id: model.model_id,
      });

      if (rpcError || !rpcData) continue;

      const row = Array.isArray(rpcData) ? rpcData[0] : rpcData;
      if (!row) continue;

      if (row.available === true) {
        return {
          model_id: model.model_id,
          name: model.name,
          est_wait_seconds: 0,
        };
      }

      if (typeof row.est_wait_seconds === 'number') {
        minWait = Math.min(minWait, row.est_wait_seconds);
      }
    }

    if (minWait === Infinity) {
      return { model_id: FALLBACK_MODEL_ID, est_wait_seconds: 0 };
    }

    return { model_id: null, est_wait_seconds: minWait };
  } catch {
    return { model_id: FALLBACK_MODEL_ID, est_wait_seconds: 0 };
  }
}
