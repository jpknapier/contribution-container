
import { MonthSnapshot, ForecastPoint, ForecastSummary, Transaction } from '../types';

export function calculateForecast(snapshot: MonthSnapshot): ForecastPoint[] {
  const { transactions, starting_balances, accounts } = snapshot;
  
  // Sort transactions by date
  const sortedTx = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  
  // Initialize balances
  const currentBalances: Record<string, number> = {};
  accounts.forEach(acc => {
    const starting = starting_balances.find(sb => sb.account_id === acc.id);
    currentBalances[acc.id] = starting ? starting.amount : 0;
  });

  const points: ForecastPoint[] = [];
  const yearMonth = snapshot.id;
  const daysInMonth = new Date(parseInt(yearMonth.split('-')[0]), parseInt(yearMonth.split('-')[1]), 0).getDate();

  // We iterate through every day of the month to generate a smooth forecast
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yearMonth}-${day.toString().padStart(2, '0')}`;
    
    // Apply transactions for this day
    const dayTransactions = sortedTx.filter(tx => tx.date === dateStr);
    dayTransactions.forEach(tx => {
      if ((tx.transaction_type === 'transfer' || tx.transfer_account_id) && tx.transfer_account_id) {
        const fromId = tx.account_id;
        const toId = tx.transfer_account_id;
        const amt = Math.abs(tx.amount);
        if (currentBalances[fromId] !== undefined) {
          currentBalances[fromId] -= amt;
        }
        if (currentBalances[toId] !== undefined) {
          currentBalances[toId] += amt;
        }
        return;
      }
      if (currentBalances[tx.account_id] !== undefined) {
        currentBalances[tx.account_id] += tx.amount;
      }
    });

    const cashAccountsTotal = accounts
      .filter(acc => acc.included_in_cash_forecast && acc.type !== 'investment')
      .reduce((sum, acc) => sum + (currentBalances[acc.id] || 0), 0);

    points.push({
      date: dateStr,
      balances: { ...currentBalances },
      total_cash: cashAccountsTotal
    });
  }

  return points;
}

export function getForecastSummary(points: ForecastPoint[]): ForecastSummary {
  if (points.length === 0) {
    return { projected_end_balance: 0, lowest_projected_balance: 0, lowest_balance_date: '' };
  }

  const endBalance = points[points.length - 1].total_cash;
  let lowestBalance = Infinity;
  let lowestDate = '';

  points.forEach(p => {
    if (p.total_cash < lowestBalance) {
      lowestBalance = p.total_cash;
      lowestDate = p.date;
    }
  });

  return {
    projected_end_balance: endBalance,
    lowest_projected_balance: lowestBalance === Infinity ? 0 : lowestBalance,
    lowest_balance_date: lowestDate
  };
}
