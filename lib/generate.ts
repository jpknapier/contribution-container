import { MonthSetup, RecurringItem, Transaction } from '../types';

export type GenerateMode = 'missing' | 'regenerate' | 'reset';

const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthInfo = (monthId: string) => {
  const [year, month] = monthId.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month - 1, daysInMonth);
  return { year, month, daysInMonth, start, end };
};

const getDatesByInterval = (monthId: string, anchorDate: string, intervalDays: number) => {
  const { start, end } = getMonthInfo(monthId);
  let current = parseDate(anchorDate);

  while (current < start) {
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + intervalDays);
  }
  const dates: string[] = [];
  while (current <= end) {
    if (current >= start) {
      dates.push(formatDate(current));
    }
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + intervalDays);
  }
  return dates;
};

const getMonthlyDate = (monthId: string, dayRule: string, fallbackDay: number) => {
  const { year, month, daysInMonth } = getMonthInfo(monthId);
  if (dayRule === 'last') {
    return `${monthId}-${daysInMonth.toString().padStart(2, '0')}`;
  }
  const raw = dayRule.startsWith('day:') ? dayRule.slice(4) : dayRule;
  const dayNum = parseInt(raw, 10);
  const day = Number.isFinite(dayNum) ? dayNum : fallbackDay;
  const clamped = Math.min(Math.max(day, 1), daysInMonth);
  return `${monthId}-${clamped.toString().padStart(2, '0')}`;
};

export const getScheduleDates = (monthId: string, schedule: MonthSetup['paycheck_schedule'], anchorDate: string) => {
  const { daysInMonth } = getMonthInfo(monthId);
  if (schedule === 'weekly') {
    return getDatesByInterval(monthId, anchorDate, 7);
  }
  if (schedule === 'biweekly') {
    return getDatesByInterval(monthId, anchorDate, 14);
  }
  if (schedule === 'semimonthly') {
    return [
      `${monthId}-15`,
      `${monthId}-${daysInMonth.toString().padStart(2, '0')}`
    ];
  }
  const anchorDay = parseDate(anchorDate).getDate();
  return [getMonthlyDate(monthId, `${anchorDay}`, 1)];
};

const resolveAmount = (type: RecurringItem['type'], amount: number) => {
  const absolute = Math.abs(amount);
  if (type === 'income') return absolute;
  return -absolute;
};

const roundToCents = (value: number) => Math.round(value * 100) / 100;

const buildPaycheckSplitTransactions = (
  entry: { date: string; amount: number; is_bonus?: boolean; description?: string },
  splits: MonthSetup['paycheck_deposit_splits'],
  monthSetup: MonthSetup,
  createdAt: number,
  generatedBatchId: string
) => {
  if (!monthSetup.paycheck_category_id) return [];
  const eligibleSplits = splits.filter(split => split.account_id);
  if (!eligibleSplits.length) return [];
  const remainderSplit = eligibleSplits.find(split => split.is_remainder);
  const fixedSplits = eligibleSplits
    .filter(split => !split.is_remainder && split.amount !== 0)
    .map(split => ({ ...split, amount: Math.abs(split.amount) }));
  const fixedTotal = fixedSplits.reduce((sum, split) => sum + split.amount, 0);
  const absoluteAmount = Math.abs(entry.amount);
  const tx: Transaction[] = fixedSplits.map(split => ({
      id: crypto.randomUUID(),
      date: entry.date,
      amount: split.amount,
      account_id: split.account_id,
      category_id: monthSetup.paycheck_category_id,
      description: entry.description || (entry.is_bonus ? 'Bonus' : 'Paycheck'),
      created_at: createdAt,
      updated_at: createdAt,
      source: 'generated',
      source_item_id: `${entry.is_bonus ? 'bonus' : 'paycheck'}:${entry.date}:${split.account_id}`,
      generated_batch_id: generatedBatchId,
    }));

  if (remainderSplit) {
    const remainderAmount = roundToCents(Math.max(absoluteAmount - fixedTotal, 0));
    if (remainderAmount !== 0) {
      tx.push({
        id: crypto.randomUUID(),
        date: entry.date,
        amount: remainderAmount,
        account_id: remainderSplit.account_id,
        category_id: monthSetup.paycheck_category_id,
        description: entry.description || (entry.is_bonus ? 'Bonus' : 'Paycheck'),
        created_at: createdAt,
        updated_at: createdAt,
        source: 'generated',
        source_item_id: `${entry.is_bonus ? 'bonus' : 'paycheck'}:${entry.date}:${remainderSplit.account_id}`,
        generated_batch_id: generatedBatchId,
      });
    }
  }

  return tx;
};

export function generateMonthTransactions(
  monthId: string,
  monthSetup: MonthSetup,
  recurringItems: RecurringItem[],
  existingTransactions: Transaction[],
  mode: GenerateMode
) {
  const generatedBatchId = crypto.randomUUID();
  const createdAt = Date.now();

  const paycheckDates = getScheduleDates(monthId, monthSetup.paycheck_schedule, monthSetup.paycheck_anchor_date);
  const buildKey = (entry: { date: string; is_bonus?: boolean }) => `${entry.date}:${entry.is_bonus ? 'bonus' : 'regular'}`;
  const estimateEntries = (monthSetup.paycheck_estimates && monthSetup.paycheck_estimates.length > 0)
    ? monthSetup.paycheck_estimates
    : paycheckDates.map((date) => ({
        id: crypto.randomUUID(),
        date,
        amount: monthSetup.paycheck_default_amount,
        is_bonus: false
      }));
  const overridesByKey = new Map(monthSetup.paycheck_overrides.map(entry => [buildKey(entry), entry]));
  const baseEntries = estimateEntries.map(entry => {
    const override = overridesByKey.get(buildKey(entry));
    return override ? { ...entry, ...override } : entry;
  });
  const extraOverrides = monthSetup.paycheck_overrides.filter(entry => !estimateEntries.find(e => buildKey(e) === buildKey(entry)));
  const paycheckEntries = [...baseEntries, ...extraOverrides];

  const paycheckTx: Transaction[] = paycheckEntries
    .filter(entry => entry.amount !== 0)
    .flatMap(entry => buildPaycheckSplitTransactions(
      entry,
      monthSetup.paycheck_deposit_splits || [],
      monthSetup,
      createdAt,
      generatedBatchId
    ));

  const variableOverrides = new Map(monthSetup.variable_overrides.map(o => [o.item_id, o.amount]));

  const recurringTx: Transaction[] = recurringItems
    .filter(item => item.enabled)
    .flatMap(item => {
      const amount = variableOverrides.has(item.id) ? variableOverrides.get(item.id)! : item.default_amount;
      const anchor = item.anchor_date || `${monthId}-01`;
      let dates: string[] = [];
      if (item.cadence === 'weekly') {
        dates = getDatesByInterval(monthId, anchor, 7);
      } else if (item.cadence === 'biweekly') {
        dates = getDatesByInterval(monthId, anchor, 14);
      } else if (item.cadence === 'semimonthly') {
        const { daysInMonth } = getMonthInfo(monthId);
        dates = [
          `${monthId}-15`,
          `${monthId}-${daysInMonth.toString().padStart(2, '0')}`
        ];
      } else {
        const fallbackDay = parseDate(anchor).getDate();
        dates = [getMonthlyDate(monthId, item.day_rule, fallbackDay)];
      }

      return dates
        .filter(date => item.category_id && item.account_id)
        .map(date => ({
          id: crypto.randomUUID(),
          date,
          amount: resolveAmount(item.type, amount),
          account_id: item.account_id,
          transfer_account_id: item.transfer_account_id,
          category_id: item.category_id,
          loan_id: item.loan_id,
          description: item.name,
          created_at: createdAt,
          updated_at: createdAt,
          transaction_type: item.type,
          source: 'generated',
          source_item_id: `recurring:${item.id}:${date}`,
          generated_batch_id: generatedBatchId,
        }));
    });

  const oneOffTx: Transaction[] = monthSetup.one_offs
    .filter(adj => adj.account_id && adj.category_id)
    .map(adj => ({
      id: crypto.randomUUID(),
      date: adj.date,
      amount: resolveAmount(adj.type, adj.amount),
      account_id: adj.account_id,
      transfer_account_id: adj.transfer_account_id,
      category_id: adj.category_id,
      loan_id: adj.loan_id,
      description: adj.description || 'One-off adjustment',
      created_at: createdAt,
      updated_at: createdAt,
      transaction_type: adj.type,
      source: 'generated',
      source_item_id: `oneoff:${adj.id}`,
      generated_batch_id: generatedBatchId,
    }));

  const generatedTransactions = [...paycheckTx, ...recurringTx, ...oneOffTx];

  let nextTransactions: Transaction[] = [];
  if (mode === 'reset') {
    nextTransactions = generatedTransactions;
  } else if (mode === 'regenerate') {
    nextTransactions = [
      ...existingTransactions.filter(tx => tx.source !== 'generated'),
      ...generatedTransactions
    ];
  } else {
    const existingIds = new Set(existingTransactions.map(tx => tx.source_item_id).filter(Boolean));
    const missing = generatedTransactions.filter(tx => !existingIds.has(tx.source_item_id));
    nextTransactions = [...existingTransactions, ...missing];
  }

  return {
    transactions: nextTransactions,
    month_setup: {
      ...monthSetup,
      paycheck_overrides: monthSetup.paycheck_overrides,
      last_generated_at: Date.now(),
      generation_version: (monthSetup.generation_version || 0) + 1
    }
  };
}
