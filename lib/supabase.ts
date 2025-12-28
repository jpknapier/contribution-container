
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MonthSnapshot, AppSettings } from '../types';
import { getTaxTableSet, listTaxTableYears, saveTaxTableSet } from '../src/lib/payroll/taxTables';
import { TaxTableSet } from '../src/lib/payroll/types';

let supabase: SupabaseClient | null = null;

export function getSupabase(settings: AppSettings) {
  if (settings.supabase_enabled && settings.supabase_url && settings.supabase_anon_key) {
    if (!supabase) {
      supabase = createClient(settings.supabase_url, settings.supabase_anon_key);
    }
    return supabase;
  }
  return null;
}

export async function fetchRemoteSettings(settings: AppSettings): Promise<AppSettings | null> {
  const client = getSupabase(settings);
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data, error } = await client
    .from('settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error("Settings fetch error", error);
    return null;
  }

  return data?.settings as AppSettings || null;
}

export async function fetchRemoteMonths(settings: AppSettings): Promise<MonthSnapshot[]> {
  const client = getSupabase(settings);
  if (!client) return [];

  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];

  const { data, error } = await client
    .from('months')
    .select('*')
    .eq('user_id', user.id);

  if (error) {
    console.error("Months fetch error", error);
    return [];
  }

  return (data || []).map((row: any) => row.snapshot as MonthSnapshot);
}

export async function fetchRemoteTaxTables(settings: AppSettings): Promise<TaxTableSet[]> {
  const client = getSupabase(settings);
  if (!client) return [];

  const { data: { user } } = await client.auth.getUser();
  if (!user) return [];

  const { data, error } = await client
    .from('tax_tables')
    .select('*')
    .eq('user_id', user.id);

  if (error) {
    console.error("Tax table fetch error", error);
    return [];
  }

  return (data || []).map((row: any) => ({
    ...row.tax_table,
    tax_year: row.tax_year,
    updated_at: row.updated_at || row.tax_table?.updated_at || Date.now()
  })) as TaxTableSet[];
}

export async function syncMonth(snapshot: MonthSnapshot, settings: AppSettings): Promise<MonthSnapshot | null> {
  const client = getSupabase(settings);
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  // Pull remote version
  const { data: remoteData, error: pullError } = await client
    .from('months')
    .select('*')
    .eq('user_id', user.id)
    .eq('month_id', snapshot.id)
    .single();

  if (pullError && pullError.code !== 'PGRST116') { // PGRST116 is not found
    console.error("Sync pull error", pullError);
    return null;
  }

  // Conflict resolution: Last write wins
  if (remoteData && remoteData.updated_at > snapshot.updated_at) {
    console.log("Remote version is newer. Overwriting local.");
    return remoteData.snapshot as MonthSnapshot;
  } else {
    console.log("Local version is newer or remote missing. Upserting.");
    const { error: pushError } = await client
      .from('months')
      .upsert({
        user_id: user.id,
        month_id: snapshot.id,
        snapshot: snapshot,
        updated_at: snapshot.updated_at
      });
    
    if (pushError) {
      console.error("Sync push error", pushError);
    }
    return null; // Local was pushed, no update needed from remote
  }
}

export async function syncSettings(settings: AppSettings): Promise<AppSettings | null> {
  const client = getSupabase(settings);
  if (!client) return null;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;

  const { data: remoteData, error: pullError } = await client
    .from('settings')
    .select('*')
    .eq('user_id', user.id)
    .single();

  if (pullError && pullError.code !== 'PGRST116') {
    console.error("Settings sync pull error", pullError);
    return null;
  }

  const remoteUpdatedAt = remoteData?.updated_at ?? 0;
  if (remoteData && remoteUpdatedAt > settings.updated_at) {
    console.log("Remote settings are newer. Overwriting local.");
    return remoteData.settings as AppSettings;
  } else {
    console.log("Local settings are newer or remote missing. Upserting.");
    const { error: pushError } = await client
      .from('settings')
      .upsert({
        user_id: user.id,
        settings: settings,
        updated_at: settings.updated_at
      });
    if (pushError) {
      console.error("Settings sync push error", pushError);
    }
    return null;
  }
}

export async function syncTaxTables(settings: AppSettings): Promise<void> {
  const client = getSupabase(settings);
  if (!client) return;

  const { data: { user } } = await client.auth.getUser();
  if (!user) return;

  const { data: remoteRows, error } = await client
    .from('tax_tables')
    .select('*')
    .eq('user_id', user.id);

  if (error) {
    console.error("Tax table sync pull error", error);
    return;
  }

  const remoteMap = new Map<number, { tax_year: number; table: TaxTableSet; updated_at: number }>();
  (remoteRows || []).forEach((row: any) => {
    remoteMap.set(row.tax_year, { tax_year: row.tax_year, table: row.tax_table, updated_at: row.updated_at || 0 });
  });

  const localYears = await listTaxTableYears();
  const localTables: TaxTableSet[] = [];
  for (const year of localYears) {
    const local = await getTaxTableSet(year);
    if (local) localTables.push(local);
  }

  for (const local of localTables) {
    const remote = remoteMap.get(local.tax_year);
    const localUpdated = local.updated_at || 0;
    if (remote && remote.updated_at > localUpdated) {
      await saveTaxTableSet({ ...remote.table, updated_at: remote.updated_at });
    } else {
      const payload = {
        user_id: user.id,
        tax_year: local.tax_year,
        tax_table: local,
        updated_at: local.updated_at || Date.now()
      };
      const { error: pushError } = await client
        .from('tax_tables')
        .upsert(payload);
      if (pushError) {
        console.error("Tax table sync push error", pushError);
      }
    }
  }

  for (const remote of remoteMap.values()) {
    const exists = localTables.find(table => table.tax_year === remote.tax_year);
    if (!exists) {
      await saveTaxTableSet({ ...remote.table, updated_at: remote.updated_at });
    }
  }
}
